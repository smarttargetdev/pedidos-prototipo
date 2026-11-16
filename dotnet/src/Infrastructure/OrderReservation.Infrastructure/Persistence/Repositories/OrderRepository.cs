using Microsoft.EntityFrameworkCore;
using OrderReservation.Application.Abstractions;
using OrderReservation.Domain.Entities;

namespace OrderReservation.Infrastructure.Persistence.Repositories;

public sealed class OrderRepository(AppDbContext dbContext) : IOrderRepository
{
    public Task AddAsync(Order order, CancellationToken cancellationToken)
        => dbContext.Orders.AddAsync(order, cancellationToken).AsTask();

    public Task<Order?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
        => dbContext.Orders
            .Include(o => o.Items)
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken);
}
