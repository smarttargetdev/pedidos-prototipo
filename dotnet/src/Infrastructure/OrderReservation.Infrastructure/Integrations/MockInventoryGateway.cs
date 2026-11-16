using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OrderReservation.Application.Abstractions;

namespace OrderReservation.Infrastructure.Integrations;

public sealed class MockInventoryOptions
{
    public double FailureRate { get; set; } = 0.35;
}

public sealed class MockInventoryGateway(
    IOptionsMonitor<MockInventoryOptions> options,
    ILogger<MockInventoryGateway> logger) : IInventoryGateway
{
    public Task ReserveAsync(InventoryReservationCommand command, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var failureRate = options.CurrentValue.FailureRate;
        if (failureRate > 0 && Random.Shared.NextDouble() < failureRate)
        {
            logger.LogWarning(
                "[MockInventoryGateway] Falha simulada (503) ao reservar estoque para Pedido {OrderId}.",
                command.OrderId);
            throw new HttpRequestException(
                $"Sistema de estoque externo indisponível para o pedido {command.OrderId}.");
        }

        logger.LogInformation(
            "[MockInventoryGateway] Estoque reservado para Pedido {OrderId} | Cliente={Customer} | Itens={ItemCount} | Total={Total:C}",
            command.OrderId,
            command.CustomerName,
            command.Items.Count,
            command.TotalAmount);

        return Task.CompletedTask;
    }
}
