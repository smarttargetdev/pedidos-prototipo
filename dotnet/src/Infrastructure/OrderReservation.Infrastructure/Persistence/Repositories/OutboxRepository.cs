using Microsoft.EntityFrameworkCore;
using OrderReservation.Application.Abstractions;
using OrderReservation.Domain.Entities;
using OrderReservation.Domain.Enums;

namespace OrderReservation.Infrastructure.Persistence.Repositories;

public sealed class OutboxRepository(AppDbContext dbContext) : IOutboxRepository
{
    public Task AddAsync(OutboxMessage message, CancellationToken cancellationToken)
        => dbContext.OutboxMessages.AddAsync(message, cancellationToken).AsTask();

    public Task<OutboxMessage?> GetByOrderIdAsync(Guid orderId, CancellationToken cancellationToken)
        => dbContext.OutboxMessages.FirstOrDefaultAsync(m => m.OrderId == orderId, cancellationToken);

    public async Task<IReadOnlyList<OutboxMessage>> AcquirePendingBatchAsync(
        string workerId,
        int batchSize,
        DateTime utcNow,
        TimeSpan lockDuration,
        CancellationToken cancellationToken)
    {
        var candidateIds = await dbContext.OutboxMessages
            .Where(m =>
                (m.Status == OutboxStatus.Pending || m.Status == OutboxStatus.FailedWaitingRetry) &&
                (m.NextRetryAtUtc == null || m.NextRetryAtUtc <= utcNow) &&
                (m.LockedUntilUtc == null || m.LockedUntilUtc < utcNow))
            .OrderBy(m => m.CreatedAtUtc)
            .Select(m => m.Id)
            .Take(batchSize)
            .ToListAsync(cancellationToken);

        if (candidateIds.Count == 0)
        {
            return [];
        }

        var lockedUntil = utcNow.Add(lockDuration);
        var acquired = new List<OutboxMessage>();

        // Aquisição atômica por registro impede que dois workers enviem a mesma mensagem ao mesmo tempo
        foreach (var id in candidateIds)
        {
            var affected = await dbContext.OutboxMessages
                .Where(m =>
                    m.Id == id &&
                    (m.Status == OutboxStatus.Pending || m.Status == OutboxStatus.FailedWaitingRetry) &&
                    (m.LockedUntilUtc == null || m.LockedUntilUtc < utcNow))
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(m => m.Status, OutboxStatus.Processing)
                    .SetProperty(m => m.LockedBy, workerId)
                    .SetProperty(m => m.LockedUntilUtc, lockedUntil),
                    cancellationToken);

            if (affected == 1)
            {
                var entity = await dbContext.OutboxMessages
                    .AsNoTracking()
                    .FirstAsync(m => m.Id == id, cancellationToken);
                acquired.Add(entity);
            }
        }

        return acquired;
    }
}
