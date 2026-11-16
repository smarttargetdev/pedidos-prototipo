import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Eye, Send, Save, Webhook, XCircle } from 'lucide-react';
import type { WebhookConfigDto, WebhookDeliveryDto } from '../types';

interface WebhookSettingsPanelProps {
  config?: WebhookConfigDto;
  deliveries: WebhookDeliveryDto[];
  onRefresh: () => Promise<void>;
}

export function WebhookSettingsPanel({
  config,
  deliveries,
  onRefresh,
}: WebhookSettingsPanelProps) {
  const [initialized, setInitialized] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [endpointUrl, setEndpointUrl] = useState('');
  const [hmacSecret, setHmacSecret] = useState('');
  const [notifyEstoque, setNotifyEstoque] = useState(true);
  const [notifyAbortado, setNotifyAbortado] = useState(true);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null);

  useEffect(() => {
    if (!config || initialized) return;
    setEnabled(config.enabled);
    setEndpointUrl(config.endpointUrl);
    setHmacSecret(config.hmacSecret);
    setNotifyEstoque(config.notifyOnEstoqueReservado);
    setNotifyAbortado(config.notifyOnPedidoAbortado);
    setInitialized(true);
  }, [config, initialized]);

  const handleUseSimulatedSink = () => {
    const sinkUrl = `${window.location.origin}/api/simulator/webhook-sink`;
    setEndpointUrl(sinkUrl);
    setEnabled(true);
    setStatusMessage(null);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/simulator/webhook/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          endpointUrl,
          hmacSecret,
          notifyOnEstoqueReservado: notifyEstoque,
          notifyOnPedidoAbortado: notifyAbortado,
        }),
      });
      if (!res.ok) {
        setStatusMessage({ ok: false, text: 'Erro ao salvar configuração de Webhook.' });
        return;
      }
      await onRefresh();
      setStatusMessage({
        ok: true,
        text: enabled
          ? 'Configuração salva. Notificações HTTP POST ativas.'
          : 'Configuração salva (Webhook desativado).',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestWebhook = async () => {
    setTesting(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/simulator/webhook/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpointUrl, hmacSecret }),
      });
      const body = await res.json();
      if (!res.ok) {
        setStatusMessage({
          ok: false,
          text: body.detail || 'Falha ao enviar teste de Webhook.',
        });
        return;
      }
      const delivery = body as WebhookDeliveryDto;
      await onRefresh();
      setStatusMessage({
        ok: delivery.success,
        text: delivery.success
          ? `Teste entregue com sucesso: HTTP ${delivery.httpStatus} em ${delivery.durationMs}ms.`
          : `Falha no teste: ${delivery.errorMessage || `HTTP ${delivery.httpStatus}`}.`,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Webhook className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Configurações de Webhook
            </h2>
            <p className="text-[11px] text-slate-500">
              Dispara HTTP POST automático ao transitar para EstoqueReservado ou PedidoAbortado
            </p>
          </div>
        </div>

        <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setEnabled(true)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              enabled
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Ativo
          </button>
          <button
            type="button"
            onClick={() => setEnabled(false)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              !enabled
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Inativo
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="p-5 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
          <div className="lg:col-span-7">
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="webhook-url" className="text-xs font-medium text-slate-700">
                URL do Endpoint (POST)
              </label>
              <button
                type="button"
                onClick={handleUseSimulatedSink}
                className="text-[11px] font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
              >
                Usar Receptor Simulado Integrado
              </button>
            </div>
            <input
              id="webhook-url"
              type="text"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://parceiro.exemplo.com/webhooks/pedidos"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="lg:col-span-5">
            <label htmlFor="webhook-secret" className="block text-xs font-medium text-slate-700 mb-1">
              Segredo HMAC-SHA256 (Opcional)
            </label>
            <input
              id="webhook-secret"
              type="text"
              value={hmacSecret}
              onChange={(e) => setHmacSecret(e.target.value)}
              placeholder="Gera cabeçalho X-OrderReservation-Signature"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div className="flex flex-wrap items-center gap-5 text-xs text-slate-700">
            <span className="text-slate-500 font-medium">Eventos assinados:</span>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyEstoque}
                onChange={(e) => setNotifyEstoque(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-blue-600"
              />
              <span className="font-mono">EstoqueReservado</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyAbortado}
                onChange={(e) => setNotifyAbortado(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-blue-600"
              />
              <span className="font-mono">PedidoAbortado</span>
            </label>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={testing || !endpointUrl.trim()}
              onClick={handleTestWebhook}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              {testing ? 'Enviando...' : 'Testar Webhook'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" aria-hidden="true" />
              {saving ? 'Salvando...' : 'Salvar Configuração'}
            </button>
          </div>
        </div>

        {statusMessage && (
          <div
            className={`text-xs px-3 py-2 rounded-lg border ${
              statusMessage.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {statusMessage.text}
          </div>
        )}
      </form>

      {/* Delivery History */}
      <div className="border-t border-slate-200">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">
            Histórico de Entregas Webhook
          </span>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {deliveries.length} registro(s)
          </span>
        </div>

        {deliveries.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Nenhuma notificação Webhook disparada ainda. Configure uma URL acima ou utilize o receptor simulado integrado.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {deliveries.map((d) => {
              const isExpanded = expandedDeliveryId === d.id;
              return (
                <div key={d.id} className="px-5 py-3 text-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                      {d.success ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700 whitespace-nowrap">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          HTTP {d.httpStatus}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-red-700 whitespace-nowrap">
                          <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          {d.httpStatus ? `HTTP ${d.httpStatus}` : 'Erro de Rede'}
                        </span>
                      )}
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-mono font-semibold text-slate-800">{d.eventType}</span>
                      {d.orderId && (
                        <>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            Order {d.orderId.slice(0, 8)}...
                          </span>
                        </>
                      )}
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-mono text-slate-500 truncate max-w-xs">{d.targetUrl}</span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums text-slate-500">
                      <span>{d.durationMs}ms</span>
                      <span>{new Date(d.createdAtUtc).toLocaleTimeString('pt-BR')}</span>
                      <button
                        type="button"
                        onClick={() => setExpandedDeliveryId(isExpanded ? null : d.id)}
                        className="inline-flex items-center gap-1 font-sans text-xs font-medium text-slate-700 hover:text-slate-900"
                      >
                        <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                        {isExpanded ? 'Ocultar' : 'Payload'}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="bg-slate-950 text-slate-200 rounded-lg p-3 font-mono text-[11px] space-y-1.5 overflow-x-auto">
                      {d.signatureHeader && (
                        <div className="text-sky-300">
                          X-OrderReservation-Signature: {d.signatureHeader}
                        </div>
                      )}
                      <pre className="text-slate-100 whitespace-pre-wrap">
                        {JSON.stringify(JSON.parse(d.payloadJson), null, 2)}
                      </pre>
                      {d.responsePreview && (
                        <div className="text-emerald-300 pt-1 border-t border-slate-800">
                          Resposta: {d.responsePreview}
                        </div>
                      )}
                      {d.errorMessage && (
                        <div className="text-red-400 pt-1 border-t border-slate-800">
                          Erro: {d.errorMessage}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
