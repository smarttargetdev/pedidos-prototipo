import { useState, type FormEvent } from 'react';
import { Plus, Trash2, Search, Send, Ban } from 'lucide-react';
import type { OrderDto } from '../types';
import { OrderStatusText, OutboxStatusText } from './StatusText';

interface CreateAndQueryViewProps {
  recentOrders: OrderDto[];
  onOrderCreated: () => Promise<void>;
  onAbortOrder: (orderId: string) => Promise<void>;
}

interface DraftItem {
  productName: string;
  quantity: number;
  unitPrice: number;
}

export function CreateAndQueryView({
  recentOrders,
  onOrderCreated,
  onAbortOrder,
}: CreateAndQueryViewProps) {
  const [customerName, setCustomerName] = useState('Fernanda Almeida');
  const [customerEmail, setCustomerEmail] = useState('fernanda.almeida@loja.com.br');
  const [abortado, setAbortado] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([
    { productName: 'Notebook Workstation 16"', quantity: 1, unitPrice: 6490.0 },
    { productName: 'Hub USB-C Thunderbolt', quantity: 2, unitPrice: 320.0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<OrderDto | null>(null);

  const [lookupId, setLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState<OrderDto | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const computedTotal = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
    0
  );

  const addItem = () => {
    setItems((prev) => [...prev, { productName: '', quantity: 1, unitPrice: 100 }]);
  };

  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setApiError(null);

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName, customerEmail, items, abortado }),
      });
      const body = await res.json();
      if (!res.ok) {
        setApiError(body.detail || 'Erro ao criar pedido.');
        return;
      }

      setCreatedResult(body);
      setLookupId(body.id);
      setLookupResult(body);
      setLookupError(null);
      await onOrderCreated();
    } catch {
      setApiError('Falha de comunicação com a API.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLookup = async (idToFetch?: string) => {
    const targetId = (idToFetch ?? lookupId).trim();
    if (!targetId) return;

    setLookupLoading(true);
    setLookupError(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(targetId)}`);
      const body = await res.json();
      if (!res.ok) {
        setLookupResult(null);
        setLookupError(body.detail || 'Pedido não encontrado.');
        return;
      }
      setLookupId(targetId);
      setLookupResult(body);
    } catch {
      setLookupError('Erro ao consultar o pedido.');
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* POST /api/orders */}
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Criar Pedido na API
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              POST /api/orders · Transação ACID + stamp PedidoCriado
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Total Estimado</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900">
              R$ {computedTotal.toFixed(2)}
            </div>
          </div>
        </div>

        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nome do Cliente
              </label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                E-mail do Cliente
              </label>
              <input
                type="email"
                required
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">Lista de Itens</span>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar Item
              </button>
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center bg-slate-50 border border-slate-200 rounded-lg p-2.5"
                >
                  <div className="col-span-6">
                    <input
                      type="text"
                      required
                      placeholder="Nome do produto"
                      value={item.productName}
                      onChange={(e) => updateItem(idx, { productName: e.target.value })}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      min={1}
                      required
                      aria-label="Quantidade"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="col-span-3">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      aria-label="Preço unitário"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      disabled={items.length <= 1}
                      onClick={() => removeItem(idx)}
                      aria-label="Remover item"
                      className="p-1.5 text-slate-400 hover:text-red-600 disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={abortado}
              onChange={(e) => setAbortado(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-blue-600"
            />
            <span className="text-xs text-slate-700 leading-relaxed">
              <strong className="font-semibold text-slate-900">Criar como Pedido Abortado</strong> — grava o registro no SQLite com status <span className="font-mono">PedidoAbortado</span> e não envia evento para a Outbox nem para o sistema de estoque.
            </span>
          </label>

          {apiError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {apiError}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              {submitting ? 'Gravando no SQLite...' : 'Registrar Pedido'}
            </button>
          </div>
        </form>

        {createdResult && (
          <div className="pt-4 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Última Resposta (201 Created)</span>
              <OrderStatusText status={createdResult.status} />
            </div>
            <pre className="text-[11px] font-mono bg-slate-900 text-slate-100 p-3.5 rounded-lg overflow-x-auto tabular-nums">
              {JSON.stringify(createdResult, null, 2)}
            </pre>
          </div>
        )}
      </section>

      {/* GET /api/orders/{id} */}
      <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-base font-semibold text-slate-900">
            Consultar por Identificador Único
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 font-mono">
            GET /api/orders/&#123;id&#125;
          </p>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="Cole o GUID único do pedido..."
            className="flex-1 min-w-0 px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
          />
          <button
            type="button"
            onClick={() => handleLookup()}
            disabled={lookupLoading || !lookupId.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Search className="w-3.5 h-3.5" />
            Consultar
          </button>
        </div>

        {recentOrders.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs text-slate-500">Consultas rápidas recentes</div>
            <div className="flex flex-wrap gap-1.5">
              {recentOrders.slice(0, 4).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => handleLookup(o.id)}
                  className="px-2.5 py-1 text-[11px] font-mono text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200 whitespace-nowrap"
                >
                  {o.id.slice(0, 8)} · {o.customerName.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        )}

        {lookupError && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {lookupError}
          </div>
        )}

        {lookupResult ? (
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {lookupResult.customerName}
                </div>
                <div className="text-xs text-slate-500 font-mono">{lookupResult.id}</div>
              </div>
              <OrderStatusText status={lookupResult.status} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div>
                <div className="text-slate-500">Total Calculado</div>
                <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                  R$ {lookupResult.totalAmount.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Stamp PedidoCriado</div>
                <div className="font-mono tabular-nums text-slate-800 mt-0.5">
                  {new Date(lookupResult.pedidoCriadoAtUtc).toLocaleTimeString('pt-BR')}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-slate-500 mb-1">Estado Outbox</div>
                {lookupResult.outbox ? (
                  <OutboxStatusText status={lookupResult.outbox.status} />
                ) : (
                  <span className="text-slate-600">Sem registro na Outbox (Abortado)</span>
                )}
              </div>
            </div>

            {lookupResult.status === 'PedidoCriado' && (
              <button
                type="button"
                onClick={async () => {
                  await onAbortOrder(lookupResult.id);
                  await handleLookup(lookupResult.id);
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 whitespace-nowrap"
              >
                <Ban className="w-3.5 h-3.5" />
                Abortar Pedido Antes do Envio (POST /abort)
              </button>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-500 py-8 text-center border border-dashed border-slate-200 rounded-lg">
            Informe um identificador único acima para inspecionar o registro gravado no SQLite.
          </div>
        )}
      </section>
    </div>
  );
}
