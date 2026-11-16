using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OrderReservation.Domain.Entities;

namespace OrderReservation.Infrastructure.Persistence.Configurations;

public sealed class OrderConfiguration : IEntityTypeConfiguration<Order>
{
    public void Configure(EntityTypeBuilder<Order> builder)
    {
        builder.ToTable("Orders");
        builder.HasKey(o => o.Id);

        builder.Property(o => o.CustomerName)
            .IsRequired()
            .HasMaxLength(160);

        builder.Property(o => o.CustomerEmail)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(o => o.Status)
            .IsRequired()
            .HasConversion<string>()
            .HasMaxLength(32);

        builder.Property(o => o.TotalAmount)
            .IsRequired()
            .HasPrecision(18, 2);

        builder.Property(o => o.PedidoCriadoAtUtc)
            .IsRequired();

        builder.Property(o => o.CreatedAtUtc)
            .IsRequired();

        builder.Property(o => o.UpdatedAtUtc)
            .IsRequired();

        builder.HasMany(o => o.Items)
            .WithOne()
            .HasForeignKey(i => i.OrderId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(o => o.Items)
            .UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
