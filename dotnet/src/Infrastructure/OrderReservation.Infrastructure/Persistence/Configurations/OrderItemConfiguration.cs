using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OrderReservation.Domain.Entities;

namespace OrderReservation.Infrastructure.Persistence.Configurations;

public sealed class OrderItemConfiguration : IEntityTypeConfiguration<OrderItem>
{
    public void Configure(EntityTypeBuilder<OrderItem> builder)
    {
        builder.ToTable("OrderItems");
        builder.HasKey(i => i.Id);

        builder.Property(i => i.ProductName)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(i => i.Quantity)
            .IsRequired();

        builder.Property(i => i.UnitPrice)
            .IsRequired()
            .HasPrecision(18, 2);

        builder.Property(i => i.Subtotal)
            .IsRequired()
            .HasPrecision(18, 2);
    }
}
