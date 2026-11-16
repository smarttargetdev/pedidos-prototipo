using Microsoft.Extensions.Options;
using OrderReservation.Application.Abstractions;

namespace OrderReservation.Infrastructure.Options;

public sealed class OutboxWorkerOptions
{
    public int MaxRetryAttempts { get; set; } = 5;
}

public sealed class OptionsOutboxRetryPolicy(IOptionsMonitor<OutboxWorkerOptions> optionsMonitor)
    : IOutboxRetryPolicy
{
    public int MaxRetryAttempts => Math.Clamp(optionsMonitor.CurrentValue.MaxRetryAttempts, 1, 50);
}
