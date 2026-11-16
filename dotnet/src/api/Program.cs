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

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapControllers();

await app.RunAsync();

public partial class Program;
