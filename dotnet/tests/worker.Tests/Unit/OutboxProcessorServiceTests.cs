using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using OrderReservation.Application.Abstractions;
using OrderReservation.Application.Services;
using OrderReservation.Domain.Entities;
using OrderReservation.Domain.Enums;

namespace worker.Tests.Unit;

public sealed class OutboxProcessorServiceTests
{
    private readonly Mock<IOutboxRepository> _outboxRepoMock = new();
    private readonly Mock<IOrderRepository> _orderRepoMock = new();
    private readonly Mock<IMessageQueue> _queueMock = new();
    private readonly Mock<IInventoryGateway> _inventoryMock = new();
    private readonly Mock<IUnitOfWork> _uowMock = new();
    private readonly Mock<IDateTimeProvider> _clockMock = new();
    private readonly Mock<IWebhookNotifier> _webhookMock = new();
    private readonly DateTime _nowUtc = new(2026, 11, 16, 18, 0, 0, DateTimeKind.Utc);

    public OutboxProcessorServiceTests()
    {
        _clockMock.Setup(c => c.UtcNow).Returns(_nowUtc);
        _uowMock.Setup(u => u.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
    }

    private OutboxProcessorService CreateSut(IOutboxRetryPolicy? retryPolicy = null) => new(
        _outboxRepoMock.Object,
        _orderRepoMock.Object,
        _queueMock.Object,
        _inventoryMock.Object,
        _uowMock.Object,
        _clockMock.Object,
        _webhookMock.Object,
        NullLogger<OutboxProcessorService>.Instance,
        retryPolicy);

    [Fact]
    public async Task ProcessPendingBatch_ShouldReserveInventoryAndMarkDispatched_WhenSuccessful()
    {
        var order = Order.Create("Ana", "ana@loja.com.br", [("SSD", 1, 399m)], false, _nowUtc);
        var outbox = OutboxMessage.CreatePedidoCriado(order.Id, "{}", _nowUtc);

        _outboxRepoMock
            .Setup(r => r.AcquirePendingBatchAsync("worker-1", 10, _nowUtc, It.IsAny<TimeSpan>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([outbox]);
        _outboxRepoMock.Setup(r => r.GetByOrderIdAsync(order.Id, It.IsAny<CancellationToken>())).ReturnsAsync(outbox);
        _orderRepoMock.Setup(r => r.GetByIdAsync(order.Id, It.IsAny<CancellationToken>())).ReturnsAsync(order);
        _queueMock
            .Setup(q => q.EnqueueUniqueAsync(It.IsAny<QueueMessage>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new EnqueueResult(true, false, "OK"));

        var processed = await CreateSut().ProcessPendingBatchAsync("worker-1", 10, CancellationToken.None);

        Assert.Equal(1, processed);
        Assert.Equal(OrderStatus.EstoqueReservado, order.Status);
        Assert.Equal(OutboxStatus.Dispatched, outbox.Status);
        _inventoryMock.Verify(g => g.ReserveAsync(
            It.Is<InventoryReservationCommand>(c => c.OrderId == order.Id),
            It.IsAny<CancellationToken>()), Times.Once);
        _queueMock.Verify(q => q.AcknowledgeAsync(order.Id, It.IsAny<CancellationToken>()), Times.Once);
        _webhookMock.Verify(w => w.NotifyAsync(
            It.Is<WebhookNotification>(n => n.OrderId == order.Id && n.EventType == nameof(OrderStatus.EstoqueReservado)),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ProcessPendingBatch_ShouldCancelOutboxAndSkipInventory_WhenOrderIsCancelled()
    {
        var order = Order.Create("Carlos", "carlos@loja.com.br", [("Mouse", 1, 150m)], false, _nowUtc);
        order.Cancel(_nowUtc.AddSeconds(2));
        var outbox = OutboxMessage.CreatePedidoCriado(order.Id, "{}", _nowUtc);

        _outboxRepoMock
            .Setup(r => r.AcquirePendingBatchAsync("worker-1", 10, _nowUtc, It.IsAny<TimeSpan>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([outbox]);
        _outboxRepoMock.Setup(r => r.GetByOrderIdAsync(order.Id, It.IsAny<CancellationToken>())).ReturnsAsync(outbox);
        _orderRepoMock.Setup(r => r.GetByIdAsync(order.Id, It.IsAny<CancellationToken>())).ReturnsAsync(order);

        await CreateSut().ProcessPendingBatchAsync("worker-1", 10, CancellationToken.None);

        Assert.Equal(OutboxStatus.Cancelled, outbox.Status);
        _queueMock.Verify(q => q.EnqueueUniqueAsync(It.IsAny<QueueMessage>(), It.IsAny<CancellationToken>()), Times.Never);
        _inventoryMock.Verify(g => g.ReserveAsync(It.IsAny<InventoryReservationCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ProcessPendingBatch_ShouldSchedule60SecondsRetry_WhenInventoryGatewayFails()
    {
        var order = Order.Create("Pedro", "pedro@loja.com.br", [("Monitor", 1, 1200m)], false, _nowUtc);
        var outbox = OutboxMessage.CreatePedidoCriado(order.Id, "{}", _nowUtc);

        _outboxRepoMock
            .Setup(r => r.AcquirePendingBatchAsync("worker-1", 10, _nowUtc, It.IsAny<TimeSpan>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([outbox]);
        _outboxRepoMock.Setup(r => r.GetByOrderIdAsync(order.Id, It.IsAny<CancellationToken>())).ReturnsAsync(outbox);
        _orderRepoMock.Setup(r => r.GetByIdAsync(order.Id, It.IsAny<CancellationToken>())).ReturnsAsync(order);
        _queueMock
            .Setup(q => q.EnqueueUniqueAsync(It.IsAny<QueueMessage>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new EnqueueResult(true, false, "OK"));
        _inventoryMock
            .Setup(g => g.ReserveAsync(It.IsAny<InventoryReservationCommand>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("503 Service Unavailable"));

        await CreateSut().ProcessPendingBatchAsync("worker-1", 10, CancellationToken.None);

        Assert.Equal(OrderStatus.PedidoCriado, order.Status);
        Assert.Equal(OutboxStatus.FailedWaitingRetry, outbox.Status);
        Assert.Equal(1, outbox.RetryCount);
        Assert.Equal(_nowUtc.AddSeconds(60), outbox.NextRetryAtUtc);
        Assert.Contains("503", outbox.LastError);
        _queueMock.Verify(q => q.AcknowledgeAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ProcessPendingBatch_ShouldSchedule60SecondsRetry_WhenQueueIsUnavailable()
    {
        var order = Order.Create("Laura", "laura@loja.com.br", [("Teclado", 1, 300m)], false, _nowUtc);
        var outbox = OutboxMessage.CreatePedidoCriado(order.Id, "{}", _nowUtc);

        _outboxRepoMock
            .Setup(r => r.AcquirePendingBatchAsync("worker-1", 10, _nowUtc, It.IsAny<TimeSpan>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([outbox]);
        _outboxRepoMock.Setup(r => r.GetByOrderIdAsync(order.Id, It.IsAny<CancellationToken>())).ReturnsAsync(outbox);
        _orderRepoMock.Setup(r => r.GetByIdAsync(order.Id, It.IsAny<CancellationToken>())).ReturnsAsync(order);
        _queueMock
            .Setup(q => q.EnqueueUniqueAsync(It.IsAny<QueueMessage>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new EnqueueResult(false, false, "Fila offline"));

        await CreateSut().ProcessPendingBatchAsync("worker-1", 10, CancellationToken.None);

        Assert.Equal(OutboxStatus.FailedWaitingRetry, outbox.Status);
        Assert.Equal(1, outbox.RetryCount);
        Assert.Equal(_nowUtc.AddSeconds(60), outbox.NextRetryAtUtc);
        _inventoryMock.Verify(g => g.ReserveAsync(It.IsAny<InventoryReservationCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ProcessPendingBatch_ShouldTransitionToDeadLetter_WhenMaxRetryAttemptsReached()
    {
        var order = Order.Create("Bruno", "bruno@loja.com.br", [("Cadeira", 1, 950m)], false, _nowUtc);
        var outbox = OutboxMessage.CreatePedidoCriado(order.Id, "{}", _nowUtc);
        outbox.ScheduleRetry(_nowUtc.AddMinutes(-2), TimeSpan.FromSeconds(60), "Erro 1", maxRetryAttempts: 3);
        outbox.ScheduleRetry(_nowUtc.AddMinutes(-1), TimeSpan.FromSeconds(60), "Erro 2", maxRetryAttempts: 3);

        var policyMock = new Mock<IOutboxRetryPolicy>();
        policyMock.Setup(p => p.MaxRetryAttempts).Returns(3);

        _outboxRepoMock
            .Setup(r => r.AcquirePendingBatchAsync("worker-1", 10, _nowUtc, It.IsAny<TimeSpan>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([outbox]);
        _outboxRepoMock.Setup(r => r.GetByOrderIdAsync(order.Id, It.IsAny<CancellationToken>())).ReturnsAsync(outbox);
        _orderRepoMock.Setup(r => r.GetByIdAsync(order.Id, It.IsAny<CancellationToken>())).ReturnsAsync(order);
        _queueMock
            .Setup(q => q.EnqueueUniqueAsync(It.IsAny<QueueMessage>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new EnqueueResult(true, false, "OK"));
        _inventoryMock
            .Setup(g => g.ReserveAsync(It.IsAny<InventoryReservationCommand>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("503 Service Unavailable"));

        await CreateSut(policyMock.Object).ProcessPendingBatchAsync("worker-1", 10, CancellationToken.None);

        Assert.Equal(OutboxStatus.DeadLetter, outbox.Status);
        Assert.Equal(3, outbox.RetryCount);
        Assert.Null(outbox.NextRetryAtUtc);
    }
}
