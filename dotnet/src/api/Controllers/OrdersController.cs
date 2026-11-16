using Microsoft.AspNetCore.Mvc;
using OrderReservation.Application.DTOs;
using OrderReservation.Application.Services;

namespace api.Controllers;

[ApiController]
[Route("api/orders")]
public sealed class OrdersController(IOrderService orderService) : ControllerBase
{
    [HttpPost]
    [ProducesResponseType<OrderResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<OrderResponse>> CreateOrder(
        [FromBody] CreateOrderRequest request,
        CancellationToken cancellationToken)
    {
        var order = await orderService.CreateOrderAsync(request, cancellationToken);
        return CreatedAtAction(nameof(GetOrderById), new { id = order.Id }, order);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType<OrderResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderResponse>> GetOrderById(
        Guid id,
        CancellationToken cancellationToken)
    {
        var order = await orderService.GetOrderByIdAsync(id, cancellationToken);
        return Ok(order);
    }

    [HttpPost("{id:guid}/abort")]
    [ProducesResponseType<OrderResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderResponse>> AbortOrder(
        Guid id,
        CancellationToken cancellationToken)
    {
        var order = await orderService.AbortOrderAsync(id, cancellationToken);
        return Ok(order);
    }
}
