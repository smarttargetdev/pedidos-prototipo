using System.Text.Json;
using Microsoft.Extensions.Logging;
using OrderReservation.Application.Abstractions;
using OrderReservation.Application.DTOs;
using OrderReservation.Application.Logging;
using OrderReservation.Domain.Entities;
using OrderReservation.Domain.Enums;
using OrderReservation.Domain.Exceptions;

namespace OrderReservation.Application.Services;

public interface IOrderService
{
    Task<OrderResponse> CreateOrderAsync(CreateOrderRequest request, CancellationToken cancellationToken);
    Task<OrderResponse> GetOrderByIdAsync(Guid orderId, CancellationToken cancellationToken);
    Task<OrderResponse> AbortOrderAsync(Guid orderId, CancellationToken cancellationToken);
}

public sealed class OrderService(
    IOrderRepository orderRepository,
    IOutboxRepository outboxRepository,
    IUnitOfWork unitOfWork,
    IDateTimeProvider clock,
    ILogger<OrderService> logger) : IOrderService
{
    public async Task<OrderResponse> CreateOrderAsync(CreateOrderRequest request, CancellationToken cancellationToken)
    {
        var utcNow = clock.UtcNow;
        var items = (request.Items ?? []).Select(i => (i.ProductName, i.Quantity, i.UnitPrice));

        var order = Order.Create(
            request.CustomerName,
            request.CustomerEmail,
            items,
            request.Abortado,
            utcNow);

        OutboxMessage? outboxMessage = null;

        if (!request.Abortado)
        {
            var payloadJson = JsonSerializer.Serialize(new
            {
                OrderId = order.Id,
                order.CustomerName,
                order.TotalAmount,
                Stamp = nameof(OrderStatus.PedidoCriado),
                order.PedidoCriadoAtUtc,
                Items = order.Items.Select(i => new { i.ProductName, i.Quantity, i.UnitPrice, i.Subtotal })
            });

            outboxMessage = OutboxMessage.CreatePedidoCriado(order.Id, payloadJson, utcNow);
        }

        await unitOfWork.ExecuteInTransactionAsync(async ct =>
        {
            await orderRepository.AddAsync(order, ct);
            if (outboxMessage is not null)
            {
                await outboxRepository.AddAsync(outboxMessage, ct);
            }
            await unitOfWork.SaveChangesAsync(ct);
        }, cancellationToken);

        using (logger.BeginScope(new Dictionary<string, object> { ["OrderId"] = order.Id }))
        {
            logger.OrderCreated(
                order.Id,
                order.CustomerName,
                order.CustomerEmail,
                order.Items.Count,
                order.TotalAmount,
                order.Status.ToString(),
                order.PedidoCriadoAtUtc,
                outboxMessage is not null);
        }

        return MapToResponse(order, outboxMessage);
    }

    public async Task<OrderResponse> GetOrderByIdAsync(Guid orderId, CancellationToken cancellationToken)
    {
        var order = await orderRepository.GetByIdAsync(orderId, cancellationToken)
            ?? throw new OrderNotFoundException(orderId);

        var outbox = await outboxRepository.GetByOrderIdAsync(orderId, cancellationToken);
        return MapToResponse(order, outbox);
    }

    public async Task<OrderResponse> AbortOrderAsync(Guid orderId, CancellationToken cancellationToken)
    {
        Order? order = null;
        OutboxMessage? outbox = null;
        var abortedAt = clock.UtcNow;

        await unitOfWork.ExecuteInTransactionAsync(async ct =>
        {
            order = await orderRepository.GetByIdAsync(orderId, ct)
                ?? throw new OrderNotFoundException(orderId);

            order.Abort(abortedAt);

            outbox = await outboxRepository.GetByOrderIdAsync(orderId, ct);
            outbox?.Cancel();

            await unitOfWork.SaveChangesAsync(ct);
        }, cancellationToken);

        using (logger.BeginScope(new Dictionary<string, object> { ["OrderId"] = orderId }))
        {
            logger.OrderAborted(orderId, abortedAt, outbox is not null);
        }

        return MapToResponse(order!, outbox);
    }

    private static OrderResponse MapToResponse(Order order, OutboxMessage? outbox)
    {
        return new OrderResponse(
            order.Id,
            order.CustomerName,
            order.CustomerEmail,
            order.Status.ToString(),
            order.TotalAmount,
            order.PedidoCriadoAtUtc,
            order.CreatedAtUtc,
            order.UpdatedAtUtc,
            order.Items.Select(i => new OrderItemResponse(
                i.Id,
                i.ProductName,
                i.Quantity,
                i.UnitPrice,
                i.Subtotal)).ToList(),
            outbox is null
                ? null
                : new OutboxSummaryResponse(
                    outbox.Id,
                    outbox.Status.ToString(),
                    outbox.RetryCount,
                    outbox.NextRetryAtUtc,
                    outbox.LastError,
                    outbox.DispatchedAtUtc));
    }
}
