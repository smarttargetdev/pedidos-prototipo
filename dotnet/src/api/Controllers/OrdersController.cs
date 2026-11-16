using Microsoft.AspNetCore.Mvc;
using OrderReservation.Application.DTOs;
using OrderReservation.Application.Services;

namespace api.Controllers;

[ApiController]
[Route("api/orders")]
public sealed class OrdersController(IOrderService orderService) : ControllerBase
{
    [HttpPost]
    [EndpointSummary("Criar pedido")]
    [EndpointDescription("Registra um novo pedido com itens detalhados, calcula o total no servidor, aplica o stamp PedidoCriado e grava a mensagem na Transactional Outbox (exceto quando cancelado=true).")]
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
    [EndpointSummary("Consultar pedido por ID")]
    [EndpointDescription("Retorna os dados completos de um pedido pelo seu identificador único (Guid), incluindo itens e status atual da Outbox.")]
    [ProducesResponseType<OrderResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderResponse>> GetOrderById(
        Guid id,
        CancellationToken cancellationToken)
    {
        var order = await orderService.GetOrderByIdAsync(id, cancellationToken);
        return Ok(order);
    }

    [HttpPost("{id:guid}/cancel")]
    [HttpPost("{id:guid}/abort")]
    [EndpointSummary("Cancelar pedido antes do envio ao estoque")]
    [EndpointDescription("Altera o status do pedido para PedidoCancelado e cancela a mensagem pendente na Outbox, impedindo a notificação ao estoque.")]
    [ProducesResponseType<OrderResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderResponse>> CancelOrder(
        Guid id,
        CancellationToken cancellationToken)
    {
        var order = await orderService.CancelOrderAsync(id, cancellationToken);
        return Ok(order);
    }
}
