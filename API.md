# Documentação da API — Plataforma de Pedidos (.NET 10 + Simulador Web)

Referência completa dos contratos REST, especificação **OpenAPI 3.1**, interface **Swagger UI**, eventos de **Webhook** e endpoints operacionais do simulador.

---

## 1. Swagger UI e OpenAPI 3.1 (`.NET 10`)

O projeto `dotnet/src/api` expõe a especificação **OpenAPI 3.1** nativa (`Microsoft.AspNetCore.OpenApi`) integrada à interface interativa **Swagger UI** (`Swashbuckle.AspNetCore.SwaggerUI`):

- **Habilitação por padrão**: Configurado em `dotnet/src/api/appsettings.json` (`"Swagger": { "Enabled": true, "RoutePrefix": "swagger" }`) e `dotnet/src/api/Properties/launchSettings.json`, mantendo `/openapi/v1.json` e `/swagger` ativos tanto em `Development` quanto quando `Swagger:Enabled` estiver `true`.
- **URLs locais (`.NET 10`)**:
  - **Swagger UI**: `http://localhost:5150/swagger`
  - **Documento OpenAPI 3.1**: `http://localhost:5150/openapi/v1.json`
- **Metadados nos Controllers**: As actions de `OrdersController` utilizam `[EndpointSummary]`, `[EndpointDescription]` e `[ProducesResponseType<T>]` para documentar contratos de sucesso e erros RFC 7807 (`ProblemDetails`).

---

## 2. Endpoints de Negócio (`.NET 10` e Simulador Web)

Base URL local:
- **API `.NET 10`**: `http://localhost:5150`
- **Simulador Web**: `http://localhost:3000`

| Método | Rota | Descrição | Respostas |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/orders` | Cria um pedido, calcula `totalAmount` e `subtotal` no servidor, aplica o stamp `PedidoCriado` e grava na Outbox na mesma transação (exceto se `cancelado: true`). | `201 Created` (`OrderResponse`) · `400 Bad Request` (`ProblemDetails`) |
| `GET` | `/api/orders/{id}` | Consulta um pedido pelo identificador único (`Guid`), retornando itens e resumo da Outbox. | `200 OK` (`OrderResponse`) · `404 Not Found` (`ProblemDetails`) |
| `POST` | `/api/orders/{id}/cancel` | Cancela um pedido antes do envio final ao estoque (`PedidoCancelado` + Outbox `Cancelled`), bloqueando notificação ao estoque. *(Alias legado: `/api/orders/{id}/abort`)* | `200 OK` (`OrderResponse`) · `400 Bad Request` · `404 Not Found` |

### `POST /api/orders`

Cria um novo pedido. O cálculo de `subtotal` e `totalAmount` é realizado exclusivamente no servidor. Quando `cancelado` é `true`, o pedido é persistido com status `PedidoCancelado` e nenhuma mensagem é criada na tabela Outbox.

**Request (`application/json`)**:

```json
{
  "customerName": "Ana Beatriz Souza",
  "customerEmail": "ana.souza@exemplo.com.br",
  "cancelado": false,
  "items": [
    {
      "productName": "Teclado Mecânico TKL",
      "quantity": 1,
      "unitPrice": 489.90
    },
    {
      "productName": "Mouse Sem Fio Pro",
      "quantity": 2,
      "unitPrice": 215.00
    }
  ]
}
```

**Response `201 Created` (`application/json`)**:

```json
{
  "id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
  "customerName": "Ana Beatriz Souza",
  "customerEmail": "ana.souza@exemplo.com.br",
  "status": "PedidoCriado",
  "totalAmount": 919.90,
  "pedidoCriadoAtUtc": "2026-11-16T14:00:00.000Z",
  "createdAtUtc": "2026-11-16T14:00:00.000Z",
  "updatedAtUtc": "2026-11-16T14:00:00.000Z",
  "items": [
    {
      "id": "a1b2c3d4-0000-0000-0000-000000000001",
      "productName": "Teclado Mecânico TKL",
      "quantity": 1,
      "unitPrice": 489.90,
      "subtotal": 489.90
    },
    {
      "id": "a1b2c3d4-0000-0000-0000-000000000002",
      "productName": "Mouse Sem Fio Pro",
      "quantity": 2,
      "unitPrice": 215.00,
      "subtotal": 430.00
    }
  ],
  "outbox": {
    "id": "e7f8a9b0-0000-0000-0000-000000000003",
    "status": "Pending",
    "retryCount": 0,
    "nextRetryAtUtc": null,
    "lastError": null,
    "dispatchedAtUtc": null
  }
}
```

### `GET /api/orders/{id}`

Retorna os dados completos de um pedido pelo seu `Guid` (`200 OK`) ou `404 Not Found` caso não exista.

### `POST /api/orders/{id}/cancel`

Cancela um pedido ainda não enviado ao estoque. Altera o status do pedido para `PedidoCancelado` e marca a mensagem Outbox como `Cancelled` na mesma transação ACID.

**Erro de Regra / Validação (`400 Bad Request` / `404 Not Found` — RFC 7807 `ProblemDetails`)**:

```json
{
  "status": 400,
  "title": "Regra de negócio violada",
  "detail": "Não é possível cancelar um pedido cujo estoque já foi reservado."
}
```

---

## 3. Contratos de Webhook (`EstoqueReservado` e `PedidoCancelado`)

Quando habilitado, o servidor (`IWebhookNotifier` no `.NET 10` e dispatcher no Simulador Web) envia requisições `HTTP POST` não bloqueantes com timeout de 5 segundos.

**Cabeçalhos enviados**:
- `Content-Type: application/json`
- `X-OrderReservation-Event`: `EstoqueReservado` | `PedidoCancelado` | `WebhookTest`
- `X-OrderReservation-Signature` *(quando o segredo HMAC está configurado)*: `sha256=<hmac_hex_lowercase>`

**Exemplo de Payload**:

```json
{
  "event": "EstoqueReservado",
  "occurredAtUtc": "2026-11-16T14:00:05.120Z",
  "orderId": "d290f1ee-6c54-4b01-90e6-d701748f0851",
  "customerName": "Ana Beatriz Souza",
  "totalAmount": 919.90,
  "items": [
    {
      "productName": "Teclado Mecânico TKL",
      "quantity": 1,
      "unitPrice": 489.90
    }
  ]
}
```

---

## 4. Endpoints Operacionais do Simulador Web (Porta `3000`)

| Método | Rota | Finalidade |
| :--- | :--- | :--- |
| `GET` | `/api/simulator/state` | Estado completo do simulador (pedidos, Outbox, fila, logs, métricas de 30m, webhooks e configuração). |
| `POST` | `/api/simulator/config` | Atualiza flags operacionais (`queueAvailable`, `inventoryMode`, `workerRunning`, `maxRetryAttempts`). |
| `POST` | `/api/simulator/advance-retry/:orderId` | Antecipa o timer de retentativa de 60s de uma mensagem em `FailedWaitingRetry`. |
| `POST` | `/api/simulator/requeue/:orderId` | Reenfileira manualmente uma mensagem em `DeadLetter` para `Pending`. |
| `POST` | `/api/simulator/test-concurrency/:orderId` | Executa disputa simulada de 2 workers para validar *lease/lock* atômico. |
| `POST` | `/api/simulator/webhook/config` | Persiste URL, segredo HMAC e eventos assinados (`EstoqueReservado`, `PedidoCancelado`). |
| `POST` | `/api/simulator/webhook/test` | Dispara evento sintético `WebhookTest` para validar conectividade e assinatura. |
| `POST` | `/api/simulator/webhook-sink` | Receptor HTTP simulado integrado que valida `X-OrderReservation-Signature`. |
| `POST` | `/api/simulator/reset` | Limpa e opcionalmente repovoa a base SQLite do simulador (`{ "seed": true }`). |
| `GET` | `/api/dotnet/files` | Lista e retorna os arquivos reais da solução `.NET 10` para o explorador de código. |
