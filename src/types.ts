export type OrderStatus = 'PedidoCriado' | 'PedidoAbortado' | 'EstoqueReservado';

export type OutboxStatus =
  | 'Pending'
  | 'Processing'
  | 'Dispatched'
  | 'FailedWaitingRetry'
  | 'Cancelled';

export type InventoryMode = 'healthy' | 'failing' | 'intermittent';

export interface OrderItemDto {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface OutboxSummaryDto {
  id: string;
  orderId: string;
  eventType: string;
  status: OutboxStatus;
  retryCount: number;
  nextRetryAtUtc: string | null;
  lockedBy: string | null;
  lockedUntilUtc: string | null;
  lastError: string | null;
  createdAtUtc: string;
  dispatchedAtUtc: string | null;
}

export interface OrderDto {
  id: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  totalAmount: number;
  pedidoCriadoAtUtc: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  items: OrderItemDto[];
  outbox: OutboxSummaryDto | null;
}

export interface QueueRecordDto {
  messageId: string;
  orderId: string;
  eventType: string;
  deliveryStatus: 'Enqueued' | 'Acknowledged';
  enqueuedAtUtc: string;
  acknowledgedAtUtc: string | null;
}

export interface WorkerLogDto {
  id: number;
  timestampUtc: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  source: 'API' | 'Worker' | 'MessageQueue' | 'InventoryMock';
  eventCode: string;
  orderId: string | null;
  message: string;
  detailsJson: string | null;
}

export interface SimulatorConfigDto {
  queueAvailable: boolean;
  inventoryMode: InventoryMode;
  workerRunning: boolean;
  workerInstanceId: string;
}

export interface SimulatorStateDto {
  orders: OrderDto[];
  outboxMessages: OutboxSummaryDto[];
  queueRecords: QueueRecordDto[];
  logs: WorkerLogDto[];
  config: SimulatorConfigDto;
  serverUtcNow: string;
}

export interface DotnetSourceFileDto {
  path: string;
  name: string;
  project: string;
  language: string;
  content: string;
}
