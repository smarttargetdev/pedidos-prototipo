using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OrderReservation.Application.Abstractions;
using OrderReservation.Application.Services;
using OrderReservation.Infrastructure.Integrations;
using OrderReservation.Infrastructure.Messaging;
using OrderReservation.Infrastructure.Persistence;
using OrderReservation.Infrastructure.Persistence.Repositories;
using OrderReservation.Infrastructure.Time;

namespace OrderReservation.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddOrderReservationInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? "Data Source=order_reservation.db";

        services.AddDbContext<AppDbContext>(options =>
            options.UseSqlite(connectionString));

        services.Configure<SimulatedQueueOptions>(configuration.GetSection("SimulatedQueue"));
        services.Configure<MockInventoryOptions>(configuration.GetSection("MockInventory"));

        services.AddSingleton<IDateTimeProvider, SystemDateTimeProvider>();
        services.AddSingleton<IMessageQueue, SimulatedMessageQueue>();
        services.AddScoped<IInventoryGateway, MockInventoryGateway>();

        services.AddScoped<IOrderRepository, OrderRepository>();
        services.AddScoped<IOutboxRepository, OutboxRepository>();
        services.AddScoped<IUnitOfWork, UnitOfWork>();

        services.AddScoped<IOrderService, OrderService>();
        services.AddScoped<IOutboxProcessorService, OutboxProcessorService>();

        return services;
    }

    public static async Task InitializeDatabaseAsync(this IServiceProvider serviceProvider)
    {
        using var scope = serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await dbContext.Database.EnsureCreatedAsync();
        await dbContext.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");
    }
}
