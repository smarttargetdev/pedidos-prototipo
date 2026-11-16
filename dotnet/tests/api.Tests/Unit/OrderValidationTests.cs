using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using OrderReservation.Application.Abstractions;
using OrderReservation.Application.DTOs;
using OrderReservation.Application.Services;
using OrderReservation.Domain.Entities;
using OrderReservation.Domain.Enums;
using OrderReservation.Domain.Exceptions;

namespace api.Tests.Unit;

public sealed class OrderValidationTests
{
    private readonly Mock<IOrderRepository> _orderRepoMock = new();
    private readonly Mock<IOutboxRepository> _outboxRepoMock = new();
    private readonly Mock<IUnitOfWork> _uowMock = new();
    private readonly Mock<IDateTimeProvider> _clockMock = new();
    private readonly DateTime _fixedUtc = new(2026, 11, 16, 15, 0, 0, DateTimeKind.Utc);

    public OrderValidationTests()
    {
        _clockMock.Setup(c => c.UtcNow).Returns(_fixedUtc);
        _uowMock
            .Setup(u => u.ExecuteInTransactionAsync(It.IsAny<Func<CancellationToken, Task>>(), It.IsAny<CancellationToken>()))
            .Returns<Func<CancellationToken, Task>, CancellationToken>((action, ct) => action(ct));
        _uowMock
            .Setup(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(1);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void CreateOrder_ShouldThrowDomainException_WhenCustomerNameIsInvalid(string invalidName)
    {
        var act = () => Order.Create(
            invalidName,
            "cliente@loja.com.br",
            [("Produto A", 1, 50m)],
            aborted: false,
            _fixedUtc);

        var ex = Assert.Throws<DomainException>(act);
        Assert.Contains("cliente", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CreateOrder_ShouldThrowDomainException_WhenCustomerEmailIsEmpty()
    {
        var act = () => Order.Create(
            "Ana Souza",
            "",
            [("Produto A", 1, 50m)],
            aborted: false,
            _fixedUtc);

        Assert.Throws<DomainException>(act);
    }

    [Fact]
    public void CreateOrder_ShouldThrowDomainException_WhenItemsListIsEmpty()
    {
        var act = () => Order.Create(
            "Ana Souza",
            "ana@loja.com.br",
            [],
            aborted: false,
            _fixedUtc);

        Assert.Throws<DomainException>(act);
    }

    [Theory]
    [InlineData("", 1, 10)]
    [InlineData("Produto X", 0, 10)]
    [InlineData("Produto X", -2, 10)]
    [InlineData("Produto X", 1, -0.01)]
    public void CreateOrderItem_ShouldThrowDomainException_WhenItemFieldsAreInvalid(
        string productName,
        int quantity,
        decimal unitPrice)
    {
        var act = () => OrderItem.Create(Guid.NewGuid(), productName, quantity, unitPrice);
        Assert.Throws<DomainException>(act);
    }

    [Fact]
    public async Task CreateOrderAsync_ShouldCalculateTotal_SetPedidoCriadoStamp_AndEnqueueOutbox()
    {
        var service = new OrderService(
            _orderRepoMock.Object,
            _outboxRepoMock.Object,
            _uowMock.Object,
            _clockMock.Object,
            NullLogger<OrderService>.Instance);

        var request = new CreateOrderRequest(
            "Mariana Costa",
            "mariana@loja.com.br",
            [
                new OrderItemRequest("Teclado TKL", 2, 250.50m),
                new OrderItemRequest("Mouse Pro", 1, 199.00m)
            ],
            Abortado: false);

        var response = await service.CreateOrderAsync(request, CancellationToken.None);

        Assert.NotEqual(Guid.Empty, response.Id);
        Assert.Equal(nameof(OrderStatus.PedidoCriado), response.Status);
        Assert.Equal(700.00m, response.TotalAmount);
        Assert.Equal(_fixedUtc, response.PedidoCriadoAtUtc);
        Assert.NotNull(response.Outbox);

        _orderRepoMock.Verify(r => r.AddAsync(It.IsAny<Order>(), It.IsAny<CancellationToken>()), Times.Once);
        _outboxRepoMock.Verify(r => r.AddAsync(It.Is<OutboxMessage>(m => m.OrderId == response.Id), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task CreateOrderAsync_WithAbortadoTrue_ShouldNotCreateOutboxMessage()
    {
        var service = new OrderService(
            _orderRepoMock.Object,
            _outboxRepoMock.Object,
            _uowMock.Object,
            _clockMock.Object,
            NullLogger<OrderService>.Instance);

        var request = new CreateOrderRequest(
            "Carlos Mendes",
            "carlos@loja.com.br",
            [new OrderItemRequest("Monitor 27", 1, 1899.90m)],
            Abortado: true);

        var response = await service.CreateOrderAsync(request, CancellationToken.None);

        Assert.Equal(nameof(OrderStatus.PedidoAbortado), response.Status);
        Assert.Null(response.Outbox);
        _outboxRepoMock.Verify(r => r.AddAsync(It.IsAny<OutboxMessage>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public void AbortOrder_ShouldThrowDomainException_WhenInventoryAlreadyReserved()
    {
        var order = Order.Create(
            "Ana Souza",
            "ana@loja.com.br",
            [("SSD 1TB", 1, 450m)],
            aborted: false,
            _fixedUtc);

        order.MarkInventoryReserved(_fixedUtc.AddSeconds(5));

        var act = () => order.Abort(_fixedUtc.AddSeconds(10));
        Assert.Throws<DomainException>(act);
    }
}
