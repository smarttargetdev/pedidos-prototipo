namespace OrderReservation.Application.Abstractions;

public interface IOutboxRetryPolicy
{
    int MaxRetryAttempts { get; }
}
