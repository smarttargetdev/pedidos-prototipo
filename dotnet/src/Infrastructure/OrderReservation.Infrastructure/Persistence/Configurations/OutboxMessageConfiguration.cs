using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OrderReservation.Domain.Entities;

namespace OrderReservation.Infrastructure.Persistence.Configurations;

public sealed class OutboxMessageConfiguration : IEntityTypeConfiguration<OutboxMessage>
{
    public void Configure(EntityTypeBuilder<OutboxMessage> builder)
    {
        builder.ToTable("OutboxMessages");
        builder.HasKey(m => m.Id);

        builder.Property(m => m.OrderId)
            .IsRequired();

        // Garante unicidade da mensagem na Outbox por pedido
        builder.HasIndex(m => m.OrderId)
            .IsUnique();

        builder.Property(m => m.EventType)
            .IsRequired()
            .HasMaxLength(64);

        builder.Property(m => m.PayloadJson)
            .IsRequired();

        builder.Property(m => m.Status)
            .IsRequired()
            .HasConversion<string>()
            .HasMaxLength(32);

        builder.Property(m => m.RetryCount)
            .IsRequired();

        builder.Property(m => m.LockedBy)
            .HasMaxLength(128);

        builder.Property(m => m.LastError)
            .HasMaxLength(1000);

        builder.HasIndex(m => new { m.Status, m.NextRetryAtUtc, m.LockedUntilUtc });
    }
}
