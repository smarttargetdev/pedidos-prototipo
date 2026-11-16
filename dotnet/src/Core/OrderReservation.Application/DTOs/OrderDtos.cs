namespace OrderReservation.Application.DTOs;

public sealed record OrderItemRequest(
    string ProductName,
    int Quantity,
    decimal UnitPrice);

public sealed record CreateOrderRequest(
    string CustomerName,
    string CustomerEmail,
    IReadOnlyCollection<OrderItemRequest> Items,
    bool Abortado = false);

public sealed record OrderItemResponse(
    Guid Id,
    string ProductName,
    int Quantity,
    decimal UnitPrice,
    decimal Subtotal);

public sealed record OutboxSummaryResponse(
    Guid Id,
    string Status,
    int RetryCount,
    DateTime? NextRetryAtUtc,
    string? LastError,
    DateTime? DispatchedAtUtc);

public sealed record OrderResponse(
    Guid Id,
    string CustomerName,
    string CustomerEmail,
    string Status,
    decimal TotalAmount,
    DateTime PedidoCriadoAtUtc,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    IReadOnlyCollection<OrderItemResponse> Items,
    OutboxSummaryResponse? Outbox);
