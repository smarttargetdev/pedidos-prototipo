using OrderReservation.Infrastructure;
using OrderReservation.Infrastructure.Logging;
using worker.Workers;

var builder = Host.CreateApplicationBuilder(args);

builder.ConfigureOrderReservationLogging("worker");

builder.Services.AddOrderReservationInfrastructure(builder.Configuration);
builder.Services.AddHostedService<OutboxBackgroundWorker>();

var host = builder.Build();

await host.Services.InitializeDatabaseAsync();
await host.RunAsync();
