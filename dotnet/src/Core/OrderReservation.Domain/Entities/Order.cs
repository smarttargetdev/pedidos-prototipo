using OrderReservation.Domain.Enums;
using OrderReservation.Domain.Exceptions;

namespace OrderReservation.Domain.Entities;

public sealed class Order
{
    private readonly List<OrderItem> _items = [];

    private Order() { }

    public Guid Id { get; private set; }
    public string CustomerName { get; private set; } = string.Empty;
    public string CustomerEmail { get; private set; } = string.Empty;
    public OrderStatus Status { get; private set; }
    public decimal TotalAmount { get; private set; }
    public DateTime PedidoCriadoAtUtc { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }
    public IReadOnlyCollection<OrderItem> Items => _items.AsReadOnly();

    public static Order Create(
        string customerName,
        string customerEmail,
        IEnumerable<(string ProductName, int Quantity, decimal UnitPrice)> items,
        bool aborted,
        DateTime utcNow)
    {
        if (string.IsNullOrWhiteSpace(customerName))
        {
            throw new DomainException("O nome do cliente é obrigatório.");
        }

        if (string.IsNullOrWhiteSpace(customerEmail))
        {
            throw new DomainException("O e-mail do cliente é obrigatório.");
        }

        var itemInputs = items?.ToList() ?? [];
        if (itemInputs.Count == 0)
        {
            throw new DomainException("O pedido deve conter ao menos um item.");
        }

        var orderId = Guid.CreateVersion7();
        var order = new Order
        {
            Id = orderId,
            CustomerName = customerName.Trim(),
            CustomerEmail = customerEmail.Trim(),
            Status = aborted ? OrderStatus.PedidoAbortado : OrderStatus.PedidoCriado,
            PedidoCriadoAtUtc = utcNow,
            CreatedAtUtc = utcNow,
            UpdatedAtUtc = utcNow
        };

        foreach (var item in itemInputs)
        {
            order._items.Add(OrderItem.Create(orderId, item.ProductName, item.Quantity, item.UnitPrice));
        }

        order.TotalAmount = decimal.Round(
            order._items.Sum(i => i.Subtotal),
            2,
            MidpointRounding.AwayFromZero);

        return order;
    }

    public void Abort(DateTime utcNow)
    {
        if (Status == OrderStatus.EstoqueReservado)
        {
            throw new DomainException("Não é possível abortar um pedido cujo estoque já foi reservado.");
        }

        if (Status == OrderStatus.PedidoAbortado)
        {
            return;
        }

        Status = OrderStatus.PedidoAbortado;
        UpdatedAtUtc = utcNow;
    }

    public void MarkInventoryReserved(DateTime utcNow)
    {
        if (Status == OrderStatus.PedidoAbortado)
        {
            throw new DomainException("Pedidos abortados não podem ser marcados como reservados.");
        }

        Status = OrderStatus.EstoqueReservado;
        UpdatedAtUtc = utcNow;
    }
}
