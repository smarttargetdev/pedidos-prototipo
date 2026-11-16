namespace OrderReservation.Application.Abstractions;

public sealed record InventoryReservationItem(string ProductName, int Quantity, decimal UnitPrice);

public sealed record InventoryReservationCommand(
    Guid OrderId,
    string CustomerName,
    decimal TotalAmount,
    IReadOnlyCollection<InventoryReservationItem> Items);

public interface IInventoryGateway
{
    Task ReserveAsync(InventoryReservationCommand command, CancellationToken cancellationToken);
}
