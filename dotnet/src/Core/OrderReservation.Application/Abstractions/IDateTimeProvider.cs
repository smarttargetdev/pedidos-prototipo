namespace OrderReservation.Application.Abstractions;

public interface IDateTimeProvider
{
    DateTime UtcNow { get; }
}
