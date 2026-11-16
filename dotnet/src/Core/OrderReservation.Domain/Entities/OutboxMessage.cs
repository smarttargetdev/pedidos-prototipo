using OrderReservation.Domain.Enums;

namespace OrderReservation.Domain.Entities;

public sealed class OutboxMessage
{
    private OutboxMessage() { }

    public Guid Id { get; private set; }
    public Guid OrderId { get; private set; }
    public string EventType { get; private set; } = string.Empty;
    public string PayloadJson { get; private set; } = string.Empty;
    public OutboxStatus Status { get; private set; }
    public int RetryCount { get; private set; }
    public DateTime? NextRetryAtUtc { get; private set; }
    public string? LockedBy { get; private set; }
    public DateTime? LockedUntilUtc { get; private set; }
    public string? LastError { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? DispatchedAtUtc { get; private set; }

    public static OutboxMessage CreatePedidoCriado(Guid orderId, string payloadJson, DateTime utcNow)
    {
        return new OutboxMessage
        {
            Id = Guid.CreateVersion7(),
            OrderId = orderId,
            EventType = nameof(OrderStatus.PedidoCriado),
            PayloadJson = payloadJson,
            Status = OutboxStatus.Pending,
            RetryCount = 0,
            CreatedAtUtc = utcNow
        };
    }

    public void MarkDispatched(DateTime utcNow)
    {
        Status = OutboxStatus.Dispatched;
        DispatchedAtUtc = utcNow;
        LockedBy = null;
        LockedUntilUtc = null;
        LastError = null;
        NextRetryAtUtc = null;
    }

    public void ScheduleRetry(DateTime utcNow, TimeSpan retryDelay, string errorMessage)
    {
        Status = OutboxStatus.FailedWaitingRetry;
        RetryCount++;
        NextRetryAtUtc = utcNow.Add(retryDelay);
        LastError = errorMessage;
        LockedBy = null;
        LockedUntilUtc = null;
    }

    public void Cancel()
    {
        if (Status == OutboxStatus.Dispatched)
        {
            return;
        }

        Status = OutboxStatus.Cancelled;
        LockedBy = null;
        LockedUntilUtc = null;
        NextRetryAtUtc = null;
    }
}
