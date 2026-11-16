import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  DotnetSourceFileDto,
  InventoryMetricPointDto,
  InventoryMode,
  OrderDto,
  OrderItemDto,
  OutboxSummaryDto,
  QueueRecordDto,
  SimulatorConfigDto,
  WebhookConfigDto,
  WebhookDeliveryDto,
  WorkerLogDto,
} from './src/types.ts';

const PORT = 3000;
const DB_PATH = path.resolve(process.cwd(), 'simulator_orders.db');
const DOTNET_ROOT = path.resolve(process.cwd(), 'dotnet');
const RETRY_DELAY_MS = 60_000;
const LOCK_DURATION_MS = 30_000;

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      status TEXT NOT NULL,
      total_amount REAL NOT NULL,
      pedido_criado_at_utc TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS outbox_messages (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at_utc TEXT,
      locked_by TEXT,
      locked_until_utc TEXT,
      last_error TEXT,
      created_at_utc TEXT NOT NULL,
      dispatched_at_utc TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_outbox_poll
      ON outbox_messages (status, next_retry_at_utc, locked_until_utc);

    CREATE TABLE IF NOT EXISTS message_queue (
      message_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      enqueued_at_utc TEXT NOT NULL,
      acknowledged_at_utc TEXT
    );

    CREATE TABLE IF NOT EXISTS worker_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp_utc TEXT NOT NULL,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      event_code TEXT NOT NULL DEFAULT 'SYSTEM_EVENT',
      order_id TEXT,
      message TEXT NOT NULL,
      details_json TEXT
    );

    CREATE TABLE IF NOT EXISTS simulation_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      endpoint_url TEXT NOT NULL DEFAULT '',
      hmac_secret TEXT NOT NULL DEFAULT '',
      notify_estoque_reservado INTEGER NOT NULL DEFAULT 1,
      notify_pedido_abortado INTEGER NOT NULL DEFAULT 1,
      updated_at_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      event_type TEXT NOT NULL,
      target_url TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      signature_header TEXT,
      http_status INTEGER,
      success INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      response_preview TEXT,
      error_message TEXT,
      created_at_utc TEXT NOT NULL
    );
  `);

  const logCols = db.prepare('PRAGMA table_info(worker_logs)').all() as Array<{ name: string }>;
  const colNames = new Set(logCols.map((c) => c.name));
  if (!colNames.has('event_code')) {
    db.exec("ALTER TABLE worker_logs ADD COLUMN event_code TEXT NOT NULL DEFAULT 'SYSTEM_EVENT';");
  }
  if (!colNames.has('details_json')) {
    db.exec('ALTER TABLE worker_logs ADD COLUMN details_json TEXT;');
  }

  db.prepare(
    `INSERT OR IGNORE INTO webhook_config
     (id, enabled, endpoint_url, hmac_secret, notify_estoque_reservado, notify_pedido_abortado, updated_at_utc)
     VALUES (1, 0, '', '', 1, 1, ?)`
  ).run(new Date().toISOString());

  const defaults: Record<string, string> = {
    queue_available: 'true',
    inventory_mode: 'intermittent',
    worker_running: 'true',
    worker_instance_id: 'worker-net10-01',
    max_retry_attempts: '5',
  };

  const insertCfg = db.prepare(
    'INSERT OR IGNORE INTO simulation_config (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of Object.entries(defaults)) {
    insertCfg.run(key, value);
  }
}

function writeLog(
  level: 'INFO' | 'WARN' | 'ERROR',
  source: 'API' | 'Worker' | 'MessageQueue' | 'InventoryMock',
  orderId: string | null,
  message: string,
  eventCode = 'SYSTEM_EVENT',
  details?: Record<string, unknown>,
  timestampUtc?: string
) {
  db.prepare(
    'INSERT INTO worker_logs (timestamp_utc, level, source, event_code, order_id, message, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    timestampUtc ?? new Date().toISOString(),
    level,
    source,
    eventCode,
    orderId,
    message,
    details ? JSON.stringify(details) : null
  );

  // Keep latest 1000 log lines so 30-minute telemetry remains complete
  db.exec(
    'DELETE FROM worker_logs WHERE id NOT IN (SELECT id FROM worker_logs ORDER BY id DESC LIMIT 1000)'
  );
}

function buildInventoryMetrics30m(): InventoryMetricPointDto[] {
  const nowMs = Date.now();
  const currentMinuteStartMs = Math.floor(nowMs / 60_000) * 60_000;
  const windowStartIso = new Date(currentMinuteStartMs - 29 * 60_000).toISOString();

  const rows = db
    .prepare(
      `SELECT timestamp_utc, event_code
       FROM worker_logs
       WHERE event_code IN ('INVENTORY_DISPATCH_SUCCEEDED', 'INVENTORY_DISPATCH_FAILED')
         AND timestamp_utc >= ?`
    )
    .all(windowStartIso) as Array<{ timestamp_utc: string; event_code: string }>;

  const buckets = new Map<number, { success: number; failure: number }>();
  for (let i = 29; i >= 0; i--) {
    const bucketMs = currentMinuteStartMs - i * 60_000;
    buckets.set(bucketMs, { success: 0, failure: 0 });
  }

  for (const row of rows) {
    const tsMs = new Date(row.timestamp_utc).getTime();
    if (Number.isNaN(tsMs)) continue;
    const bucketMs = Math.floor(tsMs / 60_000) * 60_000;
    const entry = buckets.get(bucketMs);
    if (!entry) continue;
    if (row.event_code === 'INVENTORY_DISPATCH_SUCCEEDED') {
      entry.success += 1;
    } else if (row.event_code === 'INVENTORY_DISPATCH_FAILED') {
      entry.failure += 1;
    }
  }

  const points: InventoryMetricPointDto[] = [];
  for (const [bucketMs, counts] of buckets.entries()) {
    const date = new Date(bucketMs);
    const total = counts.success + counts.failure;
    const successRate = total > 0 ? Math.round((counts.success / total) * 1000) / 10 : 0;
    const failureRate = total > 0 ? Math.round((counts.failure / total) * 1000) / 10 : 0;
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');

    points.push({
      minuteIso: date.toISOString(),
      minuteLabel: `${hh}:${mm}`,
      successCount: counts.success,
      failureCount: counts.failure,
      successRate,
      failureRate,
    });
  }

  return points;
}

function getConfig(): SimulatorConfigDto {
  const rows = db
    .prepare('SELECT key, value FROM simulation_config')
    .all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const parsedMax = Number(map.get('max_retry_attempts') ?? '5');
  const maxRetryAttempts =
    Number.isFinite(parsedMax) && parsedMax >= 1 ? Math.min(50, Math.trunc(parsedMax)) : 5;

  return {
    queueAvailable: (map.get('queue_available') ?? 'true') === 'true',
    inventoryMode: (map.get('inventory_mode') as InventoryMode) ?? 'intermittent',
    workerRunning: (map.get('worker_running') ?? 'true') === 'true',
    workerInstanceId: map.get('worker_instance_id') ?? 'worker-net10-01',
    maxRetryAttempts,
  };
}

function getWebhookConfig(): WebhookConfigDto {
  const row = db.prepare('SELECT * FROM webhook_config WHERE id = 1').get() as Record<
    string,
    unknown
  >;
  return {
    enabled: Number(row.enabled) === 1,
    endpointUrl: String(row.endpoint_url ?? ''),
    hmacSecret: String(row.hmac_secret ?? ''),
    notifyOnEstoqueReservado: Number(row.notify_estoque_reservado) === 1,
    notifyOnPedidoAbortado: Number(row.notify_pedido_abortado) === 1,
    updatedAtUtc: String(row.updated_at_utc),
  };
}

function getWebhookDeliveries(): WebhookDeliveryDto[] {
  const rows = db
    .prepare('SELECT * FROM webhook_deliveries ORDER BY created_at_utc DESC LIMIT 25')
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id as string,
    orderId: (r.order_id as string | null) ?? null,
    eventType: r.event_type as WebhookDeliveryDto['eventType'],
    targetUrl: r.target_url as string,
    payloadJson: r.payload_json as string,
    signatureHeader: (r.signature_header as string | null) ?? null,
    httpStatus: r.http_status === null || r.http_status === undefined ? null : Number(r.http_status),
    success: Number(r.success) === 1,
    durationMs: Number(r.duration_ms),
    responsePreview: (r.response_preview as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    createdAtUtc: r.created_at_utc as string,
  }));
}

async function dispatchWebhookNotification(
  eventType: 'EstoqueReservado' | 'PedidoAbortado' | 'WebhookTest',
  orderId: string | null,
  customerName: string,
  totalAmount: number,
  items: Array<{ productName: string; quantity: number; unitPrice: number }>,
  options?: { overrideUrl?: string; overrideSecret?: string; forceSend?: boolean }
): Promise<WebhookDeliveryDto | null> {
  const cfg = getWebhookConfig();
  const targetUrl = (options?.overrideUrl ?? cfg.endpointUrl).trim();
  const hmacSecret = (options?.overrideSecret ?? cfg.hmacSecret).trim();

  if (!options?.forceSend) {
    if (!cfg.enabled || !targetUrl) return null;
    if (eventType === 'EstoqueReservado' && !cfg.notifyOnEstoqueReservado) return null;
    if (eventType === 'PedidoAbortado' && !cfg.notifyOnPedidoAbortado) return null;
  }

  if (!targetUrl) {
    throw new Error('A URL de endpoint do Webhook é obrigatória.');
  }

  const resolvedUrl = targetUrl.startsWith('/')
    ? `http://127.0.0.1:${PORT}${targetUrl}`
    : targetUrl;

  const occurredAtUtc = new Date().toISOString();
  const payloadJson = JSON.stringify({
    eventType,
    orderId,
    customerName,
    totalAmount,
    occurredAtUtc,
    items,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-OrderReservation-Event': eventType,
  };

  let signatureHeader: string | null = null;
  if (hmacSecret) {
    const digest = crypto.createHmac('sha256', hmacSecret).update(payloadJson).digest('hex');
    signatureHeader = `sha256=${digest}`;
    headers['X-OrderReservation-Signature'] = signatureHeader;
  }

  const deliveryId = crypto.randomUUID();
  const startedAt = Date.now();
  let httpStatus: number | null = null;
  let success = false;
  let responsePreview: string | null = null;
  let errorMessage: string | null = null;

  try {
    const response = await fetch(resolvedUrl, {
      method: 'POST',
      headers,
      body: payloadJson,
      signal: AbortSignal.timeout(5000),
    });

    httpStatus = response.status;
    success = response.ok;
    const rawText = await response.text();
    responsePreview = rawText.slice(0, 400);
    if (!response.ok) {
      errorMessage = `HTTP ${response.status} ${response.statusText}`.trim();
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Erro desconhecido ao enviar Webhook.';
  }

  const durationMs = Date.now() - startedAt;
  const createdAtUtc = new Date().toISOString();

  db.prepare(
    `INSERT INTO webhook_deliveries
     (id, order_id, event_type, target_url, payload_json, signature_header, http_status, success, duration_ms, response_preview, error_message, created_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    deliveryId,
    orderId,
    eventType,
    targetUrl,
    payloadJson,
    signatureHeader,
    httpStatus,
    success ? 1 : 0,
    durationMs,
    responsePreview,
    errorMessage,
    createdAtUtc
  );

  db.exec(
    'DELETE FROM webhook_deliveries WHERE id NOT IN (SELECT id FROM webhook_deliveries ORDER BY created_at_utc DESC LIMIT 50)'
  );

  if (success) {
    writeLog(
      'INFO',
      'API',
      orderId,
      `Webhook ${eventType} entregue com sucesso para ${targetUrl} (HTTP ${httpStatus} · ${durationMs}ms).`,
      'WEBHOOK_DELIVERY_SUCCEEDED',
      { eventType, targetUrl, httpStatus, durationMs, signed: Boolean(signatureHeader) }
    );
  } else {
    writeLog(
      'ERROR',
      'API',
      orderId,
      `Falha ao entregar Webhook ${eventType} para ${targetUrl}: ${errorMessage ?? 'Erro HTTP'}.`,
      'WEBHOOK_DELIVERY_FAILED',
      { eventType, targetUrl, httpStatus, durationMs, error: errorMessage }
    );
  }

  return {
    id: deliveryId,
    orderId,
    eventType,
    targetUrl,
    payloadJson,
    signatureHeader,
    httpStatus,
    success,
    durationMs,
    responsePreview,
    errorMessage,
    createdAtUtc,
  };
}

function seedDemoDataIfEmpty() {
  const row = db.prepare('SELECT COUNT(*) as total FROM orders').get() as { total: number };
  if (row.total > 0) return;

  const now = Date.now();
  const t1 = new Date(now - 180_000).toISOString();
  const t2 = new Date(now - 15_000).toISOString();
  const retryAt = new Date(now + 45_000).toISOString();
  const t3 = new Date(now - 90_000).toISOString();

  const order1Id = crypto.randomUUID();
  const order2Id = crypto.randomUUID();
  const order3Id = crypto.randomUUID();

  db.exec('BEGIN IMMEDIATE;');
  try {
    // Order 1: Reserved successfully
    db.prepare(
      `INSERT INTO orders (id, customer_name, customer_email, status, total_amount, pedido_criado_at_utc, created_at_utc, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(order1Id, 'Mariana Costa', 'mariana.costa@loja.com.br', 'EstoqueReservado', 919.8, t1, t1, t1);

    db.prepare(
      `INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), order1Id, 'Teclado Mecânico Keychron K2', 1, 649.9, 649.9);

    db.prepare(
      `INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), order1Id, 'Mousepad Deskmat Wool', 1, 269.9, 269.9);

    db.prepare(
      `INSERT INTO outbox_messages (id, order_id, event_type, payload_json, status, retry_count, created_at_utc, dispatched_at_utc)
       VALUES (?, ?, 'PedidoCriado', ?, 'Dispatched', 0, ?, ?)`
    ).run(
      crypto.randomUUID(),
      order1Id,
      JSON.stringify({ orderId: order1Id, stamp: 'PedidoCriado', totalAmount: 919.8 }),
      t1,
      t1
    );

    db.prepare(
      `INSERT INTO message_queue (message_id, order_id, event_type, payload_json, delivery_status, enqueued_at_utc, acknowledged_at_utc)
       VALUES (?, ?, 'PedidoCriado', ?, 'Acknowledged', ?, ?)`
    ).run(crypto.randomUUID(), order1Id, JSON.stringify({ orderId: order1Id }), t1, t1);

    // Order 2: Failed once, waiting 60s retry
    db.prepare(
      `INSERT INTO orders (id, customer_name, customer_email, status, total_amount, pedido_criado_at_utc, created_at_utc, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(order2Id, 'Rafael Oliveira', 'rafael.oliveira@empresa.com.br', 'PedidoCriado', 2450.0, t2, t2, t2);

    db.prepare(
      `INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), order2Id, 'Monitor Dell UltraSharp 27"', 1, 2450.0, 2450.0);

    db.prepare(
      `INSERT INTO outbox_messages (id, order_id, event_type, payload_json, status, retry_count, next_retry_at_utc, last_error, created_at_utc)
       VALUES (?, ?, 'PedidoCriado', ?, 'FailedWaitingRetry', 1, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      order2Id,
      JSON.stringify({ orderId: order2Id, stamp: 'PedidoCriado', totalAmount: 2450.0 }),
      retryAt,
      'MockInventoryGateway: 503 Service Unavailable — retentativa agendada para +60s.',
      t2
    );

    db.prepare(
      `INSERT INTO message_queue (message_id, order_id, event_type, payload_json, delivery_status, enqueued_at_utc)
       VALUES (?, ?, 'PedidoCriado', ?, 'Enqueued', ?)`
    ).run(crypto.randomUUID(), order2Id, JSON.stringify({ orderId: order2Id }), t2);

    // Order 3: Aborted at creation (no outbox, no inventory notification)
    db.prepare(
      `INSERT INTO orders (id, customer_name, customer_email, status, total_amount, pedido_criado_at_utc, created_at_utc, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(order3Id, 'Lucas Ferreira', 'lucas.f@cliente.com.br', 'PedidoAbortado', 380.0, t3, t3, t3);

    db.prepare(
      `INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), order3Id, 'Headset USB Corporativo', 2, 190.0, 380.0);

    db.exec('COMMIT;');

    writeLog(
      'INFO',
      'API',
      order1Id,
      `Pedido gravado com stamp PedidoCriado (Mariana Costa · 2 itens · R$ 919,80). Outbox criada na mesma transação SQLite.`,
      'ORDER_CREATED',
      { customerName: 'Mariana Costa', itemCount: 2, totalAmount: 919.8, outboxCreated: true },
      t1
    );
    writeLog(
      'INFO',
      'InventoryMock',
      order1Id,
      `Estoque reservado com sucesso para Mariana Costa (R$ 919,80).`,
      'INVENTORY_DISPATCH_SUCCEEDED',
      { attemptNumber: 1, durationMs: 42 },
      t1
    );
    writeLog(
      'ERROR',
      'InventoryMock',
      order2Id,
      `Falha 503 simulada ao reservar estoque. Retry #1 agendado para +60 segundos.`,
      'INVENTORY_DISPATCH_FAILED',
      { attemptNumber: 1, retryDelaySeconds: 60, nextRetryAtUtc: retryAt },
      t2
    );
    writeLog(
      'WARN',
      'API',
      order3Id,
      `Pedido criado como PedidoAbortado. Nenhuma mensagem gerada na Outbox; estoque não notificado.`,
      'ORDER_CREATED',
      { customerName: 'Lucas Ferreira', itemCount: 1, totalAmount: 380, status: 'PedidoAbortado', outboxCreated: false },
      t3
    );
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

function mapOrderRow(row: Record<string, unknown>): OrderDto {
  const items = db
    .prepare(
      'SELECT id, product_name, quantity, unit_price, subtotal FROM order_items WHERE order_id = ?'
    )
    .all(row.id as string) as Array<Record<string, unknown>>;

  const outboxRow = db
    .prepare('SELECT * FROM outbox_messages WHERE order_id = ?')
    .get(row.id as string) as Record<string, unknown> | undefined;

  return {
    id: row.id as string,
    customerName: row.customer_name as string,
    customerEmail: row.customer_email as string,
    status: row.status as OrderDto['status'],
    totalAmount: Number(row.total_amount),
    pedidoCriadoAtUtc: row.pedido_criado_at_utc as string,
    createdAtUtc: row.created_at_utc as string,
    updatedAtUtc: row.updated_at_utc as string,
    items: items.map(
      (i): OrderItemDto => ({
        id: i.id as string,
        productName: i.product_name as string,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unit_price),
        subtotal: Number(i.subtotal),
      })
    ),
    outbox: outboxRow ? mapOutboxRow(outboxRow) : null,
  };
}

function mapOutboxRow(row: Record<string, unknown>): OutboxSummaryDto {
  return {
    id: row.id as string,
    orderId: row.order_id as string,
    eventType: row.event_type as string,
    status: row.status as OutboxSummaryDto['status'],
    retryCount: Number(row.retry_count),
    nextRetryAtUtc: (row.next_retry_at_utc as string | null) ?? null,
    lockedBy: (row.locked_by as string | null) ?? null,
    lockedUntilUtc: (row.locked_until_utc as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAtUtc: row.created_at_utc as string,
    dispatchedAtUtc: (row.dispatched_at_utc as string | null) ?? null,
  };
}

function acquireOutboxBatch(workerId: string, batchSize: number): OutboxSummaryDto[] {
  const nowIso = new Date().toISOString();
  const lockUntilIso = new Date(Date.now() + LOCK_DURATION_MS).toISOString();

  db.exec('BEGIN IMMEDIATE;');
  try {
    const candidates = db
      .prepare(
        `SELECT * FROM outbox_messages
         WHERE status IN ('Pending', 'FailedWaitingRetry')
           AND (next_retry_at_utc IS NULL OR next_retry_at_utc <= ?)
           AND (locked_until_utc IS NULL OR locked_until_utc < ?)
         ORDER BY created_at_utc ASC
         LIMIT ?`
      )
      .all(nowIso, nowIso, batchSize) as Array<Record<string, unknown>>;

    const acquired: OutboxSummaryDto[] = [];
    const lockStmt = db.prepare(
      `UPDATE outbox_messages
       SET status = 'Processing', locked_by = ?, locked_until_utc = ?
       WHERE id = ?
         AND status IN ('Pending', 'FailedWaitingRetry')
         AND (locked_until_utc IS NULL OR locked_until_utc < ?)`
    );

    for (const c of candidates) {
      const res = lockStmt.run(workerId, lockUntilIso, c.id as string, nowIso);
      if (res.changes === 1) {
        acquired.push({
          ...mapOutboxRow(c),
          status: 'Processing',
          lockedBy: workerId,
          lockedUntilUtc: lockUntilIso,
        });
      }
    }

    db.exec('COMMIT;');
    return acquired;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

function runWorkerCycle() {
  const config = getConfig();
  if (!config.workerRunning) return;

  const batch = acquireOutboxBatch(config.workerInstanceId, 5);
  if (batch.length === 0) return;

  for (const msg of batch) {
    const orderRow = db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .get(msg.orderId) as Record<string, unknown> | undefined;

    if (!orderRow || orderRow.status === 'PedidoAbortado') {
      db.prepare(
        `UPDATE outbox_messages
         SET status = 'Cancelled', locked_by = NULL, locked_until_utc = NULL, next_retry_at_utc = NULL
         WHERE id = ?`
      ).run(msg.id);

      writeLog(
        'WARN',
        'Worker',
        msg.orderId,
        `[${config.workerInstanceId}] Pedido está PedidoAbortado. Outbox cancelada; estoque não será avisado.`,
        'OUTBOX_SKIPPED_ABORTED',
        { workerId: config.workerInstanceId }
      );
      continue;
    }

    // 1. Check Message Queue availability
    if (!config.queueAvailable) {
      const nextRetryCount = msg.retryCount + 1;
      const errMsg = 'Message queue simulada está fora do ar (SimulateOutage=true).';

      if (nextRetryCount >= config.maxRetryAttempts) {
        db.prepare(
          `UPDATE outbox_messages
           SET status = 'DeadLetter', retry_count = ?, next_retry_at_utc = NULL,
               last_error = ?, locked_by = NULL, locked_until_utc = NULL
           WHERE id = ?`
        ).run(nextRetryCount, errMsg, msg.id);

        writeLog(
          'ERROR',
          'MessageQueue',
          msg.orderId,
          `[${config.workerInstanceId}] Limite máximo de retentativas (${nextRetryCount}/${config.maxRetryAttempts}) atingido com fila indisponível. Mensagem movida para DeadLetter.`,
          'OUTBOX_MAX_RETRIES_EXCEEDED',
          {
            workerId: config.workerInstanceId,
            attemptNumber: nextRetryCount,
            maxRetryAttempts: config.maxRetryAttempts,
            error: errMsg,
          }
        );
      } else {
        const nextRetry = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
        db.prepare(
          `UPDATE outbox_messages
           SET status = 'FailedWaitingRetry', retry_count = ?,
               next_retry_at_utc = ?, last_error = ?, locked_by = NULL, locked_until_utc = NULL
           WHERE id = ?`
        ).run(nextRetryCount, nextRetry, errMsg, msg.id);

        writeLog(
          'ERROR',
          'MessageQueue',
          msg.orderId,
          `[${config.workerInstanceId}] Fila indisponível. Retentativa #${nextRetryCount}/${config.maxRetryAttempts} agendada em 60s.`,
          'INVENTORY_DISPATCH_FAILED',
          {
            workerId: config.workerInstanceId,
            attemptNumber: nextRetryCount,
            maxRetryAttempts: config.maxRetryAttempts,
            retryDelaySeconds: 60,
            nextRetryAtUtc: nextRetry,
          }
        );
      }
      continue;
    }

    // 2. Enforce Queue Uniqueness via UNIQUE(order_id)
    const nowIso = new Date().toISOString();
    const insertQueue = db.prepare(
      `INSERT OR IGNORE INTO message_queue (message_id, order_id, event_type, payload_json, delivery_status, enqueued_at_utc)
       VALUES (?, ?, ?, ?, 'Enqueued', ?)`
    );
    const qRes = insertQueue.run(
      msg.id,
      msg.orderId,
      msg.eventType,
      JSON.stringify({ orderId: msg.orderId, stamp: 'PedidoCriado' }),
      nowIso
    );

    if (qRes.changes === 1) {
      writeLog(
        'INFO',
        'MessageQueue',
        msg.orderId,
        `Mensagem única enfileirada na Message Queue (OrderId=${msg.orderId.slice(0, 8)}...).`
      );
    } else {
      writeLog(
        'WARN',
        'MessageQueue',
        msg.orderId,
        `Unicidade preservada: mensagem já registrada na fila para este pedido (sem duplicidade).`
      );
    }

    // 3. Call Mocked External Inventory System
    const shouldFailInventory =
      config.inventoryMode === 'failing' ||
      (config.inventoryMode === 'intermittent' && Math.random() < 0.5);

    const attemptStarted = Date.now();
    writeLog(
      'INFO',
      'Worker',
      msg.orderId,
      `[${config.workerInstanceId}] Tentativa #${msg.retryCount + 1} de envio ao sistema de estoque mockado (R$ ${Number(orderRow.total_amount).toFixed(2)}).`,
      'INVENTORY_DISPATCH_ATTEMPT',
      { workerId: config.workerInstanceId, attemptNumber: msg.retryCount + 1, totalAmount: Number(orderRow.total_amount) }
    );

    if (shouldFailInventory) {
      const nextRetryCount = msg.retryCount + 1;
      const durationMs = Date.now() - attemptStarted;
      const errMsg = `MockInventoryGateway: 503 Service Unavailable (${config.inventoryMode}).`;

      if (nextRetryCount >= config.maxRetryAttempts) {
        db.prepare(
          `UPDATE outbox_messages
           SET status = 'DeadLetter', retry_count = ?, next_retry_at_utc = NULL,
               last_error = ?, locked_by = NULL, locked_until_utc = NULL
           WHERE id = ?`
        ).run(nextRetryCount, errMsg, msg.id);

        writeLog(
          'ERROR',
          'InventoryMock',
          msg.orderId,
          `[${config.workerInstanceId}] Limite máximo de retentativas (${nextRetryCount}/${config.maxRetryAttempts}) atingido ao notificar estoque. Movido para DeadLetter.`,
          'OUTBOX_MAX_RETRIES_EXCEEDED',
          {
            workerId: config.workerInstanceId,
            attemptNumber: nextRetryCount,
            maxRetryAttempts: config.maxRetryAttempts,
            durationMs,
            error: errMsg,
          }
        );
      } else {
        const nextRetry = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
        db.prepare(
          `UPDATE outbox_messages
           SET status = 'FailedWaitingRetry', retry_count = ?,
               next_retry_at_utc = ?, last_error = ?, locked_by = NULL, locked_until_utc = NULL
           WHERE id = ?`
        ).run(nextRetryCount, nextRetry, errMsg, msg.id);

        writeLog(
          'ERROR',
          'InventoryMock',
          msg.orderId,
          `[${config.workerInstanceId}] Falha ao notificar sistema de estoque. Retentativa #${nextRetryCount}/${config.maxRetryAttempts} agendada para +60s.`,
          'INVENTORY_DISPATCH_FAILED',
          {
            workerId: config.workerInstanceId,
            attemptNumber: nextRetryCount,
            maxRetryAttempts: config.maxRetryAttempts,
            durationMs,
            retryDelaySeconds: 60,
            nextRetryAtUtc: nextRetry,
            error: errMsg,
          }
        );
      }
      continue;
    }

    // 4. Success: acknowledge queue, mark outbox dispatched, mark order EstoqueReservado
    const doneIso = new Date().toISOString();
    const durationMs = Date.now() - attemptStarted;
    db.exec('BEGIN IMMEDIATE;');
    try {
      // Double check order wasn't aborted during external call
      const latestOrder = db
        .prepare('SELECT status FROM orders WHERE id = ?')
        .get(msg.orderId) as { status: string };

      if (latestOrder.status === 'PedidoAbortado') {
        db.prepare(
          `UPDATE outbox_messages
           SET status = 'Cancelled', locked_by = NULL, locked_until_utc = NULL
           WHERE id = ?`
        ).run(msg.id);
        db.exec('COMMIT;');
        continue;
      }

      db.prepare(
        `UPDATE message_queue
         SET delivery_status = 'Acknowledged', acknowledged_at_utc = ?
         WHERE order_id = ?`
      ).run(doneIso, msg.orderId);

      db.prepare(
        `UPDATE outbox_messages
         SET status = 'Dispatched', dispatched_at_utc = ?, locked_by = NULL,
             locked_until_utc = NULL, next_retry_at_utc = NULL, last_error = NULL
         WHERE id = ?`
      ).run(doneIso, msg.id);

      db.prepare(
        `UPDATE orders
         SET status = 'EstoqueReservado', updated_at_utc = ?
         WHERE id = ?`
      ).run(doneIso, msg.orderId);

      db.exec('COMMIT;');
      writeLog(
        'INFO',
        'InventoryMock',
        msg.orderId,
        `[${config.workerInstanceId}] Estoque reservado com sucesso para ${orderRow.customer_name} (R$ ${Number(orderRow.total_amount).toFixed(2)}).`,
        'INVENTORY_DISPATCH_SUCCEEDED',
        { workerId: config.workerInstanceId, attemptNumber: msg.retryCount + 1, durationMs, completedAtUtc: doneIso }
      );

      const orderItems = db
        .prepare('SELECT product_name, quantity, unit_price FROM order_items WHERE order_id = ?')
        .all(msg.orderId) as Array<{ product_name: string; quantity: number; unit_price: number }>;

      void dispatchWebhookNotification(
        'EstoqueReservado',
        msg.orderId,
        String(orderRow.customer_name),
        Number(orderRow.total_amount),
        orderItems.map((i) => ({
          productName: i.product_name,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unit_price),
        }))
      );
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }
}

function collectDotnetFiles(dir: string, baseDir: string): DotnetSourceFileDto[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: DotnetSourceFileDto[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'bin' || entry.name === 'obj') continue;
      results.push(...collectDotnetFiles(fullPath, baseDir));
    } else {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      const ext = path.extname(entry.name).toLowerCase();
      let language = 'text';
      if (ext === '.cs') language = 'csharp';
      else if (ext === '.csproj' || ext === '.props') language = 'xml';
      else if (ext === '.json') language = 'json';
      else if (ext === '.md') language = 'markdown';
      else if (ext === '.http') language = 'http';

      let project = 'Solution Root';
      if (relPath.startsWith('src/api/')) project = 'api (Web API .NET 10)';
      else if (relPath.startsWith('src/worker/')) project = 'worker (BackgroundService .NET 10)';
      else if (relPath.startsWith('src/Core/OrderReservation.Domain/')) project = 'Core / Domain';
      else if (relPath.startsWith('src/Core/OrderReservation.Application/')) project = 'Core / Application';
      else if (relPath.startsWith('src/Infrastructure/')) project = 'Infrastructure (EF Core 10 + SQLite)';
      else if (relPath.startsWith('tests/api.Tests/')) project = 'Tests / api.Tests';
      else if (relPath.startsWith('tests/worker.Tests/')) project = 'Tests / worker.Tests';

      results.push({
        path: relPath,
        name: entry.name,
        project,
        language,
        content: fs.readFileSync(fullPath, 'utf-8'),
      });
    }
  }

  return results.sort((a, b) => a.path.localeCompare(b.path));
}

async function bootstrap() {
  initializeSchema();
  seedDemoDataIfEmpty();

  const app = express();
  app.use(express.json());

  // POST /api/orders
  app.post('/api/orders', (req, res) => {
    const { customerName, customerEmail, items, abortado } = req.body ?? {};

    if (typeof customerName !== 'string' || !customerName.trim()) {
      return res.status(400).json({
        title: 'Regra de negócio violada',
        detail: 'O nome do cliente é obrigatório.',
      });
    }
    if (typeof customerEmail !== 'string' || !customerEmail.trim()) {
      return res.status(400).json({
        title: 'Regra de negócio violada',
        detail: 'O e-mail do cliente é obrigatório.',
      });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        title: 'Regra de negócio violada',
        detail: 'O pedido deve conter ao menos um item.',
      });
    }

    const normalizedItems: Array<{
      id: string;
      productName: string;
      quantity: number;
      unitPrice: number;
      subtotal: number;
    }> = [];

    for (const item of items) {
      const productName = typeof item?.productName === 'string' ? item.productName.trim() : '';
      const quantity = Number(item?.quantity);
      const unitPrice = Number(item?.unitPrice);

      if (!productName || !Number.isInteger(quantity) || quantity <= 0 || Number.isNaN(unitPrice) || unitPrice < 0) {
        return res.status(400).json({
          title: 'Item inválido',
          detail: 'Cada item precisa de produto, quantidade inteira > 0 e preço unitário >= 0.',
        });
      }

      const roundedPrice = Math.round(unitPrice * 100) / 100;
      const subtotal = Math.round(quantity * roundedPrice * 100) / 100;
      normalizedItems.push({
        id: crypto.randomUUID(),
        productName,
        quantity,
        unitPrice: roundedPrice,
        subtotal,
      });
    }

    const totalAmount =
      Math.round(normalizedItems.reduce((acc, i) => acc + i.subtotal, 0) * 100) / 100;
    const orderId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const isAborted = Boolean(abortado);
    const status = isAborted ? 'PedidoAbortado' : 'PedidoCriado';

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(
        `INSERT INTO orders (id, customer_name, customer_email, status, total_amount, pedido_criado_at_utc, created_at_utc, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        orderId,
        customerName.trim(),
        customerEmail.trim(),
        status,
        totalAmount,
        nowIso,
        nowIso,
        nowIso
      );

      const itemStmt = db.prepare(
        `INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const item of normalizedItems) {
        itemStmt.run(item.id, orderId, item.productName, item.quantity, item.unitPrice, item.subtotal);
      }

      if (!isAborted) {
        const outboxId = crypto.randomUUID();
        const payloadJson = JSON.stringify({
          orderId,
          customerName: customerName.trim(),
          totalAmount,
          stamp: 'PedidoCriado',
          pedidoCriadoAtUtc: nowIso,
          items: normalizedItems,
        });

        db.prepare(
          `INSERT INTO outbox_messages (id, order_id, event_type, payload_json, status, retry_count, created_at_utc)
           VALUES (?, ?, 'PedidoCriado', ?, 'Pending', 0, ?)`
        ).run(outboxId, orderId, payloadJson, nowIso);
      }

      db.exec('COMMIT;');

      writeLog(
        isAborted ? 'WARN' : 'INFO',
        'API',
        orderId,
        isAborted
          ? `Pedido criado como PedidoAbortado (${customerName.trim()} · ${normalizedItems.length} itens · R$ ${totalAmount.toFixed(2)}). Estoque não será avisado.`
          : `Pedido gravado com stamp PedidoCriado (${customerName.trim()} · ${normalizedItems.length} itens · R$ ${totalAmount.toFixed(2)}). Outbox criada na mesma transação.`,
        'ORDER_CREATED',
        { customerName: customerName.trim(), itemCount: normalizedItems.length, totalAmount, status, outboxCreated: !isAborted }
      );

      if (isAborted) {
        void dispatchWebhookNotification(
          'PedidoAbortado',
          orderId,
          customerName.trim(),
          totalAmount,
          normalizedItems.map((i) => ({
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          }))
        );
      }

      const createdRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<
        string,
        unknown
      >;
      return res.status(201).json(mapOrderRow(createdRow));
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  });

  // GET /api/orders/:id
  app.get('/api/orders/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      return res.status(404).json({
        title: 'Recurso não encontrado',
        detail: `Pedido '${req.params.id}' não foi encontrado.`,
      });
    }

    return res.json(mapOrderRow(row));
  });

  // POST /api/orders/:id/abort
  app.post('/api/orders/:id/abort', (req, res) => {
    const orderId = req.params.id;
    const nowIso = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE;');
    try {
      const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as
        | Record<string, unknown>
        | undefined;

      if (!row) {
        db.exec('ROLLBACK;');
        return res.status(404).json({
          title: 'Recurso não encontrado',
          detail: `Pedido '${orderId}' não foi encontrado.`,
        });
      }

      if (row.status === 'EstoqueReservado') {
        db.exec('ROLLBACK;');
        return res.status(400).json({
          title: 'Regra de negócio violada',
          detail: 'Não é possível abortar um pedido cujo estoque já foi reservado.',
        });
      }

      db.prepare('UPDATE orders SET status = ?, updated_at_utc = ? WHERE id = ?').run(
        'PedidoAbortado',
        nowIso,
        orderId
      );

      db.prepare(
        `UPDATE outbox_messages
         SET status = 'Cancelled', locked_by = NULL, locked_until_utc = NULL, next_retry_at_utc = NULL
         WHERE order_id = ? AND status != 'Dispatched'`
      ).run(orderId);

      db.exec('COMMIT;');

      writeLog(
        'WARN',
        'API',
        orderId,
        `Pedido abortado via POST /api/orders/${orderId.slice(0, 8)}.../abort. Outbox cancelada; estoque não será notificado.`,
        'ORDER_ABORTED',
        { orderId, outboxCancelled: true }
      );

      const updatedRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<
        string,
        unknown
      >;
      const mapped = mapOrderRow(updatedRow);
      void dispatchWebhookNotification(
        'PedidoAbortado',
        orderId,
        mapped.customerName,
        mapped.totalAmount,
        mapped.items.map((i) => ({
          productName: i.productName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        }))
      );
      return res.json(mapped);
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  });

  // Simulator endpoints
  app.get('/api/simulator/state', (_req, res) => {
    const orderRows = db
      .prepare('SELECT * FROM orders ORDER BY created_at_utc DESC')
      .all() as Array<Record<string, unknown>>;

    const outboxRows = db
      .prepare('SELECT * FROM outbox_messages ORDER BY created_at_utc DESC')
      .all() as Array<Record<string, unknown>>;

    const queueRows = db
      .prepare('SELECT * FROM message_queue ORDER BY enqueued_at_utc DESC')
      .all() as Array<Record<string, unknown>>;

    const logRows = db
      .prepare('SELECT * FROM worker_logs ORDER BY id DESC LIMIT 80')
      .all() as Array<Record<string, unknown>>;

    return res.json({
      orders: orderRows.map(mapOrderRow),
      outboxMessages: outboxRows.map(mapOutboxRow),
      queueRecords: queueRows.map(
        (q): QueueRecordDto => ({
          messageId: q.message_id as string,
          orderId: q.order_id as string,
          eventType: q.event_type as string,
          deliveryStatus: q.delivery_status as QueueRecordDto['deliveryStatus'],
          enqueuedAtUtc: q.enqueued_at_utc as string,
          acknowledgedAtUtc: (q.acknowledged_at_utc as string | null) ?? null,
        })
      ),
      logs: logRows.map(
        (l): WorkerLogDto => ({
          id: Number(l.id),
          timestampUtc: l.timestamp_utc as string,
          level: l.level as WorkerLogDto['level'],
          source: l.source as WorkerLogDto['source'],
          eventCode: (l.event_code as string) || 'SYSTEM_EVENT',
          orderId: (l.order_id as string | null) ?? null,
          message: l.message as string,
          detailsJson: (l.details_json as string | null) ?? null,
        })
      ),
      inventoryMetrics30m: buildInventoryMetrics30m(),
      webhookConfig: getWebhookConfig(),
      webhookDeliveries: getWebhookDeliveries(),
      config: getConfig(),
      serverUtcNow: new Date().toISOString(),
    });
  });

  app.post('/api/simulator/config', (req, res) => {
    const { queueAvailable, inventoryMode, workerRunning, maxRetryAttempts } = req.body ?? {};
    const upsert = db.prepare(
      'INSERT OR REPLACE INTO simulation_config (key, value) VALUES (?, ?)'
    );

    if (maxRetryAttempts !== undefined) {
      const parsed = Number(maxRetryAttempts);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
        return res.status(400).json({
          title: 'Configuração inválida',
          detail: 'O limite máximo de retentativas deve ser um número inteiro entre 1 e 50.',
        });
      }
      upsert.run('max_retry_attempts', String(parsed));
      writeLog(
        'INFO',
        'Worker',
        null,
        `Limite máximo de retentativas do Worker atualizado para ${parsed} tentativa(s) e persistido no SQLite.`,
        'WORKER_CONFIG_UPDATED',
        { maxRetryAttempts: parsed }
      );
    }

    if (typeof queueAvailable === 'boolean') {
      upsert.run('queue_available', String(queueAvailable));
      writeLog(
        queueAvailable ? 'INFO' : 'WARN',
        'MessageQueue',
        null,
        queueAvailable
          ? 'Fila de mensagens restabelecida (disponível).'
          : 'Simulação ativada: Fila de mensagens marcada como INDISPONÍVEL.'
      );
    }

    if (inventoryMode === 'healthy' || inventoryMode === 'failing' || inventoryMode === 'intermittent') {
      upsert.run('inventory_mode', inventoryMode);
      writeLog(
        inventoryMode === 'healthy' ? 'INFO' : 'WARN',
        'InventoryMock',
        null,
        `Modo do sistema de estoque mockado alterado para '${inventoryMode}'.`
      );
    }

    if (typeof workerRunning === 'boolean') {
      upsert.run('worker_running', String(workerRunning));
      writeLog(
        workerRunning ? 'INFO' : 'WARN',
        'Worker',
        null,
        workerRunning ? 'Background Worker retomado.' : 'Background Worker pausado pelo operador.'
      );
    }

    return res.json(getConfig());
  });

  app.post('/api/simulator/advance-retry/:orderId', (req, res) => {
    const nowIso = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE outbox_messages
         SET next_retry_at_utc = ?
         WHERE order_id = ? AND status = 'FailedWaitingRetry'`
      )
      .run(nowIso, req.params.orderId);

    if (result.changes > 0) {
      writeLog(
        'INFO',
        'Worker',
        req.params.orderId,
        'Operador adiantou o timer de 60s para disparo imediato na próxima varredura.'
      );
    }

    return res.json({ updated: result.changes > 0 });
  });

  app.post('/api/simulator/requeue/:orderId', (req, res) => {
    const result = db
      .prepare(
        `UPDATE outbox_messages
         SET status = 'Pending', retry_count = 0, next_retry_at_utc = NULL,
             last_error = NULL, locked_by = NULL, locked_until_utc = NULL
         WHERE order_id = ? AND status = 'DeadLetter'`
      )
      .run(req.params.orderId);

    if (result.changes > 0) {
      writeLog(
        'INFO',
        'Worker',
        req.params.orderId,
        'Mensagem DeadLetter reenfileirada manualmente pelo operador com contador de tentativas zerado.',
        'OUTBOX_REQUEUED',
        { orderId: req.params.orderId }
      );
    }

    return res.json({ requeued: result.changes > 0 });
  });

  app.post('/api/simulator/test-concurrency/:orderId', (req, res) => {
    const orderId = req.params.orderId;
    const outbox = db
      .prepare('SELECT * FROM outbox_messages WHERE order_id = ?')
      .get(orderId) as Record<string, unknown> | undefined;

    if (!outbox) {
      return res.status(404).json({ detail: 'Mensagem Outbox não encontrada para este pedido.' });
    }

    const nowIso = new Date().toISOString();
    const lockUntilIso = new Date(Date.now() + LOCK_DURATION_MS).toISOString();

    // Simulate Worker-A acquiring lease and Worker-B racing immediately after
    db.exec('BEGIN IMMEDIATE;');
    const r1 = db
      .prepare(
        `UPDATE outbox_messages
         SET locked_by = 'worker-node-A', locked_until_utc = ?
         WHERE id = ? AND (locked_until_utc IS NULL OR locked_until_utc < ?)`
      )
      .run(lockUntilIso, outbox.id as string, nowIso);

    const r2 = db
      .prepare(
        `UPDATE outbox_messages
         SET locked_by = 'worker-node-B', locked_until_utc = ?
         WHERE id = ? AND (locked_until_utc IS NULL OR locked_until_utc < ?)`
      )
      .run(lockUntilIso, outbox.id as string, nowIso);

    // Release simulation lock immediately so real worker isn't blocked for 30s
    db.prepare('UPDATE outbox_messages SET locked_by = NULL, locked_until_utc = NULL WHERE id = ?').run(
      outbox.id as string
    );
    db.exec('COMMIT;');

    writeLog(
      'INFO',
      'Worker',
      orderId,
      `Teste de concorrência: worker-node-A obteve lock (${r1.changes} linha). worker-node-B bloqueado (${r2.changes} linhas) — envio simultâneo impedido.`
    );

    // Test queue uniqueness
    const qAttempt = db
      .prepare(
        `INSERT OR IGNORE INTO message_queue (message_id, order_id, event_type, payload_json, delivery_status, enqueued_at_utc)
         VALUES (?, ?, 'PedidoCriado', '{}', 'Enqueued', ?)`
      )
      .run(crypto.randomUUID(), orderId, nowIso);

    writeLog(
      'INFO',
      'MessageQueue',
      orderId,
      qAttempt.changes === 0
        ? 'Teste de unicidade na fila: inserção duplicada rejeitada pela restrição UNIQUE(order_id).'
        : 'Teste de unicidade na fila: primeira entrada registrada com chave única OrderId.'
    );

    return res.json({
      workerALockAcquired: r1.changes === 1,
      workerBBlocked: r2.changes === 0,
      duplicateQueuePrevented: qAttempt.changes === 0,
    });
  });

  app.post('/api/simulator/webhook/config', (req, res) => {
    const {
      enabled,
      endpointUrl,
      hmacSecret,
      notifyOnEstoqueReservado,
      notifyOnPedidoAbortado,
    } = req.body ?? {};

    const current = getWebhookConfig();
    const nextEnabled = typeof enabled === 'boolean' ? enabled : current.enabled;
    const nextUrl = typeof endpointUrl === 'string' ? endpointUrl.trim() : current.endpointUrl;
    const nextSecret = typeof hmacSecret === 'string' ? hmacSecret : current.hmacSecret;
    const nextEstoque =
      typeof notifyOnEstoqueReservado === 'boolean'
        ? notifyOnEstoqueReservado
        : current.notifyOnEstoqueReservado;
    const nextAbort =
      typeof notifyOnPedidoAbortado === 'boolean'
        ? notifyOnPedidoAbortado
        : current.notifyOnPedidoAbortado;

    db.prepare(
      `UPDATE webhook_config
       SET enabled = ?, endpoint_url = ?, hmac_secret = ?, notify_estoque_reservado = ?, notify_pedido_abortado = ?, updated_at_utc = ?
       WHERE id = 1`
    ).run(
      nextEnabled ? 1 : 0,
      nextUrl,
      nextSecret,
      nextEstoque ? 1 : 0,
      nextAbort ? 1 : 0,
      new Date().toISOString()
    );

    writeLog(
      'INFO',
      'API',
      null,
      `Configuração de Webhook atualizada (Ativo=${nextEnabled}, URL=${nextUrl || 'não definida'}).`,
      'WEBHOOK_CONFIG_UPDATED',
      { enabled: nextEnabled, endpointUrl: nextUrl, hasSecret: Boolean(nextSecret) }
    );

    return res.json(getWebhookConfig());
  });

  app.post('/api/simulator/webhook/test', async (req, res) => {
    const { endpointUrl, hmacSecret } = req.body ?? {};
    try {
      const delivery = await dispatchWebhookNotification(
        'WebhookTest',
        crypto.randomUUID(),
        'Teste de Integração Webhook',
        199.9,
        [{ productName: 'Item de Teste Webhook', quantity: 1, unitPrice: 199.9 }],
        {
          overrideUrl: typeof endpointUrl === 'string' ? endpointUrl : undefined,
          overrideSecret: typeof hmacSecret === 'string' ? hmacSecret : undefined,
          forceSend: true,
        }
      );
      return res.json(delivery);
    } catch (err) {
      return res.status(400).json({
        detail: err instanceof Error ? err.message : 'Falha ao disparar teste de Webhook.',
      });
    }
  });

  app.post('/api/simulator/webhook-sink', (req, res) => {
    const cfg = getWebhookConfig();
    const signatureHeader = req.header('x-orderreservation-signature');
    const eventHeader = req.header('x-orderreservation-event') ?? req.body?.eventType ?? 'Unknown';
    let signatureVerified: boolean | null = null;

    if (cfg.hmacSecret) {
      const expected = `sha256=${crypto
        .createHmac('sha256', cfg.hmacSecret)
        .update(JSON.stringify(req.body))
        .digest('hex')}`;
      signatureVerified = signatureHeader === expected;
    }

    return res.status(200).json({
      received: true,
      eventType: eventHeader,
      orderId: req.body?.orderId ?? null,
      signatureVerified,
      receivedAtUtc: new Date().toISOString(),
    });
  });

  app.post('/api/simulator/reset', (req, res) => {
    const withSeed = req.body?.seed !== false;
    db.exec(`
      DELETE FROM webhook_deliveries;
      DELETE FROM worker_logs;
      DELETE FROM message_queue;
      DELETE FROM outbox_messages;
      DELETE FROM order_items;
      DELETE FROM orders;
    `);
    if (withSeed) {
      seedDemoDataIfEmpty();
    } else {
      writeLog('INFO', 'API', null, 'Base SQLite limpa pelo operador.');
    }
    return res.json({ ok: true });
  });

  app.get('/api/dotnet/files', (_req, res) => {
    const files = collectDotnetFiles(DOTNET_ROOT, DOTNET_ROOT);
    return res.json({ files });
  });

  // Start background worker polling every 2 seconds
  const workerTimer = setInterval(() => {
    try {
      runWorkerCycle();
    } catch (err) {
      console.error('Worker cycle error:', err);
    }
  }, 2000);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });

  process.on('SIGTERM', () => {
    clearInterval(workerTimer);
    server.close();
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
