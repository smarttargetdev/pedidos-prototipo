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
        Message = "[ORDER_CANCELLED] Pedido {OrderId} cancelado em {CancelledAtUtc:O} | OutboxCancelada={OutboxCancelled} | EstoqueNotificado=false")]
    public static partial void OrderCancelled(
        this ILogger logger,
        Guid orderId,
        DateTime cancelledAtUtc,
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
        Message = "[OUTBOX_SKIPPED_CANCELLED] Worker={WorkerId} | Pedido={OrderId} está PedidoCancelado; envio ao sistema de estoque bloqueado.")]
    public static partial void OutboxSkippedCancelled(
        this ILogger logger,
        string workerId,
        Guid orderId);

    [LoggerMessage(
        EventId = 3001,
        Level = LogLevel.Information,
        Message = "[WEBHOOK_DELIVERY_SUCCEEDED] Evento={EventType} | Pedido={OrderId} | Url={EndpointUrl} | HttpStatus={HttpStatus} | DuracaoMs={DurationMs}")]
    public static partial void WebhookDeliverySucceeded(
        this ILogger logger,
        string eventType,
        Guid? orderId,
        string endpointUrl,
        int httpStatus,
        long durationMs);

    [LoggerMessage(
        EventId = 3002,
        Level = LogLevel.Error,
        Message = "[WEBHOOK_DELIVERY_FAILED] Evento={EventType} | Pedido={OrderId} | Url={EndpointUrl} | DuracaoMs={DurationMs} | Erro={ErrorMessage}")]
    public static partial void WebhookDeliveryFailed(
        this ILogger logger,
        Exception? exception,
        string eventType,
        Guid? orderId,
        string endpointUrl,
        long durationMs,
        string errorMessage);

    [LoggerMessage(
        EventId = 2005,
        Level = LogLevel.Error,
        Message = "[OUTBOX_MAX_RETRIES_EXCEEDED] Worker={WorkerId} | Pedido={OrderId} | Tentativas={AttemptCount}/{MaxRetryAttempts} | Erro={ErrorMessage}")]
    public static partial void OutboxMaxRetriesExceeded(
        this ILogger logger,
        Exception exception,
        string workerId,
        Guid orderId,
        int attemptCount,
        int maxRetryAttempts,
        string errorMessage);
}
