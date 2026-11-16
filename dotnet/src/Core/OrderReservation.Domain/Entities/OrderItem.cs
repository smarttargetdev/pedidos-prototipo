using OrderReservation.Domain.Exceptions;

namespace OrderReservation.Domain.Entities;

public sealed class OrderItem
{
    private OrderItem() { }

    public Guid Id { get; private set; }
    public Guid OrderId { get; private set; }
    public string ProductName { get; private set; } = string.Empty;
    public int Quantity { get; private set; }
    public decimal UnitPrice { get; private set; }
    public decimal Subtotal { get; private set; }

    public static OrderItem Create(Guid orderId, string productName, int quantity, decimal unitPrice)
    {
        if (string.IsNullOrWhiteSpace(productName))
        {
            throw new DomainException("O nome do produto é obrigatório.");
        }

        if (quantity <= 0)
        {
            throw new DomainException("A quantidade do item deve ser maior que zero.");
        }

        if (unitPrice < 0)
        {
            throw new DomainException("O preço unitário não pode ser negativo.");
        }

        var normalizedUnitPrice = decimal.Round(unitPrice, 2, MidpointRounding.AwayFromZero);

        return new OrderItem
        {
            Id = Guid.CreateVersion7(),
            OrderId = orderId,
            ProductName = productName.Trim(),
            Quantity = quantity,
            UnitPrice = normalizedUnitPrice,
            Subtotal = decimal.Round(quantity * normalizedUnitPrice, 2, MidpointRounding.AwayFromZero)
        };
    }
}
