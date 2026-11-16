# OrderReservation (.NET 10 + SQLite + SOLID)

Solução completa em **.NET 10** (`net10.0`) composta pelos projetos **api** e **worker**, estruturada com Clean Architecture, SOLID, EF Core 10 com SQLite e padrão **Transactional Outbox**.

## Projetos

- **OrderReservation.Domain**: Entidades `Order`, `OrderItem`, `OutboxMessage` e enums `OrderStatus` (`PedidoCriado`, `PedidoCancelado`, `EstoqueReservado`) e `OutboxStatus`.
- **OrderReservation.Application**: Casos de uso (`OrderService`, `OutboxProcessorService`) e abstrações (`IOrderRepository`, `IOutboxRepository`, `IUnitOfWork`, `IMessageQueue`, `IInventoryGateway`, `IWebhookNotifier`, `IOutboxRetryPolicy`).
- **OrderReservation.Infrastructure**: `AppDbContext` (EF Core 10 + SQLite em modo WAL), configurações Fluent API com índice `UNIQUE` em `OrderId`, aquisição atômica de lease via `ExecuteUpdateAsync`, `SimulatedMessageQueue` idempotente e `MockInventoryGateway` com falha simulada.
- **api**: Web API REST (`POST /api/orders`, `GET /api/orders/{id}`, `POST /api/orders/{id}/cancel`).
- **worker**: `BackgroundService` (`OutboxBackgroundWorker`) com polling periódico, proteção contra envio simultâneo por lease, unicidade na fila e retentativa fixa de **60 segundos** após falhas.

## Logging Estruturado (API & Worker)

Ambos os projetos configuram `Serilog` via `ConfigureOrderReservationLogging(serviceName)` com enriquecimento (`ServiceName`, `MachineName`, `OrderId`, `WorkerId`) e eventos source-generated (`StructuredLogEvents`):
- `[ORDER_CREATED]` — Criação do pedido com cliente, quantidade de itens, total calculado, stamp `PedidoCriado` e status de criação na Outbox.
- `[ORDER_CANCELLED]` / `[OUTBOX_SKIPPED_CANCELLED]` — Cancelamento e bloqueio de notificação ao estoque.
- `[INVENTORY_DISPATCH_ATTEMPT]` — Tentativa de envio ao estoque mockado.
- `[INVENTORY_DISPATCH_SUCCEEDED]` — Confirmação com duração (`DurationMs`) e timestamp UTC.
- `[INVENTORY_DISPATCH_FAILED]` — Erro detalhado, contagem de tentativas e agendamento da próxima retentativa em +60s.

Os logs são gravados no console padronizado e em arquivos rotativos NDJSON (`logs/api-*.ndjson` e `logs/worker-*.ndjson`) para análise posterior.

## Execução Local (.NET 10 SDK)

```bash
cd dotnet
dotnet restore
dotnet test
dotnet run --project src/api
# Em outro terminal:
dotnet run --project src/worker
```

## Suíte de Testes (`api.Tests` e `worker.Tests`)

- **api.Tests**: Testes unitários de validação de domínio/pedidos (`OrderValidationTests`) e testes de integração HTTP + SQLite com `WebApplicationFactory<Program>` (`OrdersApiIntegrationTests`).
- **worker.Tests**: Testes unitários da lógica de processamento e retry (`OutboxProcessorServiceTests`) e testes de integração com SQLite real validando falha no estoque, janela exata de 60 segundos para retentativa, lock contra envio simultâneo e unicidade na fila (`OutboxWorkerIntegrationTests`).
