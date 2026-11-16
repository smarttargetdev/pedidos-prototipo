using api.Middleware;
using OrderReservation.Infrastructure;
using OrderReservation.Infrastructure.Logging;

var builder = WebApplication.CreateBuilder(args);

builder.ConfigureOrderReservationLogging("api");

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddExceptionHandler<DomainExceptionHandler>();
builder.Services.AddProblemDetails();
builder.Services.AddOrderReservationInfrastructure(builder.Configuration);

var app = builder.Build();

await app.Services.InitializeDatabaseAsync();

app.UseExceptionHandler();

var swaggerEnabled = app.Configuration.GetValue("Swagger:Enabled", true);
var swaggerRoutePrefix = app.Configuration["Swagger:RoutePrefix"] ?? "swagger";

if (app.Environment.IsDevelopment() || swaggerEnabled)
{
    app.MapOpenApi();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/openapi/v1.json", "OrderReservation API v1");
        options.RoutePrefix = swaggerRoutePrefix;
        options.DocumentTitle = "OrderReservation API - Swagger UI";
    });
}

app.MapControllers();

await app.RunAsync();

public partial class Program;
