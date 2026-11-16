using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Serilog;
using Serilog.Events;
using Serilog.Formatting.Compact;

namespace OrderReservation.Infrastructure.Logging;

public static class LoggingExtensions
{
    private const string ConsoleTemplate =
        "[{Timestamp:yyyy-MM-dd HH:mm:ss.fff} UTC] [{Level:u3}] [{ServiceName}] {Message:lj} {Properties:j}{NewLine}{Exception}";

    public static IHostApplicationBuilder ConfigureOrderReservationLogging(
        this IHostApplicationBuilder builder,
        string serviceName)
    {
        var logFilePath = builder.Configuration["Logging:StructuredFilePath"]
            ?? $"logs/{serviceName}-.ndjson";

        var loggerConfig = new LoggerConfiguration()
            .ReadFrom.Configuration(builder.Configuration)
            .MinimumLevel.Override("Microsoft.EntityFrameworkCore.Database.Command", LogEventLevel.Warning)
            .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .Enrich.WithProperty("ServiceName", serviceName)
            .Enrich.WithProperty("MachineName", Environment.MachineName)
            .WriteTo.Console(outputTemplate: ConsoleTemplate)
            .WriteTo.File(
                new CompactJsonFormatter(),
                path: logFilePath,
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 14,
                shared: true);

        Log.Logger = loggerConfig.CreateLogger();
        builder.Services.AddSerilog(Log.Logger, dispose: true);

        return builder;
    }
}
