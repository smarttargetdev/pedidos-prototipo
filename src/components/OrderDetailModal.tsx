import { useState } from 'react';
import { X, Copy, Check, ShieldCheck, Ban, FastForward, RotateCw } from 'lucide-react';
import type { OrderDto } from '../types';
import { OrderStatusText, OutboxStatusText } from './StatusText';

interface OrderDetailModalProps {
  order: OrderDto;
  nowMs: number;
  maxRetryAttempts: number;
  onClose: () => void;
  onAbort: (orderId: string) => Promise<void>;
  onAdvanceRetry: (orderId: string) => Promise<void>;
  onRequeue: (orderId: string) => Promise<void>;
  onTestConcurrency: (orderId: string) => Promise<void>;
}

export function OrderDetailModal({
  order,
  nowMs,
  maxRetryAttempts,
  onClose,
  onAbort,
  onAdvanceRetry,
  onRequeue,
  onTestConcurrency,
}: OrderDetailModalProps) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [concurrencyMsg, setConcurrencyMsg] = useState<string | null>(null);

  const retrySeconds =
    order.outbox?.nextRetryAtUtc
      ? Math.max(0, Math.ceil((new Date(order.outbox.nextRetryAtUtc).getTime() - nowMs) / 1000))
      : null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(order.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleConcurrency = async () => {
    setBusy(true);
    setConcurrencyMsg(null);
    try {
      await onTestConcurrency(order.id);
      setConcurrencyMsg(
        'Simulação executada: Worker A obteve o lock exclusivo no SQLite e Worker B foi bloqueado; fila manteve unicidade.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-detail-title"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl overflow-hidden shadow-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 id="order-detail-title" className="text-base font-semibold text-slate-900">
              Detalhes do Pedido
            </h2>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
              <span>{order.id}</span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado' : 'Copiar ID'}</span>
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar detalhes"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-5 border-b border-slate-100">
            <div>
              <div className="text-xs text-slate-500">Cliente</div>
              <div className="mt-1 text-sm font-medium text-slate-900">{order.customerName}</div>
              <div className="text-xs text-slate-500">{order.customerEmail}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Status do Pedido</div>
              <div className="mt-1">
                <OrderStatusText status={order.status} />
              </div>
              <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                Stamp PedidoCriado: {new Date(order.pedidoCriadoAtUtc).toLocaleString('pt-BR')}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-700 mb-2">
              Itens do Pedido ({order.items.length})
            </h3>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Produto</th>
                    <th className="text-right font-medium px-3 py-2">Qtd</th>
                    <th className="text-right font-medium px-3 py-2">Preço Unit.</th>
                    <th className="text-right font-medium px-3 py-2">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-slate-800">{item.productName}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                        {item.quantity}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                        R$ {item.unitPrice.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-slate-900">
                        R$ {item.subtotal.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-xs font-medium text-slate-600">
                      Total Calculado no Servidor
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                      R$ {order.totalAmount.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">
              Registro na Outbox (SQLite)
            </h3>
            {order.outbox ? (
              <div className="space-y-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <OutboxStatusText status={order.outbox.status} secondsRemaining={retrySeconds} />
                  <span className="font-mono tabular-nums text-slate-500">
                    Tentativas: {order.outbox.retryCount} / {maxRetryAttempts}
                  </span>
                </div>
                {order.outbox.lastError && (
                  <div className="text-red-700 font-mono text-[11px] pt-1">
                    Último erro: {order.outbox.lastError}
                  </div>
                )}
                {order.outbox.dispatchedAtUtc && (
                  <div className="text-emerald-700 font-mono text-[11px]">
                    Despachado em: {new Date(order.outbox.dispatchedAtUtc).toLocaleString('pt-BR')}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Nenhuma mensagem Outbox gerada porque o pedido foi criado como PedidoAbortado.
              </p>
            )}
          </div>

          {concurrencyMsg && (
            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              {concurrencyMsg}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            {order.outbox && (
              <button
                type="button"
                disabled={busy}
                onClick={handleConcurrency}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Testar Lock & Unicidade
              </button>
            )}
            {order.outbox?.status === 'FailedWaitingRetry' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onAdvanceRetry(order.id)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 whitespace-nowrap shrink-0"
              >
                <FastForward className="w-3.5 h-3.5" />
                Adiantar Timer (60s)
              </button>
            )}
            {order.outbox?.status === 'DeadLetter' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRequeue(order.id)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap shrink-0"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Reenfileirar Outbox
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {order.status === 'PedidoCriado' && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onAbort(order.id);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 whitespace-nowrap shrink-0"
              >
                <Ban className="w-3.5 h-3.5" />
                Abortar Pedido
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
