using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using OrderReservation.Application.Abstractions;
using OrderReservation.Application.DTOs;
using OrderReservation.Application.Services;
using OrderReservation.Domain.Enums;
using OrderReservation.Infrastructure.Messaging;
using OrderReservation.Infrastructure.Persistence;
using OrderReservation.Infrastructure.Persistence.Repositories;

namespace worker.Tests.Integration;

internal sealed class MutableDateTimeProvider(DateTime initialUtc) : IDateTimeProvider
{
    public DateTime UtcNow { get; set; } = initialUtc;
}

internal sealed class ControllableInventoryGateway : IInventoryGateway
{
    public bool ShouldFail { get; set; }
    public int CallCount { get; private set; }

    public Task ReserveAsync(InventoryReservationCommand command, CancellationToken cancellationToken)
    {
        CallCount++;
        if (ShouldFail)
        {
            throw new HttpRequestException($"Estoque mockado indisponível para {command.OrderId}.");
        }
        return Task.CompletedTask;
    }
}

internal sealed class StaticOptionsMonitor<T>(T currentValue) : IOptionsMonitor<T>
{
    public T CurrentValue => currentValue;
    public T Get(string? name) => currentValue;
    public IDisposable? OnChange(Action<T, string?> listener) => null;
}

internal sealed class SpyWebhookNotifier : IWebhookNotifier
{
    public List<WebhookNotification> SentNotifications { get; } = [];

    public Task NotifyAsync(WebhookNotification notification, CancellationToken cancellationToken)
    {
        SentNotifications.Add(notification);
        return Task.CompletedTask;
    }
}

public sealed class OutboxWorkerIntegrationTests : IAsyncLifetime
{
    private readonly string _dbPath = Path.Combine(
        Path.GetTempPath(),
        $"worker_integration_{Guid.NewGuid():N}.db");

    private AppDbContext _dbContext = null!;
    private MutableDateTimeProvider _clock = null!;
    private ControllableInventoryGateway _inventoryGateway = null!;
    private SimulatedMessageQueue _messageQueue = null!;
    private OrderService _orderService = null!;
    private OutboxProcessorService _processor = null!;
    private OutboxRepository _outboxRepo = null!;
    private SpyWebhookNotifier _webhookSpy = null!;

    public async Task InitializeAsync()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite($"Data Source={_dbPath}")
            .Options;

        _dbContext = new AppDbContext(options);
        await _dbContext.Database.EnsureCreatedAsync();
        await _dbContext.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");

        _clock = new MutableDateTimeProvider(new DateTime(2026, 11, 16, 12, 0, 0, DateTimeKind.Utc));
        _inventoryGateway = new ControllableInventoryGateway();
        _webhookSpy = new SpyWebhookNotifier();
        _messageQueue = new SimulatedMessageQueue(
            new StaticOptionsMonitor<SimulatedQueueOptions>(new SimulatedQueueOptions { SimulateOutage = false }),
            NullLogger<SimulatedMessageQueue>.Instance);

        var orderRepo = new OrderRepository(_dbContext);
        _outboxRepo = new OutboxRepository(_dbContext);
        var uow = new UnitOfWork(_dbContext);

        _orderService = new OrderService(
            orderRepo,
            _outboxRepo,
            uow,
            _clock,
            _webhookSpy,
            NullLogger<OrderService>.Instance);

        _processor = new OutboxProcessorService(
            _outboxRepo,
            orderRepo,
            _messageQueue,
            _inventoryGateway,
            uow,
            _clock,
            _webhookSpy,
            NullLogger<OutboxProcessorService>.Instance);
    }

    public async Task DisposeAsync()
    {
        await _dbContext.DisposeAsync();
        if (File.Exists(_dbPath))
        {
            File.Delete(_dbPath);
        }
    }

    [Fact]
    public async Task EndToEnd_FailureAnd60SecondRetry_ShouldReserveInventoryAfterRecovery()
    {
        // 1. Cria pedido enquanto estoque externo está fora do ar
        _inventoryGateway.ShouldFail = true;
        var created = await _orderService.CreateOrderAsync(
            new CreateOrderRequest(
                "Beatriz Martins",
                "beatriz@loja.com.br",
                [new OrderItemRequest("Placa de Vídeo RTX", 1, 4200.00m)]),
            CancellationToken.None);

        // 2. Primeira execução do Worker falha e agenda retry para +60 segundos
        var firstPass = await _processor.ProcessPendingBatchAsync("worker-A", 10, CancellationToken.None);
        Assert.Equal(1, firstPass);
        Assert.Equal(1, _inventoryGateway.CallCount);

        var afterFail = await _orderService.GetOrderByIdAsync(created.Id, CancellationToken.None);
        Assert.Equal(nameof(OrderStatus.PedidoCriado), afterFail.Status);
        Assert.Equal(nameof(OutboxStatus.FailedWaitingRetry), afterFail.Outbox!.Status);
        Assert.Equal(1, afterFail.Outbox.RetryCount);
        Assert.Equal(_clock.UtcNow.AddSeconds(60), afterFail.Outbox.NextRetryAtUtc);

        // 3. Após apenas 30 segundos, o Worker NÃO deve reprocessar antes de completar 60s
        _clock.UtcNow = _clock.UtcNow.AddSeconds(30);
        _inventoryGateway.ShouldFail = false;
        var prematurePass = await _processor.ProcessPendingBatchAsync("worker-A", 10, CancellationToken.None);
        Assert.Equal(0, prematurePass);
        Assert.Equal(1, _inventoryGateway.CallCount);

        // 4. Após completar os 60 segundos, o Worker retenta e reserva com sucesso
        _clock.UtcNow = _clock.UtcNow.AddSeconds(31);
        var retryPass = await _processor.ProcessPendingBatchAsync("worker-A", 10, CancellationToken.None);
        Assert.Equal(1, retryPass);
        Assert.Equal(2, _inventoryGateway.CallCount);

        var completed = await _orderService.GetOrderByIdAsync(created.Id, CancellationToken.None);
        Assert.Equal(nameof(OrderStatus.EstoqueReservado), completed.Status);
        Assert.Equal(nameof(OutboxStatus.Dispatched), completed.Outbox!.Status);
        Assert.Contains(_webhookSpy.SentNotifications, n => n.OrderId == created.Id && n.EventType == nameof(OrderStatus.EstoqueReservado));
    }

    [Fact]
    public async Task AcquirePendingBatch_ShouldPreventSimultaneousProcessingBySecondWorker()
    {
        await _orderService.CreateOrderAsync(
            new CreateOrderRequest(
                "Lucas Silva",
                "lucas@loja.com.br",
                [new OrderItemRequest("Webcam HD", 1, 290.00m)]),
            CancellationToken.None);

        var batchWorkerA = await _outboxRepo.AcquirePendingBatchAsync(
            "worker-A", 10, _clock.UtcNow, TimeSpan.FromSeconds(30), CancellationToken.None);
        var batchWorkerB = await _outboxRepo.AcquirePendingBatchAsync(
            "worker-B", 10, _clock.UtcNow, TimeSpan.FromSeconds(30), CancellationToken.None);

        Assert.Single(batchWorkerA);
        Assert.Empty(batchWorkerB);
    }

    [Fact]
    public async Task SimulatedMessageQueue_ShouldPreserveUniquenessPerOrderId()
    {
        var orderId = Guid.NewGuid();
        var msg = new QueueMessage(Guid.NewGuid(), orderId, "PedidoCriado", "{}", _clock.UtcNow);

        var first = await _messageQueue.EnqueueUniqueAsync(msg, CancellationToken.None);
        var duplicate = await _messageQueue.EnqueueUniqueAsync(msg, CancellationToken.None);

        Assert.True(first.Accepted);
        Assert.False(first.AlreadyExisted);
        Assert.True(duplicate.Accepted);
        Assert.True(duplicate.AlreadyExisted);
    }

    [Fact]
    public async Task AbortedOrder_ShouldNeverCallInventoryGatewayWhenWorkerRuns()
    {
        var created = await _orderService.CreateOrderAsync(
            new CreateOrderRequest(
                "Marcos Paulo",
                "marcos@loja.com.br",
                [new OrderItemRequest("Mouse Gamer", 1, 250.00m)]),
            CancellationToken.None);

        await _orderService.AbortOrderAsync(created.Id, CancellationToken.None);

        var processed = await _processor.ProcessPendingBatchAsync("worker-A", 10, CancellationToken.None);
        Assert.Equal(0, processed);
        Assert.Equal(0, _inventoryGateway.CallCount);
    }
}
