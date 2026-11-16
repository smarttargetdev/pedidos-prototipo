using System.Diagnostics;
using Microsoft.Extensions.Logging;
using OrderReservation.Application.Abstractions;
using OrderReservation.Application.Logging;
using OrderReservation.Domain.Enums;

namespace OrderReservation.Application.Services;

public interface IOutboxProcessorService
{
    Task<int> ProcessPendingBatchAsync(string workerId, int batchSize, CancellationToken cancellationToken);
}

public sealed class OutboxProcessorService(
    IOutboxRepository outboxRepository,
    IOrderRepository orderRepository,
    IMessageQueue messageQueue,
    IInventoryGateway inventoryGateway,
    IUnitOfWork unitOfWork,
    IDateTimeProvider clock,
    ILogger<OutboxProcessorService> logger) : IOutboxProcessorService
{
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan LockDuration = TimeSpan.FromSeconds(30);

    public async Task<int> ProcessPendingBatchAsync(
        string workerId,
        int batchSize,
        CancellationToken cancellationToken)
    {
        var utcNow = clock.UtcNow;
        var messages = await outboxRepository.AcquirePendingBatchAsync(
            workerId,
            batchSize,
            utcNow,
            LockDuration,
            cancellationToken);

        foreach (var message in messages)
        {
            await ProcessSingleMessageAsync(message.OrderId, workerId, cancellationToken);
        }

        return messages.Count;
    }

    private async Task ProcessSingleMessageAsync(
        Guid orderId,
        string workerId,
        CancellationToken cancellationToken)
    {
        using var scope = logger.BeginScope(new Dictionary<string, object>
        {
            ["OrderId"] = orderId,
            ["WorkerId"] = workerId
        });

        var message = await outboxRepository.GetByOrderIdAsync(orderId, cancellationToken);
        if (message is null)
        {
            return;
        }

        var order = await orderRepository.GetByIdAsync(orderId, cancellationToken);
        if (order is null || order.Status == OrderStatus.PedidoAbortado)
        {
            message.Cancel();
            await unitOfWork.SaveChangesAsync(cancellationToken);
            logger.OutboxSkippedAborted(workerId, orderId);
            return;
        }

        var attemptNumber = message.RetryCount + 1;
        var stopwatch = Stopwatch.StartNew();

        logger.InventoryDispatchAttempt(
            workerId,
            orderId,
            attemptNumber,
            order.Items.Count,
            order.TotalAmount);

        try
        {
            var queueMessage = new QueueMessage(
                message.Id,
                order.Id,
                message.EventType,
                message.PayloadJson,
                clock.UtcNow);

            var enqueueResult = await messageQueue.EnqueueUniqueAsync(queueMessage, cancellationToken);
            if (!enqueueResult.Accepted)
            {
                throw new InvalidOperationException(enqueueResult.Reason);
            }

            if (enqueueResult.AlreadyExisted)
            {
                logger.LogWarning(
                    "[QUEUE_UNIQUENESS_ENFORCED] Worker={WorkerId} | Pedido={OrderId} já possuía mensagem ativa na fila.",
                    workerId,
                    orderId);
            }

            var command = new InventoryReservationCommand(
                order.Id,
                order.CustomerName,
                order.TotalAmount,
                order.Items.Select(i => new InventoryReservationItem(
                    i.ProductName,
                    i.Quantity,
                    i.UnitPrice)).ToList());

            await inventoryGateway.ReserveAsync(command, cancellationToken);
            await messageQueue.AcknowledgeAsync(order.Id, cancellationToken);

            var completedAt = clock.UtcNow;
            order.MarkInventoryReserved(completedAt);
            message.MarkDispatched(completedAt);
            await unitOfWork.SaveChangesAsync(cancellationToken);

            stopwatch.Stop();
            logger.InventoryDispatchSucceeded(
                workerId,
                orderId,
                attemptNumber,
                stopwatch.ElapsedMilliseconds,
                completedAt);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            stopwatch.Stop();
            var retryNow = clock.UtcNow;
            message.ScheduleRetry(retryNow, RetryDelay, ex.Message);
            await unitOfWork.SaveChangesAsync(cancellationToken);

            logger.InventoryDispatchFailedAndRetryScheduled(
                ex,
                workerId,
                orderId,
                message.RetryCount,
                stopwatch.ElapsedMilliseconds,
                message.NextRetryAtUtc,
                (int)RetryDelay.TotalSeconds,
                ex.Message);
        }
    }
}
