# Plataforma de Pedidos (.NET 10)

Solução completa em **.NET 10** (`api` e `worker`) estruturada com princípios **SOLID**, **Clean Code** e **Transactional Outbox** em **SQLite (EF Core 10)** para garantir zero perda de notificações ao sistema de estoque, acompanhada de um **painel simulador web interativo** (frontend) em React, para testar todo o ciclo de vida em tempo real.

## Revisão e Decisões Confirmadas

> [!IMPORTANT]
> As diretrizes abaixo foram confirmadas na etapa de refinamento e definem os pilares da solução:

- **Entrega Híbrida (`.NET 10` + Simulador Web)**: Os projetos completos em `.NET 10` (`api` e `worker`) serão gerados prontos para uso local com `dotnet`, enquanto o ambiente web executará um backend Node/SQLite espelhado com painel visual interativo para criar, cancelar, consultar e observar o processamento em segundo plano.
- **Mensageria Confiável**: Padrão **Transactional Outbox** persistido no SQLite combinado com interface de fila simulada idempotente (`IMessageQueue`), garantindo unicidade por pedido e controle de concorrência por *lease/lock*.
- **Pedidos Cancelados**: Suporte duplo — flag opcional no payload de criação (`cancelado`) e endpoint dedicado de cancelamento antes do envio, impedindo a notificação ao estoque.
- **Persistência**: **Entity Framework Core 10** com SQLite e mapeamentos via *Fluent API* nos projetos `.NET 10` (espelhado em SQLite nativo no simulador web).

---

## 1. Visão Geral e Conceito Central

- **O que o sistema faz**: Registra pedidos de clientes com itens detalhados, calcula o total no servidor, atribui um identificador único (usa um `Guid` como ID) e aplica o stamp `PedidoCriado`. Pedidos válidos geram atomicamente uma mensagem de reserva na tabela Outbox para que o `worker` em segundo plano a encaminhe à fila e ao sistema de estoque mockado, com retenção e retentativa automática de **60 segundos** em caso de falha.
- **Público-alvo**: Engenheiros e arquitetos de software avaliando resiliência distribuída, garantia de entrega (*at-least-once* com deduplicação) e separação de responsabilidades entre Web API e Background Worker.
- **Valor Principal**: Eliminação de condições de corrida, prevenção de envios duplicados ou simultâneos, proteção contra perda de eventos mesmo com estoque/fila indisponíveis e visualização imediata do comportamento sem necessidade de infraestrutura externa pesada.

---

## 2. Experiência do Usuário e Design Visual

- **Jornada Principal do Usuário**:
  1. **Criação e Consulta na API**: O usuário cria um pedido informando cliente e itens (com cálculo automático do total), podendo marcá-lo opcionalmente como cancelado logo na criação, ou consulta qualquer pedido pelo seu identificador único.
  2. **Controle de Falhas e Cancelamentos**: O usuário alterna a disponibilidade simulada da Fila de Mensagens ou do Sistema de Estoque para observar o comportamento resiliente, e pode acionar o endpoint de cancelar pedido enquanto ele ainda está pendente.
  3. **Observação do Worker e Outbox**: O painel exibe a fila de mensagens com chave única por pedido, bloqueio de processamento concorrente, contagem regressiva exata de 60 segundos para retentativa após falhas e histórico de logs estruturados.
  4. **Inspeção do Código `.NET 10`**: Uma aba dedicada permite navegar pela arquitetura SOLID dos projetos `api` e `worker`, visualizar cada classe/interface e copiar ou baixar o código-fonte completo.

- **Identidade Visual e Tema**:
  - *Direção Estética*: Console de engenharia limpo e utilitário, alinhado a ferramentas de observabilidade corporativas, com superfície de elevação única e divisórias sutis de `1px`.
  - *Paleta de Cores (60-30-10)*: Canvas neutro claro (`#F8FAFC`) ou ardósia estrutural (`#FFFFFF` com bordas `#E2E8F0`), texto principal `#0F172A`, cor de ação primária `#0F172A` / azul cobalto `#2563EB` reservada estritamente a botões e aba ativa. Cores semânticas aplicadas apenas aos estados dos dados acompanhados de rótulo textual explícito: Verde (`#16A34A`) para reservado/nominal, Âmbar (`#D97706`) para aguardando retentativa de 60s, e Carmesim (`#DC2626`) para falha ou pedido cancelado.
  - *Tipografia e Hierarquia*: `Plus Jakarta Sans` para títulos e navegação, `DM Sans` para interface e leitura densa, e `JetBrains Mono` com `tabular-nums` para UUIDs, valores monetários, contadores de retentativa e payloads JSON.
  - *Estrutura de Layout*: Barra lateral fixa (`256px`) para alternar entre as visões (*Painel Operacional*, *Criar & Consultar Pedido*, *Código .NET 10*), cabeçalho enxuto com trilha contextual e no máximo uma ação primária de criação rápida ou atualização. Metadados exibidos em texto limpo separado por `·` sem cápsulas decorativas.

---

## 3. Decisões de Produto e Arquitetura (Trade-offs)

- **Padrão Transactional Outbox no SQLite vs. Publicação Direta na Fila**
  - *Abordagem Escolhida*: Gravar o pedido e o registro de Outbox (`PedidoCriado`) na mesma transação ACID do EF Core 10 antes de confirmar a resposta HTTP `201 Created`.
  - *Por quê*: Garante que, se a fila ou o sistema de estoque estiver fora do ar no momento do checkout, o evento nunca será perdido e nem haverá pedido salvo sem notificação pendente.
  - *Alternativas Descartadas*: Publicar diretamente na fila dentro do controller HTTP, o que causaria perda silenciosa ou inconsistência em quedas de rede.

- **Unicidade na Fila e Proteção Contra Envio Simultâneo**
  - *Abordagem Escolhida*: Chave de idempotência única (`OrderId`) imposta por índice `UNIQUE` no Outbox e controle de deduplicação na fila simulada (`IMessageQueue`), somado a um mecanismo de *lease* atômico (`LockedBy` + `LockedUntilUtc`) adquirido pelo `worker` antes de despachar.
  - *Por quê*: Impede que múltiplas execuções ou instâncias do `worker` processem o mesmo pedido ao mesmo tempo e garante que a fila nunca aceite duas mensagens ativas para o mesmo pedido.

- **Retentativa Pré-Definida de 60 Segundos**
  - *Abordagem Escolhida*: Quando o envio à fila ou ao sistema de estoque mockado falha, o `worker` libera o lock, incrementa `AttemptCount`, registra o motivo da falha e define `NextRetryAtUtc = UtcNow + 60s`.
  - *Por quê*: Atende estritamente ao requisito de espaçamento de 60 segundos sem bloquear a thread principal do `worker` para outros pedidos prontos para envio.

- **Tratamento de Pedidos Cancelados**
  - *Abordagem Escolhida*: Se o pedido nasce cancelado (`cancelado: true`), é persistido com status `PedidoCancelado` sem criar registro na Outbox. Se for cancelado via endpoint dedicado antes do envio final ao estoque, a transação altera o pedido para `PedidoCancelado` e marca a mensagem Outbox como `Cancelada`.
  - *Por quê*: Garante aderência total à regra de que pedidos cancelados nunca notificam o sistema de estoque.

---

## 4. Arquitetura Técnica e Estratégia de Dados

### Diagrama de Arquitetura (Solução .NET 10 + Simulador Web)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CLIENTE / PAINEL SIMULADOR WEB                       │
│   [ Criar Pedido ]   [ Consultar por ID ]   [ Cancelar ]  [ Simular ]   │
└──────────────┬───────────────────────────────────────┬──────────────────┘
               │ HTTP REST                             │ Polling / SSE
               ▼                                       ▼
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│          PROJETO: api           │     │        PROJETO: worker          │
│   (Web API .NET 10 + SOLID)     │     │ (BackgroundService .NET 10)     │
│                                 │     │                                 │
│  • POST /api/orders             │     │  • Polling periódico (Outbox)   │
│  • GET  /api/orders/{id}        │     │  • Aquisição de Lock atômico    │
│  • POST /api/orders/{id}/cancel │     │  • Verifica se não foi Cancelado│
│  • Cálculo de total no servidor │     │  • Envio via IMessageQueue      │
│  • Transação ACID (Order+Outbox)│     │  • Retry fixo de 60s em falha   │
│  • Notifica Webhook (Cancelado) │     │  • Notifica Webhook (Reservado) │
└──────────────┬──────────────────┘     └────────┬───────┬───────┬────────┘
               │                                 │       │       │
               ▼                                 ▼       ▼       ▼
┌─────────────────────────────────┐     ┌──────────────┐ ┌────────────────┐ ┌─────────────────┐
│     BANCO RELACIONAL SQLITE     │     │ IMessageQueue│ │ Estoque Mock   │ │ IWebhookNotifier│
│  (EF Core 10 + Fluent API)      │     │ (Idempotente │ │ (IInventory    │ │ (POST + HMAC    │
│                                 │     │  por OrderId)│ │  Gateway com   │ │  SHA-256 opc.)  │
│  [Orders] ◄── 1:N ── [Items]    │     └──────────────┘ │  falha simul.) │ └─────────────────┘
│  [OutboxMessages] (Lock/Retry)  │                      └────────────────┘
│  [WebhookConfig / Deliveries]   │
└─────────────────────────────────┘
```

### Modelo de Dados e Estados

- **Pedido (`Order`)**: `Id (Guid PK)`, `CustomerName`, `CustomerEmail`, `TotalAmount (decimal calculado)`, `Status` (`PedidoCriado` | `PedidoCancelado` | `EstoqueReservado`), `CreatedAtUtc` (stamp de criação), `UpdatedAtUtc`, e coleção de `OrderItems` (`ProductName`, `Quantity`, `UnitPrice`, `Subtotal`).
- **Mensagem Outbox (`OutboxMessage`)**: `Id (Guid PK)`, `OrderId (Guid UNIQUE)`, `EventType` (`PedidoCriado`), `PayloadJson`, `Status` (`Pending` | `Processing` | `Dispatched` | `FailedWaitingRetry` | `Cancelled` | `DeadLetter`), `RetryCount`, `NextRetryAtUtc`, `LockedBy`, `LockedUntilUtc`, `LastError`, `CreatedAtUtc`, `DispatchedAtUtc`.
- **Registro da Fila (`QueueEnvelope`)**: Armazena `MessageId`, `OrderId (UNIQUE)` e `Status` para assegurar unicidade na message queue e visibilidade no painel.
- **Webhook (`webhook_config` e `webhook_deliveries`)**: Armazena no simulador a configuração ativa (`enabled`, `endpoint_url`, `hmac_secret`, filtros `EstoqueReservado`/`PedidoCancelado`) e o histórico das últimas entregas com status HTTP, latência (`duration_ms`), cabeçalho HMAC, payload e prévia da resposta.

### Mapeamento de Interações e Fluxos no Painel

- **Formulário de Novo Pedido**: Valida cliente e itens dinamicamente, calcula o total em tempo real, permite marcar "Criar como pedido cancelado" e envia `POST /api/orders`, atualizando imediatamente a tabela de pedidos e o Outbox.
- **Busca por Identificador Único**: Input de `Guid` que consulta `GET /api/orders/{id}` e exibe o detalhamento completo dos itens, stamp `PedidoCriado` e histórico de entrega.
- **Ação Cancelar Pedido**: Botão contextual em pedidos ainda não enviados ao estoque que dispara `POST /api/orders/{id}/cancel`, transitando o status para `PedidoCancelado` e cancelando o despacho na Outbox.
- **Controles de Caos e Resiliência do Ambiente**: Chaves para simular **Fila Indisponível** e **Sistema de Estoque Instável/Fora do Ar**, além de seletor persistido em SQLite para configurar o **Limite Máximo de Retentativas do Worker** (`3`, `5`, `10` ou valor customizado de `1` a `50`). Ao atingir o limite, a mensagem transita para `DeadLetter` (com ação opcional de reenfileiramento manual) e registra `[OUTBOX_MAX_RETRIES_EXCEEDED]`.
- **Explorador de Código `.NET 10`**: Leitura direta dos arquivos reais da solução `.NET 10` gerada no workspace, organizada por projetos (`api`, `worker`, `domain/application/infrastructure`, `tests`) com cópia e download.

---

## 5. Observabilidade, Métricas e Alertas Operacionais

- **Logging Estruturado (`.NET 10` + Simulador Web)**:
  - Nos projetos `.NET 10` (`api` e `worker`), o pipeline utiliza **Serilog** com saída em Console estruturado e arquivos NDJSON rotativos (`logs/api-*.ndjson`, `logs/worker-*.ndjson`), combinado com source generators **`[LoggerMessage]`** e catálogo centralizado `StructuredLogEvents` (`ORDER_CREATED`, `ORDER_CANCELLED`, `INVENTORY_DISPATCH_ATTEMPT`, `INVENTORY_DISPATCH_SUCCEEDED`, `INVENTORY_DISPATCH_FAILED`, `OUTBOX_SKIPPED_CANCELLED`, `WEBHOOK_DELIVERY_SUCCEEDED`, `WEBHOOK_DELIVERY_FAILED`).
  - No simulador web, cada evento é persistido na tabela `worker_logs` com `event_code` e `details_json` estruturados.
- **Exportação de Logs (`Exportar Logs`)**:
  - O painel de Logs Estruturados oferece filtros por origem/nível e o botão **Exportar Logs**, que gera e baixa um arquivo `.json` contendo exatamente os registros filtrados no momento para análise offline.
- **Gráfico de Desempenho em Tempo Real (`Recharts`)**:
  - O componente `InventoryMetricsChart` agrega os eventos dos últimos **30 minutos** em janelas por minuto (`inventoryMetrics30m`), exibindo curvas de taxa de sucesso (%) vs. falhas (%) no processamento de estoque, além de totais e contagens no tooltip.
- **Alertas Visuais Temporários (`OperationalAlerts`)**:
  - Banners no Painel Operacional notificam automaticamente quando novos pedidos entram em `PedidoCancelado` ou quando o Worker registra múltiplos erros de processamento em curto intervalo (`>= 2` falhas em 60 segundos), com dispensação manual e expiração automática.

---

## 6. Integração por Webhook (`EstoqueReservado` e `PedidoCancelado`)

- **Configurações de Webhook no Painel Operacional (`WebhookSettingsPanel`)**:
  - Permite ativar/desativar notificações externas, informar a **URL de endpoint** (com atalho para o **Receptor Simulado Integrado** em `/api/simulator/webhook-sink`), selecionar os eventos desejados (`EstoqueReservado` e `PedidoCancelado`) e definir opcionalmente um **Segredo HMAC-SHA256**.
  - Inclui disparo imediato pelo botão **Testar Webhook** (`POST /api/simulator/webhook/test`) e tabela de **Histórico de Entregas** com expansão de payload, assinatura e resposta HTTP.
- **Execução HTTP POST Real e Segurança**:
  - Após o commit das transações no SQLite, o servidor dispara requisições `HTTP POST` reais com timeout de 5 segundos de forma **não bloqueante** (falhas no endpoint parceiro não revertem pedidos nem reservas).
  - Quando o segredo HMAC está preenchido, o payload JSON é assinado e enviado no cabeçalho `X-OrderReservation-Signature: sha256=<hex>`, acompanhado de `X-OrderReservation-Event`. O receptor integrado valida a assinatura e devolve `signatureVerified: true|false`.
- **Implementação Espelhada no `.NET 10`**:
  - Interface `IWebhookNotifier` na camada `OrderReservation.Application`, acionada por `OrderService` (quando `PedidoCancelado`) e `OutboxProcessorService` (quando `EstoqueReservado`).
  - Implementação `HttpWebhookNotifier` na camada `OrderReservation.Infrastructure` utilizando `IHttpClientFactory`, `HMACSHA256` e opções tipadas `WebhookOptions` configuradas nos `appsettings.json` da `api` e do `worker`.

---

## 7. Suíte de Testes `.NET 10` e Execução Local

- **Cobertura de Testes xUnit (`dotnet/tests/`)**:
  - `api.Tests`: Testes unitários de validação e regras de domínio (`OrderValidationTests`) e testes de integração com SQLite verificando `POST /api/orders`, `GET /api/orders/{id}`, `POST /api/orders/{id}/cancel` e criação atômica da Outbox (`OrdersApiIntegrationTests`).
  - `worker.Tests`: Testes unitários da lógica do `OutboxProcessorService` (`OutboxProcessorServiceTests`) e testes de integração completos com SQLite simulando fila, envio mockado ao estoque, cenário de falha com agendamento de retentativa de 60s, pedidos cancelados e disparo de `IWebhookNotifier` (`OutboxWorkerIntegrationTests`).
- **Como executar localmente**:
  - **Simulador Web (Node.js 22+)**:
    ```bash
    npm install
    npm run dev
    ```
    Acesse `http://localhost:3000`.
  - **Solução .NET 10 (em ambiente com SDK .NET 10 instalado)**:
    ```bash
    dotnet test dotnet/OrderReservation.sln
    dotnet run --project dotnet/src/api
    dotnet run --project dotnet/src/worker
    ```

---

## 8. Histórico Incremental de Evoluções

| Versão | Incremento | Resumo Técnico |
| :--- | :--- | :--- |
| **v1.0** | Base `.NET 10` + Simulador Web | Solução `api` e `worker` em `.NET 10` com EF Core 10 + SQLite, Transactional Outbox, lock/lease, retentativa fixa de 60s, tratamento de `PedidoAbortado` e explorador de código. |
| **v1.1** | Observabilidade e Exportação | Logging estruturado com Serilog (NDJSON) e `[LoggerMessage]` no `.NET 10`; colunas `event_code` e `details_json` no simulador e botão **Exportar Logs** em JSON. |
| **v1.2** | Suíte de Testes `.NET 10` | Criação dos projetos `api.Tests` e `worker.Tests` em xUnit com testes unitários e de integração SQLite cobrindo validação, persistência, Outbox, falhas e retentativas. |
| **v1.3** | Métricas Recharts e Alertas | Gráfico de linhas de 30 minutos (`Recharts`) comparando sucesso vs. falhas no estoque e banners de alerta temporários para novos abortamentos e rajadas de erros do Worker. |
| **v1.4** | Webhooks + HMAC-SHA256 | Seção **Configurações de Webhook** no Painel Operacional com `HTTP POST` real, receptor integrado `/api/simulator/webhook-sink`, assinatura `HMAC-SHA256`, histórico de entregas e `IWebhookNotifier` / `HttpWebhookNotifier` no `.NET 10`. |
| **v1.5** | Limite de Retentativas (`DeadLetter`) | Controle no Painel Operacional para configurar o limite máximo de retentativas do Worker (`3`, `5`, `10` ou personalizado) persistido em SQLite (`max_retry_attempts`), transição automática para `DeadLetter`, reenfileiramento manual (`/api/simulator/requeue/:orderId`) e `IOutboxRetryPolicy` / `OutboxWorkerOptions` no `.NET 10`. |
| **v1.6** | Status `PedidoCancelado` | Renomeação do status `PedidoAbortado` para `PedidoCancelado` em toda a stack (UI, simulador SQLite com migração automática de dados legados, endpoint `/cancel`, webhooks, logs estruturados, código `.NET 10` e testes xUnit). |


