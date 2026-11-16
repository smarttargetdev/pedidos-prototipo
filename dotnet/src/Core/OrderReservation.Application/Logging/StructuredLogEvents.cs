using Microsoft.Extensions.Logging;

namespace OrderReservation.Application.Logging;

public static partial class StructuredLogEvents
{
    [LoggerMessage(
        EventId = 1001,
        Level = LogLevel.Information,
        Message = "[ORDER_CREATED] Pedido {OrderId} criado | Cliente={CustomerName} ({CustomerEmail}) | Itens={ItemCount} | Total={TotalAmount:F2} | Status={Status} | StampPedidoCriado={PedidoCriadoAtUtc:O} | OutboxGerada={OutboxCreated}")]
    public static partial void OrderCreated(
        this ILogger logger,
        Guid orderId,
        string customerName,
        string customerEmail,
        int itemCount,
        decimal totalAmount,
        string status,
        DateTime pedidoCriadoAtUtc,
        bool outboxCreated);

    [LoggerMessage(
        EventId = 1002,
        Level = LogLevel.Warning,
        Message = "[ORDER_ABORTED] Pedido {OrderId} abortado em {AbortedAtUtc:O} | OutboxCancelada={OutboxCancelled} | EstoqueNotificado=false")]
    public static partial void OrderAborted(
        this ILogger logger,
        Guid orderId,
        DateTime abortedAtUtc,
        bool outboxCancelled);

    [LoggerMessage(
        EventId = 2001,
        Level = LogLevel.Information,
        Message = "[INVENTORY_DISPATCH_ATTEMPT] Worker={WorkerId} | Pedido={OrderId} | Tentativa={AttemptNumber} | Itens={ItemCount} | Total={TotalAmount:F2}")]
    public static partial void InventoryDispatchAttempt(
        this ILogger logger,
        string workerId,
        Guid orderId,
        int attemptNumber,
        int itemCount,
        decimal totalAmount);

    [LoggerMessage(
        EventId = 2002,
        Level = LogLevel.Information,
        Message = "[INVENTORY_DISPATCH_SUCCEEDED] Worker={WorkerId} | Pedido={OrderId} | Tentativa={AttemptNumber} | DuracaoMs={DurationMs} | ConcluidoEm={CompletedAtUtc:O}")]
    public static partial void InventoryDispatchSucceeded(
        this ILogger logger,
        string workerId,
        Guid orderId,
        int attemptNumber,
        long durationMs,
        DateTime completedAtUtc);

    [LoggerMessage(
        EventId = 2003,
        Level = LogLevel.Error,
        Message = "[INVENTORY_DISPATCH_FAILED] Worker={WorkerId} | Pedido={OrderId} | Tentativa={AttemptNumber} | DuracaoMs={DurationMs} | ProximaRetentativaUtc={NextRetryAtUtc:O} | AtrasoSegundos={RetryDelaySeconds} | Erro={ErrorMessage}")]
    public static partial void InventoryDispatchFailedAndRetryScheduled(
        this ILogger logger,
        Exception exception,
        string workerId,
        Guid orderId,
        int attemptNumber,
        long durationMs,
        DateTime? nextRetryAtUtc,
        int retryDelaySeconds,
        string errorMessage);

    [LoggerMessage(
        EventId = 2004,
        Level = LogLevel.Warning,
        Message = "[OUTBOX_SKIPPED_ABORTED] Worker={WorkerId} | Pedido={OrderId} está PedidoAbortado; envio ao sistema de estoque bloqueado.")]
    public static partial void OutboxSkippedAborted(
        this ILogger logger,
        string workerId,
        Guid orderId);
}
