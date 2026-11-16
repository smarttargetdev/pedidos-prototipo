using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OrderReservation.Application.DTOs;
using OrderReservation.Domain.Enums;
using OrderReservation.Infrastructure.Persistence;

namespace api.Tests.Integration;

public sealed class OrdersApiWebFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string _dbPath = Path.Combine(
        Path.GetTempPath(),
        $"orders_api_test_{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = $"Data Source={_dbPath}",
                ["Logging:StructuredFilePath"] = Path.Combine(Path.GetTempPath(), $"api_test_{Guid.NewGuid():N}.ndjson")
            });
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public new async Task DisposeAsync()
    {
        await base.DisposeAsync();
        if (File.Exists(_dbPath))
        {
            File.Delete(_dbPath);
        }
    }
}

public sealed class OrdersApiIntegrationTests(OrdersApiWebFactory factory)
    : IClassFixture<OrdersApiWebFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PostOrder_ShouldPersistOrderItemsAndOutboxInSqlite_AndAllowGetById()
    {
        var payload = new CreateOrderRequest(
            "Juliana Ribeiro",
            "juliana@loja.com.br",
            [
                new OrderItemRequest("Cadeira Ergonômica", 1, 1450.00m),
                new OrderItemRequest("Suporte Notebook", 2, 125.00m)
            ],
            Cancelado: false);

        var postResponse = await _client.PostAsJsonAsync("/api/orders", payload);
        Assert.Equal(HttpStatusCode.Created, postResponse.StatusCode);

        var created = await postResponse.Content.ReadFromJsonAsync<OrderResponse>();
        Assert.NotNull(created);
        Assert.Equal(1700.00m, created!.TotalAmount);
        Assert.Equal(nameof(OrderStatus.PedidoCriado), created.Status);
        Assert.NotNull(created.Outbox);

        // Consulta pelo identificador único via GET /api/orders/{id}
        var getResponse = await _client.GetAsync($"/api/orders/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);

        var fetched = await getResponse.Content.ReadFromJsonAsync<OrderResponse>();
        Assert.NotNull(fetched);
        Assert.Equal(created.Id, fetched!.Id);
        Assert.Equal(2, fetched.Items.Count);

        // Valida persistência direta no banco relacional SQLite
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var dbOrder = await db.Orders.Include(o => o.Items).FirstOrDefaultAsync(o => o.Id == created.Id);
        var dbOutbox = await db.OutboxMessages.FirstOrDefaultAsync(m => m.OrderId == created.Id);

        Assert.NotNull(dbOrder);
        Assert.Equal(OrderStatus.PedidoCriado, dbOrder!.Status);
        Assert.NotNull(dbOutbox);
        Assert.Equal(OutboxStatus.Pending, dbOutbox!.Status);
    }

    [Fact]
    public async Task PostOrder_WithCanceladoTrue_ShouldPersistWithoutOutboxInSqlite()
    {
        var payload = new CreateOrderRequest(
            "Roberto Lima",
            "roberto@loja.com.br",
            [new OrderItemRequest("Webcam 4K", 1, 599.00m)],
            Cancelado: true);

        var postResponse = await _client.PostAsJsonAsync("/api/orders", payload);
        Assert.Equal(HttpStatusCode.Created, postResponse.StatusCode);

        var created = await postResponse.Content.ReadFromJsonAsync<OrderResponse>();
        Assert.NotNull(created);
        Assert.Equal(nameof(OrderStatus.PedidoCancelado), created!.Status);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var dbOutbox = await db.OutboxMessages.FirstOrDefaultAsync(m => m.OrderId == created.Id);
        Assert.Null(dbOutbox);
    }

    [Fact]
    public async Task PostCancelOrder_ShouldCancelPendingOutboxInSqlite()
    {
        var payload = new CreateOrderRequest(
            "Patricia Gomes",
            "patricia@loja.com.br",
            [new OrderItemRequest("Dock Station", 1, 890.00m)],
            Cancelado: false);

        var created = await (await _client.PostAsJsonAsync("/api/orders", payload))
            .Content.ReadFromJsonAsync<OrderResponse>();
        Assert.NotNull(created);

        var cancelResponse = await _client.PostAsync($"/api/orders/{created!.Id}/cancel", null);
        Assert.Equal(HttpStatusCode.OK, cancelResponse.StatusCode);

        var cancelled = await cancelResponse.Content.ReadFromJsonAsync<OrderResponse>();
        Assert.Equal(nameof(OrderStatus.PedidoCancelado), cancelled!.Status);
        Assert.Equal(nameof(OutboxStatus.Cancelled), cancelled.Outbox!.Status);
    }

    [Fact]
    public async Task GetOrderById_WhenMissing_ShouldReturn404()
    {
        var response = await _client.GetAsync($"/api/orders/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task PostOrder_WithEmptyItems_ShouldReturn400()
    {
        var payload = new CreateOrderRequest("Sem Itens", "a@b.com", [], false);
        var response = await _client.PostAsJsonAsync("/api/orders", payload);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
