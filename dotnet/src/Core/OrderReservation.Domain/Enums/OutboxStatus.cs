namespace OrderReservation.Domain.Enums;

public enum OutboxStatus
{
    Pending = 1,
    Processing = 2,
    Dispatched = 3,
    FailedWaitingRetry = 4,
    Cancelled = 5
}
