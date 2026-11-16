namespace OrderReservation.Domain.Exceptions;

public class DomainException(string message) : Exception(message);

public sealed class OrderNotFoundException(Guid orderId)
    : DomainException($"Pedido '{orderId}' não foi encontrado.");
