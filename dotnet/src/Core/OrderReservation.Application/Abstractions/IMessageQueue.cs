namespace OrderReservation.Application.Abstractions;

public sealed record QueueMessage(
    Guid MessageId,
    Guid OrderId,
    string EventType,
    string PayloadJson,
    DateTime EnqueuedAtUtc);

public sealed record EnqueueResult(bool Accepted, bool AlreadyExisted, string Reason);

public interface IMessageQueue
{
    Task<EnqueueResult> EnqueueUniqueAsync(QueueMessage message, CancellationToken cancellationToken);
    Task AcknowledgeAsync(Guid orderId, CancellationToken cancellationToken);
}
