using OrderReservation.Domain.Entities;

namespace OrderReservation.Application.Abstractions;

public interface IOutboxRepository
{
    Task AddAsync(OutboxMessage message, CancellationToken cancellationToken);
    Task<OutboxMessage?> GetByOrderIdAsync(Guid orderId, CancellationToken cancellationToken);
    Task<IReadOnlyList<OutboxMessage>> AcquirePendingBatchAsync(
        string workerId,
        int batchSize,
        DateTime utcNow,
        TimeSpan lockDuration,
        CancellationToken cancellationToken);
}
