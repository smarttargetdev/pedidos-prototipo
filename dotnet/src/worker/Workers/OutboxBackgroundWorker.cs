using OrderReservation.Application.Services;

namespace worker.Workers;

public sealed class OutboxBackgroundWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<OutboxBackgroundWorker> logger) : BackgroundService
{
    private readonly string _workerId = $"{Environment.MachineName}-{Guid.NewGuid().ToString("N")[..8]}";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation(
            "Worker {WorkerId} iniciado. Aguardando mensagens PedidoCriado no SQLite Outbox...",
            _workerId);

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var processor = scope.ServiceProvider.GetRequiredService<IOutboxProcessorService>();
                var processedCount = await processor.ProcessPendingBatchAsync(
                    _workerId,
                    batchSize: 10,
                    stoppingToken);

                if (processedCount > 0)
                {
                    logger.LogInformation(
                        "Worker {WorkerId} finalizou ciclo processando {Count} mensagem(ns).",
                        _workerId,
                        processedCount);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Erro inesperado no ciclo do Worker {WorkerId}.", _workerId);
            }

            await timer.WaitForNextTickAsync(stoppingToken);
        }

        logger.LogInformation("Worker {WorkerId} encerrado com segurança.", _workerId);
    }
}
