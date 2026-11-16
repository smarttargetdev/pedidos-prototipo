using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OrderReservation.Application.Abstractions;

namespace OrderReservation.Infrastructure.Messaging;

public sealed class SimulatedQueueOptions
{
    public bool SimulateOutage { get; set; }
}

public sealed class SimulatedMessageQueue(
    IOptionsMonitor<SimulatedQueueOptions> options,
    ILogger<SimulatedMessageQueue> logger) : IMessageQueue
{
    private readonly ConcurrentDictionary<Guid, QueueMessage> _activeMessages = new();

    public Task<EnqueueResult> EnqueueUniqueAsync(QueueMessage message, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (options.CurrentValue.SimulateOutage)
        {
            logger.LogWarning(
                "[SimulatedMessageQueue] Fila indisponível ao tentar enfileirar Pedido {OrderId}.",
                message.OrderId);
            return Task.FromResult(new EnqueueResult(false, false, "Message queue temporariamente indisponível."));
        }

        // Garante unicidade da mensagem na fila pelo OrderId
        var added = _activeMessages.TryAdd(message.OrderId, message);
        if (!added)
        {
            logger.LogWarning(
                "[SimulatedMessageQueue] Mensagem duplicada ignorada para o Pedido {OrderId}. Unicidade preservada.",
                message.OrderId);
            return Task.FromResult(new EnqueueResult(true, true, "Mensagem já presente na fila."));
        }

        logger.LogInformation(
            "[SimulatedMessageQueue] Mensagem {MessageId} enfileirada para o Pedido {OrderId} ({EventType}).",
            message.MessageId,
            message.OrderId,
            message.EventType);

        return Task.FromResult(new EnqueueResult(true, false, "Enfileirada com sucesso."));
    }

    public Task AcknowledgeAsync(Guid orderId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _activeMessages.TryRemove(orderId, out _);
        logger.LogInformation(
            "[SimulatedMessageQueue] ACK confirmado e mensagem removida da fila para o Pedido {OrderId}.",
            orderId);
        return Task.CompletedTask;
    }
}
