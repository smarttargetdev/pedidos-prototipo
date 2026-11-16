using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using OrderReservation.Domain.Exceptions;

namespace api.Middleware;

public sealed class DomainExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        if (exception is not DomainException domainException)
        {
            return false;
        }

        var statusCode = domainException is OrderNotFoundException
            ? StatusCodes.Status404NotFound
            : StatusCodes.Status400BadRequest;

        httpContext.Response.StatusCode = statusCode;
        await httpContext.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Status = statusCode,
            Title = statusCode == StatusCodes.Status404NotFound
                ? "Recurso não encontrado"
                : "Regra de negócio violada",
            Detail = domainException.Message
        }, cancellationToken);

        return true;
    }
}
