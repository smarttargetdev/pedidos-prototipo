namespace OrderReservation.Application.Abstractions;

public sealed record WebhookNotification(
    Guid? OrderId,
    string EventType,
    string CustomerName,
    decimal TotalAmount,
    DateTime OccurredAtUtc,
    IReadOnlyCollection<InventoryReservationItem> Items);

public interface IWebhookNotifier
{
    Task NotifyAsync(WebhookNotification notification, CancellationToken cancellationToken);
}
