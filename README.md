# Plataforma de Pedidos & Reserva de Estoque (.NET 10 + Simulador Web)

Solução completa em **.NET 10** (`api` e `worker`) estruturada com princípios **SOLID**, **Clean Code** e **Transactional Outbox** em **SQLite (EF Core 10)** para garantir zero perda de notificações ao sistema de estoque, acompanhada de um **painel simulador web interativo** para testar todo o ciclo de vida em tempo real.

## Revisão e Decisões Confirmadas

> [!IMPORTANT]
> As diretrizes abaixo foram confirmadas na etapa de esclarecimento e definem os pilares da solução:

- **Entrega Híbrida (`.NET 10` + Simulador Web)**: Os projetos completos em `.NET 10` (`api` e `worker`) serão gerados prontos para uso local com `dotnet`, enquanto o ambiente web executará um backend Node/SQLite espelhado com painel visual interativo para criar, abortar, consultar e observar o processamento em segundo plano.
- **Mensageria Confiável**: Padrão **Transactional Outbox** persistido no SQLite combinado com interface de fila simulada idempotente (`IMessageQueue`), garantindo unicidade por pedido e controle de concorrência por *lease/lock*.
- **Pedidos Abortados**: Suporte duplo — flag opcional no payload de criação (`abortado`) e endpoint dedicado de cancelamento antes do envio, impedindo a notificação ao estoque.
- **Persistência**: **Entity Framework Core 10** com SQLite e mapeamentos via *Fluent API* nos projetos `.NET 10` (espelhado em SQLite nativo no simulador web).

---

## 1. Visão Geral e Conceito Central

- **O que o sistema faz**: Registra pedidos de clientes com itens detalhados, calcula o total no servidor, atribui um identificador único (`Guid`) e aplica o stamp `PedidoCriado`. Pedidos válidos geram atomicamente uma mensagem de reserva na tabela Outbox para que o `worker` em segundo plano a encaminhe à fila e ao sistema de estoque mockado, com retenção e retentativa automática de **60 segundos** em caso de falha.
- **Público-alvo**: Engenheiros e arquitetos de software avaliando resiliência distribuída, garantia de entrega (*at-least-once* com deduplicação) e separação de responsabilidades entre Web API e Background Worker.
- **Valor Principal**: Eliminação de condições de corrida, prevenção de envios duplicados ou simultâneos, proteção contra perda de eventos mesmo com estoque/fila indisponíveis e visualização imediata do comportamento sem necessidade de infraestrutura externa pesada.

---

## 2. Experiência do Usuário e Design Visual

- **Jornada Principal do Usuário**:
  1. **Criação e Consulta na API**: O usuário cria um pedido informando cliente e itens (com cálculo automático do total), podendo marcá-lo opcionalmente como abortado logo na criação, ou consulta qualquer pedido pelo seu identificador único.
  2. **Controle de Falhas e Aborts**: O usuário alterna a disponibilidade simulada da Fila de Mensagens ou do Sistema de Estoque para observar o comportamento resiliente, e pode acionar o endpoint de abortar pedido enquanto ele ainda está pendente.
  3. **Observação do Worker e Outbox**: O painel exibe a fila de mensagens com chave única por pedido, bloqueio de processamento concorrente, contagem regressiva exata de 60 segundos para retentativa após falhas e histórico de logs estruturados.
  4. **Inspeção do Código `.NET 10`**: Uma aba dedicada permite navegar pela arquitetura SOLID dos projetos `api` e `worker`, visualizar cada classe/interface e copiar ou baixar o código-fonte completo.

- **Identidade Visual e Tema**:
  - *Direção Estética*: Console de engenharia limpo e utilitário, alinhado a ferramentas de observabilidade corporativas, com superfície de elevação única e divisórias sutis de `1px`.
  - *Paleta de Cores (60-30-10)*: Canvas neutro claro (`#F8FAFC`) ou ardósia estrutural (`#FFFFFF` com bordas `#E2E8F0`), texto principal `#0F172A`, cor de ação primária `#0F172A` / azul cobalto `#2563EB` reservada estritamente a botões e aba ativa. Cores semânticas aplicadas apenas aos estados dos dados acompanhados de rótulo textual explícito: Verde (`#16A34A`) para reservado/nominal, Âmbar (`#D97706`) para aguardando retentativa de 60s, e Carmesim (`#DC2626`) para falha ou pedido abortado.
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

- **Tratamento de Pedidos Abortados**
  - *Abordagem Escolhida*: Se o pedido nasce abortado (`abortado: true`), é persistido com status `PedidoAbortado` sem criar registro na Outbox. Se for abortado via endpoint dedicado antes do envio final ao estoque, a transação altera o pedido para `PedidoAbortado` e marca a mensagem Outbox como `Cancelada`.
  - *Por quê*: Garante aderência total à regra de que pedidos abortados nunca notificam o sistema de estoque.

---

## 4. Arquitetura Técnica e Estratégia de Dados

### Diagrama de Arquitetura (Solução .NET 10 + Simulador Web)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CLIENTE / PAINEL SIMULADOR WEB                       │
│   [ Criar Pedido ]   [ Consultar por ID ]   [ Abortar ]   [ Simular ]   │
└──────────────┬───────────────────────────────────────┬──────────────────┘
               │ HTTP REST                             │ Polling / SSE
               ▼                                       ▼
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│          PROJETO: api           │     │        PROJETO: worker          │
│   (Web API .NET 10 + SOLID)     │     │ (BackgroundService .NET 10)     │
│                                 │     │                                 │
│  • POST /api/orders             │     │  • Polling periódico (Outbox)   │
│  • GET  /api/orders/{id}        │     │  • Aquisição de Lock atômico    │
│  • POST /api/orders/{id}/abort  │     │  • Verifica se não foi Abortado │
│  • Cálculo de total no servidor │     │  • Envio via IMessageQueue      │
│  • Transação ACID (Order+Outbox)│     │  • Retry fixo de 60s em falha   │
└──────────────┬──────────────────┘     └────────┬───────────────┬────────┘
               │                                 │               │
               ▼                                 ▼               ▼
┌─────────────────────────────────┐     ┌──────────────┐ ┌────────────────┐
│     BANCO RELACIONAL SQLITE     │     │ IMessageQueue│ │ Estoque Mock   │
│  (EF Core 10 + Fluent API)      │     │ (Idempotente │ │ (IInventory    │
│                                 │     │  por OrderId)│ │  Gateway com   │
│  [Orders] ◄── 1:N ── [Items]    │     └──────────────┘ │  falha simul.) │
│  [OutboxMessages] (Lock/Retry)  │                      └────────────────┘
└─────────────────────────────────┘
```

### Modelo de Dados e Estados

- **Pedido (`Order`)**: `Id (Guid PK)`, `CustomerName`, `CustomerEmail`, `TotalAmount (decimal calculado)`, `Status` (`PedidoCriado` | `PedidoAbortado` | `EstoqueReservado`), `CreatedAtUtc` (stamp de criação), `UpdatedAtUtc`, e coleção de `OrderItems` (`ProductName`, `Quantity`, `UnitPrice`, `Subtotal`).
- **Mensagem Outbox (`OutboxMessage`)**: `Id (Guid PK)`, `OrderId (Guid UNIQUE)`, `EventType` (`PedidoCriado`), `PayloadJson`, `Status` (`Pending` | `Processing` | `Dispatched` | `FailedWaitingRetry` | `Cancelled`), `RetryCount`, `NextRetryAtUtc`, `LockedBy`, `LockedUntilUtc`, `LastError`, `CreatedAtUtc`, `DispatchedAtUtc`.
- **Registro da Fila (`QueueEnvelope`)**: Armazena `MessageId`, `OrderId (UNIQUE)` e `Status` para assegurar unicidade na message queue e visibilidade no painel.

### Mapeamento de Interações e Fluxos no Painel

- **Formulário de Novo Pedido**: Valida cliente e itens dinamicamente, calcula o total em tempo real, permite marcar "Criar como pedido abortado" e envia `POST /api/orders`, atualizando imediatamente a tabela de pedidos e o Outbox.
- **Busca por Identificador Único**: Input de `Guid` que consulta `GET /api/orders/{id}` e exibe o detalhamento completo dos itens, stamp `PedidoCriado` e histórico de entrega.
- **Ação Abortar Pedido**: Botão contextual em pedidos ainda não enviados ao estoque que dispara `POST /api/orders/{id}/abort`, transitando o status para `PedidoAbortado` e cancelando o despacho na Outbox.
- **Controles de Caos do Ambiente**: Chaves para simular **Fila Indisponível** e **Sistema de Estoque Instável/Fora do Ar**, fazendo o worker registrar falhas nos logs e iniciar o cronômetro visível de **60 segundos** para retentativa (com botão opcional "Avançar 60s" apenas no simulador para facilitar testes manuais rápidos, mantendo o timer real de 60s como padrão).
- **Explorador de Código `.NET 10`**: Leitura direta dos arquivos reais da solução `.NET 10` gerada no workspace, organizada por projetos (`api`, `worker`, `domain/application/infrastructure`) com cópia e download.
