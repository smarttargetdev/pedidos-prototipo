using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OrderReservation.Application.Abstractions;
using OrderReservation.Application.Logging;

namespace OrderReservation.Infrastructure.Integrations;

public sealed class WebhookOptions
{
    public bool Enabled { get; set; }
    public string EndpointUrl { get; set; } = string.Empty;
    public string? HmacSecret { get; set; }
    public bool NotifyOnEstoqueReservado { get; set; } = true;
    public bool NotifyOnPedidoCancelado { get; set; } = true;
    public int TimeoutSeconds { get; set; } = 5;
}

public sealed class HttpWebhookNotifier(
    IHttpClientFactory httpClientFactory,
    IOptionsMonitor<WebhookOptions> optionsMonitor,
    ILogger<HttpWebhookNotifier> logger) : IWebhookNotifier
{
    public async Task NotifyAsync(WebhookNotification notification, CancellationToken cancellationToken)
    {
        var options = optionsMonitor.CurrentValue;
        if (!options.Enabled || string.IsNullOrWhiteSpace(options.EndpointUrl))
        {
            return;
        }

        if (notification.EventType == "EstoqueReservado" && !options.NotifyOnEstoqueReservado)
        {
            return;
        }

        if (notification.EventType == "PedidoCancelado" && !options.NotifyOnPedidoCancelado)
        {
            return;
        }

        var payloadJson = JsonSerializer.Serialize(new
        {
            eventType = notification.EventType,
            orderId = notification.OrderId,
            customerName = notification.CustomerName,
            totalAmount = notification.TotalAmount,
            occurredAtUtc = notification.OccurredAtUtc,
            items = notification.Items
        });

        var stopwatch = Stopwatch.StartNew();
        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(options.TimeoutSeconds, 1, 30)));

            var client = httpClientFactory.CreateClient("WebhookClient");
            using var request = new HttpRequestMessage(HttpMethod.Post, options.EndpointUrl)
            {
                Content = new StringContent(payloadJson, Encoding.UTF8, "application/json")
            };

            request.Headers.Add("X-OrderReservation-Event", notification.EventType);

            if (!string.IsNullOrWhiteSpace(options.HmacSecret))
            {
                var signature = ComputeHmacSha256(payloadJson, options.HmacSecret);
                request.Headers.Add("X-OrderReservation-Signature", $"sha256={signature}");
            }

            using var response = await client.SendAsync(request, timeoutCts.Token);
            stopwatch.Stop();

            if (response.IsSuccessStatusCode)
            {
                logger.WebhookDeliverySucceeded(
                    notification.EventType,
                    notification.OrderId,
                    options.EndpointUrl,
                    (int)response.StatusCode,
                    stopwatch.ElapsedMilliseconds);
            }
            else
            {
                logger.WebhookDeliveryFailed(
                    null,
                    notification.EventType,
                    notification.OrderId,
                    options.EndpointUrl,
                    stopwatch.ElapsedMilliseconds,
                    $"HTTP {(int)response.StatusCode} ({response.ReasonPhrase})");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            stopwatch.Stop();
            logger.WebhookDeliveryFailed(
                ex,
                notification.EventType,
                notification.OrderId,
                options.EndpointUrl,
                stopwatch.ElapsedMilliseconds,
                ex.Message);
        }
    }

    private static string ComputeHmacSha256(string payload, string secret)
    {
        var keyBytes = Encoding.UTF8.GetBytes(secret);
        var payloadBytes = Encoding.UTF8.GetBytes(payload);
        var hash = HMACSHA256.HashData(keyBytes, payloadBytes);
        return Convert.ToHexStringLower(hash);
    }
}
