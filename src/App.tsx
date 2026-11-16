import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Code2,
  Database,
  Download,
  FilePlus2,
  Menu,
  Pause,
  Play,
  RotateCcw,
  Search,
  Trash2,
  X,
  RotateCw,
} from 'lucide-react';
import type { InventoryMode, OrderDto, SimulatorStateDto } from './types';
import { OrderStatusText, OutboxStatusText } from './components/StatusText';
import { OrderDetailModal } from './components/OrderDetailModal';
import { CreateAndQueryView } from './components/CreateAndQueryView';
import { DotnetCodeExplorer } from './components/DotnetCodeExplorer';
import { InventoryMetricsChart } from './components/InventoryMetricsChart';
import { OperationalAlerts, type OperationalAlert } from './components/OperationalAlerts';
import { WebhookSettingsPanel } from './components/WebhookSettingsPanel';

type ActiveTab = 'overview' | 'orders-api' | 'dotnet-code';
type StatusFilter = 'ALL' | 'PedidoCriado' | 'EstoqueReservado' | 'PedidoCancelado';
type LogLevelFilter = 'ALL' | 'INFO' | 'WARN' | 'ERROR';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [state, setState] = useState<SimulatorStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>('ALL');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [customRetryLimit, setCustomRetryLimit] = useState<string>('5');
  const [retryLimitSavedMsg, setRetryLimitSavedMsg] = useState<string | null>(null);
  const [retryLimitError, setRetryLimitError] = useState<string | null>(null);

  const initializedAlertsRef = useRef(false);
  const seenCancelledIdsRef = useRef<Set<string>>(new Set());
  const lastSeenErrorLogIdRef = useRef<number>(0);
  const lastErrorBurstAlertAtRef = useRef<number>(0);

  const dismissAlert = useCallback((alertId: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }, []);

  const pushAlert = useCallback((alert: OperationalAlert, ttlMs: number) => {
    setAlerts((prev) => [alert, ...prev].slice(0, 4));
    setTimeout(() => {
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    }, ttlMs);
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/simulator/state');
      if (!res.ok) return;
      const data: SimulatorStateDto = await res.json();
      setState(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (state?.config.maxRetryAttempts !== undefined) {
      setCustomRetryLimit(String(state.config.maxRetryAttempts));
    }
  }, [state?.config.maxRetryAttempts]);

  useEffect(() => {
    fetchState();
    const poll = setInterval(fetchState, 2000);
    const clock = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [fetchState]);

  useEffect(() => {
    if (!state) return;

    const cancelledOrders = state.orders.filter((o) => o.status === 'PedidoCancelado');
    const errorLogs = state.logs.filter((l) => l.level === 'ERROR');
    const maxErrorId = errorLogs.reduce((max, l) => Math.max(max, l.id), 0);

    // Baseline existing records on initial load so no arrival banners fire prematurely
    if (!initializedAlertsRef.current) {
      initializedAlertsRef.current = true;
      seenCancelledIdsRef.current = new Set(cancelledOrders.map((o) => o.id));
      lastSeenErrorLogIdRef.current = maxErrorId;
      return;
    }

    // 1. Detect newly cancelled orders
    for (const order of cancelledOrders) {
      if (!seenCancelledIdsRef.current.has(order.id)) {
        seenCancelledIdsRef.current.add(order.id);
        pushAlert(
          {
            id: `cancelled-${order.id}-${Date.now()}`,
            kind: 'cancelled-order',
            title: 'Novo pedido cancelado',
            message: `Pedido ${order.id.slice(0, 8)}... (${order.customerName}) marcado como PedidoCancelado. O estoque não será avisado.`,
            createdAtMs: Date.now(),
            orderId: order.id,
          },
          10_000
        );
      }
    }

    // 2. Detect multiple worker processing errors within a short 60s window
    const hasNewErrors = errorLogs.some((l) => l.id > lastSeenErrorLogIdRef.current);
    if (hasNewErrors) {
      lastSeenErrorLogIdRef.current = Math.max(lastSeenErrorLogIdRef.current, maxErrorId);
      const cutoffMs = Date.now() - 60_000;
      const recentWorkerErrors = errorLogs.filter(
        (l) =>
          (l.source === 'Worker' || l.source === 'MessageQueue' || l.source === 'InventoryMock') &&
          new Date(l.timestampUtc).getTime() >= cutoffMs
      );

      if (
        recentWorkerErrors.length >= 2 &&
        Date.now() - lastErrorBurstAlertAtRef.current >= 15_000
      ) {
        lastErrorBurstAlertAtRef.current = Date.now();
        pushAlert(
          {
            id: `error-burst-${Date.now()}`,
            kind: 'worker-error-burst',
            title: 'Múltiplos erros no processamento do Worker',
            message: `${recentWorkerErrors.length} falhas registradas nos últimos 60 segundos ao enviar para fila ou estoque. Retentativas automáticas em +60s.`,
            createdAtMs: Date.now(),
          },
          12_000
        );
      }
    }
  }, [state, pushAlert]);

  const updateConfig = async (patch: {
    queueAvailable?: boolean;
    inventoryMode?: InventoryMode;
    workerRunning?: boolean;
    maxRetryAttempts?: number;
  }) => {
    setRetryLimitError(null);
    const res = await fetch('/api/simulator/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setRetryLimitError(err.detail ?? 'Falha ao salvar configuração.');
      return;
    }
    if (patch.maxRetryAttempts !== undefined) {
      setRetryLimitSavedMsg(`Salvo (${patch.maxRetryAttempts})`);
      setTimeout(() => setRetryLimitSavedMsg(null), 2200);
    }
    await fetchState();
  };

  const handleSaveCustomRetryLimit = async () => {
    const parsed = Number(customRetryLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      setRetryLimitError('Informe um número inteiro entre 1 e 50.');
      return;
    }
    await updateConfig({ maxRetryAttempts: parsed });
  };

  const handleCancelOrder = async (orderId: string) => {
    await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST' });
    await fetchState();
  };

  const handleAdvanceRetry = async (orderId: string) => {
    await fetch(`/api/simulator/advance-retry/${encodeURIComponent(orderId)}`, { method: 'POST' });
    await fetchState();
  };

  const handleRequeueOrder = async (orderId: string) => {
    await fetch(`/api/simulator/requeue/${encodeURIComponent(orderId)}`, { method: 'POST' });
    await fetchState();
  };

  const handleTestConcurrency = async (orderId: string) => {
    await fetch(`/api/simulator/test-concurrency/${encodeURIComponent(orderId)}`, { method: 'POST' });
    await fetchState();
  };

  const handleReset = async (seed: boolean) => {
    await fetch('/api/simulator/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed }),
    });
    initializedAlertsRef.current = false;
    seenCancelledIdsRef.current.clear();
    lastSeenErrorLogIdRef.current = 0;
    lastErrorBurstAlertAtRef.current = 0;
    setAlerts([]);
    setSelectedOrderId(null);
    await fetchState();
  };

  const orders = state?.orders ?? [];
  const filteredOrders = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
      if (!q) return true;
      return (
        o.id.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.customerEmail.toLowerCase().includes(q)
      );
    });
  }, [orders, statusFilter, searchTerm]);

  const filteredLogs = useMemo(() => {
    const logs = state?.logs ?? [];
    if (logLevelFilter === 'ALL') return logs;
    return logs.filter((l) => l.level === logLevelFilter);
  }, [state?.logs, logLevelFilter]);

  const handleExportLogs = () => {
    if (filteredLogs.length === 0) return;

    const payload = {
      exportedAtUtc: new Date().toISOString(),
      levelFilter: logLevelFilter,
      totalRecords: filteredLogs.length,
      logs: filteredLogs.map((log) => {
        let parsedDetails: unknown = null;
        if (log.detailsJson) {
          try {
            parsedDetails = JSON.parse(log.detailsJson);
          } catch {
            parsedDetails = log.detailsJson;
          }
        }
        return {
          id: log.id,
          timestampUtc: log.timestampUtc,
          level: log.level,
          source: log.source,
          eventCode: log.eventCode,
          orderId: log.orderId,
          message: log.message,
          details: parsedDetails,
        };
      }),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.href = url;
    link.download = `order-reservation-logs-${logLevelFilter.toLowerCase()}-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const selectedOrder: OrderDto | null = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  const metrics = useMemo(() => {
    const total = orders.length;
    const reserved = orders.filter((o) => o.status === 'EstoqueReservado').length;
    const waitingRetry = orders.filter(
      (o) => o.status === 'PedidoCriado' && o.outbox?.status === 'FailedWaitingRetry'
    ).length;
    const cancelled = orders.filter((o) => o.status === 'PedidoCancelado').length;
    return { total, reserved, waitingRetry, cancelled };
  }, [orders]);

  const breadcrumbLabel =
    activeTab === 'overview'
      ? 'Operação & Outbox'
      : activeTab === 'orders-api'
        ? 'API: Criar & Consultar'
        : 'Código-Fonte .NET 10';

  const navItems: Array<{ id: ActiveTab; label: string; icon: typeof Activity }> = [
    { id: 'overview', label: 'Painel Operacional', icon: Activity },
    { id: 'orders-api', label: 'API: Criar & Consultar', icon: FilePlus2 },
    { id: 'dotnet-code', label: 'Código .NET 10', icon: Code2 },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-16 flex items-center px-6 border-b border-slate-200">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            OrderReservation
          </span>
        </div>

        <nav className="flex-1 p-4 space-y-1" aria-label="Navegação principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white font-medium'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'overview' && alerts.length > 0 && (
                  <span
                    className={`px-1.5 py-0.5 text-[11px] font-mono tabular-nums rounded ${
                      active ? 'bg-red-500 text-white' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {alerts.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <div className="font-medium text-slate-700">Arquitetura SOLID .NET 10</div>
          <div>api · worker · EF Core 10 · SQLite</div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative z-10 w-64 bg-white h-full border-r border-slate-200 flex flex-col">
            <div className="h-16 flex items-center justify-between px-5 border-b border-slate-200">
              <span className="text-base font-bold text-slate-900">OrderReservation</span>
              <button
                type="button"
                aria-label="Fechar menu"
                onClick={() => setMobileNavOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="p-4 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg whitespace-nowrap ${
                      active
                        ? 'bg-slate-900 text-white font-medium'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary CTA on right */}
        <header className="sticky top-0 z-20 h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Abrir navegação"
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500 truncate">
              <span className="font-medium text-slate-900">OrderReservation</span>
              <span aria-hidden="true">/</span>
              <span className="truncate">{breadcrumbLabel}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('orders-api')}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            Novo Pedido
          </button>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
          {activeTab === 'overview' && (
            <>
              {/* Temporary Operational Alert Banners */}
              {alerts.length > 0 && (
                <OperationalAlerts
                  alerts={alerts}
                  onDismiss={dismissAlert}
                  onInspectOrder={(orderId) => setSelectedOrderId(orderId)}
                />
              )}

              {/* Summary Metrics Strip */}
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Total de Pedidos</div>
                  <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
                    {metrics.total}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Registrados no SQLite</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Estoque Reservado</div>
                  <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
                    {metrics.reserved}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Notificados com sucesso</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Aguardando Retry (60s)</div>
                  <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-amber-700">
                    {metrics.waitingRetry}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Retidos no Outbox</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Pedidos Cancelados</div>
                  <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-red-700">
                    {metrics.cancelled}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Sem envio ao estoque</div>
                </div>
              </section>

              {/* Environment & Chaos Controls */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-5">
                <div className="flex flex-wrap items-center gap-6">
                  {/* Message Queue Switch */}
                  <div>
                    <div className="text-xs font-medium text-slate-700 mb-1.5">
                      Fila de Mensagens (IMessageQueue)
                    </div>
                    <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                      <button
                        type="button"
                        onClick={() => updateConfig({ queueAvailable: true })}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                          state?.config.queueAvailable
                            ? 'bg-white text-emerald-700 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Disponível
                      </button>
                      <button
                        type="button"
                        onClick={() => updateConfig({ queueAvailable: false })}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                          state && !state.config.queueAvailable
                            ? 'bg-white text-red-700 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Fora do Ar
                      </button>
                    </div>
                  </div>

                  {/* Mock Inventory Mode */}
                  <div>
                    <div className="text-xs font-medium text-slate-700 mb-1.5">
                      Sistema de Estoque (Mock)
                    </div>
                    <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                      {(['healthy', 'intermittent', 'failing'] as InventoryMode[]).map((mode) => {
                        const label =
                          mode === 'healthy'
                            ? 'Saudável'
                            : mode === 'intermittent'
                              ? 'Intermitente (50%)'
                              : 'Fora do Ar';
                        const active = state?.config.inventoryMode === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => updateConfig({ inventoryMode: mode })}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                              active
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Worker Toggle */}
                  <div>
                    <div className="text-xs font-medium text-slate-700 mb-1.5">
                      Background Worker
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateConfig({ workerRunning: !(state?.config.workerRunning ?? true) })
                      }
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap ${
                        state?.config.workerRunning
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                      }`}
                    >
                      {state?.config.workerRunning ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          Em Execução (Pausar)
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          Pausado (Retomar)
                        </>
                      )}
                    </button>
                  </div>

                  {/* Max Worker Retry Limit */}
                  <div>
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-700 mb-1.5">
                      <span>Limite de Retentativas (Worker)</span>
                      {retryLimitSavedMsg && (
                        <span className="text-[11px] font-medium text-emerald-700">
                          · {retryLimitSavedMsg}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                        {([3, 5, 10] as const).map((preset) => {
                          const active = state?.config.maxRetryAttempts === preset;
                          return (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => updateConfig({ maxRetryAttempts: preset })}
                              className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
                                active
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {preset}x
                            </button>
                          );
                        })}
                      </div>

                      <div className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          max={50}
                          aria-label="Limite personalizado de retentativas"
                          value={customRetryLimit}
                          onChange={(e) => setCustomRetryLimit(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleSaveCustomRetryLimit();
                            }
                          }}
                          className="w-16 px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-600"
                        />
                        <button
                          type="button"
                          onClick={handleSaveCustomRetryLimit}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                        >
                          Aplicar
                        </button>
                      </div>
                    </div>
                    {retryLimitError && (
                      <div className="mt-1 text-[11px] text-red-700">{retryLimitError}</div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleReset(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restaurar Exemplos
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReset(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Limpar Base
                  </button>
                </div>
              </section>

              {/* 30-Minute Inventory Processing Line Chart */}
              <InventoryMetricsChart data={state?.inventoryMetrics30m ?? []} />

              {/* Orders & Outbox Table */}
              <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-slate-500" aria-hidden="true" />
                      <h2 className="text-sm font-semibold text-slate-900">
                        Pedidos & Transactional Outbox (SQLite)
                      </h2>
                    </div>
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                      {(
                        [
                          { id: 'ALL', label: 'Todos' },
                          { id: 'PedidoCriado', label: 'PedidoCriado' },
                          { id: 'EstoqueReservado', label: 'EstoqueReservado' },
                          { id: 'PedidoCancelado', label: 'PedidoCancelado' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setStatusFilter(tab.id)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                            statusFilter === tab.id
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Filtrar por ID ou cliente..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                {loading ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Carregando registros do SQLite...
                  </div>
                ) : filteredOrders.length === 0 ? (
                  <div className="p-10 text-center space-y-3">
                    <p className="text-sm text-slate-600">
                      Nenhum pedido encontrado para o filtro selecionado.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('orders-api')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                    >
                      <FilePlus2 className="w-3.5 h-3.5" />
                      Registrar Primeiro Pedido
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                        <tr>
                          <th className="text-left font-medium px-4 py-2.5">Identificador Único</th>
                          <th className="text-left font-medium px-4 py-2.5">Cliente</th>
                          <th className="text-right font-medium px-4 py-2.5">Total</th>
                          <th className="text-left font-medium px-4 py-2.5">Status / Stamp</th>
                          <th className="text-left font-medium px-4 py-2.5">Outbox / Retry (60s)</th>
                          <th className="text-right font-medium px-4 py-2.5">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredOrders.map((order) => {
                          const retrySecs =
                            order.outbox?.nextRetryAtUtc
                              ? Math.max(
                                  0,
                                  Math.ceil(
                                    (new Date(order.outbox.nextRetryAtUtc).getTime() - nowMs) / 1000
                                  )
                                )
                              : null;

                          return (
                            <tr key={order.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap tabular-nums">
                                {order.id.slice(0, 13)}...
                              </td>
                              <td className="px-4 py-3">
                                <div className="text-xs font-medium text-slate-900">
                                  {order.customerName}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {order.items.length} item(ns) · {order.customerEmail}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-xs font-medium tabular-nums text-slate-900 whitespace-nowrap">
                                R$ {order.totalAmount.toFixed(2)}
                              </td>
                              <td className="px-4 py-3">
                                <OrderStatusText status={order.status} />
                                <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                                  {new Date(order.pedidoCriadoAtUtc).toLocaleTimeString('pt-BR')}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {order.outbox ? (
                                  <div className="space-y-0.5">
                                    <OutboxStatusText
                                      status={order.outbox.status}
                                      secondsRemaining={retrySecs}
                                    />
                                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                                      Tentativas: {order.outbox.retryCount} /{' '}
                                      {state?.config.maxRetryAttempts ?? 5}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-500">
                                    Sem Outbox (Cancelado)
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  {order.outbox?.status === 'FailedWaitingRetry' && (
                                    <button
                                      type="button"
                                      onClick={() => handleAdvanceRetry(order.id)}
                                      className="px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 whitespace-nowrap"
                                    >
                                      Adiantar 60s
                                    </button>
                                  )}
                                  {order.outbox?.status === 'DeadLetter' && (
                                    <button
                                      type="button"
                                      onClick={() => handleRequeueOrder(order.id)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 whitespace-nowrap"
                                    >
                                      <RotateCw className="w-3 h-3" aria-hidden="true" />
                                      Reenfileirar
                                    </button>
                                  )}
                                  {order.status === 'PedidoCriado' && (
                                    <button
                                      type="button"
                                      onClick={() => handleCancelOrder(order.id)}
                                      className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 whitespace-nowrap"
                                    >
                                      Cancelar
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setSelectedOrderId(order.id)}
                                    className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 whitespace-nowrap"
                                  >
                                    Inspecionar
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Queue Uniqueness & Structured Logs */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Unique Queue View */}
                <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        Fila Única (IMessageQueue)
                      </h2>
                      <p className="text-[11px] text-slate-500">
                        Chave única por OrderId impede mensagens duplicadas
                      </p>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-slate-500">
                      {state?.queueRecords.length ?? 0} reg.
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                    {(state?.queueRecords ?? []).length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        Nenhuma mensagem publicada na fila até o momento.
                      </div>
                    ) : (
                      state?.queueRecords.map((q) => (
                        <div key={q.messageId} className="px-5 py-3 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-medium text-slate-800">
                              Order {q.orderId.slice(0, 8)}...
                            </span>
                            <span
                              className={`font-medium ${
                                q.deliveryStatus === 'Acknowledged'
                                  ? 'text-emerald-700'
                                  : 'text-amber-700'
                              }`}
                            >
                              {q.deliveryStatus === 'Acknowledged' ? 'ACK Confirmado' : 'Na Fila'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                            MsgId {q.messageId.slice(0, 8)} · {q.eventType} ·{' '}
                            {new Date(q.enqueuedAtUtc).toLocaleTimeString('pt-BR')}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                {/* Structured Logs Console */}
                <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        Logs Estruturados (API & Worker)
                      </h2>
                      <p className="text-[11px] text-slate-500">
                        Formato consistente com EventCode, timestamps UTC e propriedades JSON
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
                        {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => setLogLevelFilter(lvl)}
                            className={`px-2 py-1 text-[11px] font-medium rounded-md whitespace-nowrap ${
                              logLevelFilter === lvl
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {lvl === 'ALL' ? 'Todos' : lvl}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={filteredLogs.length === 0}
                        onClick={handleExportLogs}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" aria-hidden="true" />
                        Exportar Logs
                      </button>
                    </div>
                  </div>
                  <div className="bg-slate-950 text-slate-200 p-4 font-mono text-[11px] space-y-2.5 max-h-80 overflow-y-auto tabular-nums">
                    {filteredLogs.length === 0 ? (
                      <div className="text-slate-500 text-center py-6">
                        Sem entradas de log para este filtro.
                      </div>
                    ) : (
                      filteredLogs.map((log) => {
                        const levelColor =
                          log.level === 'ERROR'
                            ? 'text-red-400'
                            : log.level === 'WARN'
                              ? 'text-amber-300'
                              : 'text-emerald-400';
                        return (
                          <div key={log.id} className="leading-relaxed border-b border-slate-900 pb-2 last:border-0">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-slate-500">
                                {new Date(log.timestampUtc).toISOString().slice(11, 23)}Z
                              </span>
                              <span className={`font-semibold ${levelColor}`}>[{log.level}]</span>
                              <span className="text-sky-300">[{log.source}]</span>
                              <span className="text-slate-300 font-semibold">[{log.eventCode}]</span>
                              <span className="text-slate-100">{log.message}</span>
                            </div>
                            {log.detailsJson && (
                              <div className="mt-0.5 text-slate-400 pl-2">
                                {log.detailsJson}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              </div>

              {/* Webhook Settings & Delivery History */}
              <WebhookSettingsPanel
                config={state?.webhookConfig}
                deliveries={state?.webhookDeliveries ?? []}
                onRefresh={fetchState}
              />
            </>
          )}

          {activeTab === 'orders-api' && (
            <CreateAndQueryView
              recentOrders={orders}
              onOrderCreated={fetchState}
              onCancelOrder={handleCancelOrder}
            />
          )}

          {activeTab === 'dotnet-code' && <DotnetCodeExplorer />}
        </main>
      </div>

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          nowMs={nowMs}
          maxRetryAttempts={state?.config.maxRetryAttempts ?? 5}
          onClose={() => setSelectedOrderId(null)}
          onCancel={handleCancelOrder}
          onAdvanceRetry={handleAdvanceRetry}
          onRequeue={handleRequeueOrder}
          onTestConcurrency={handleTestConcurrency}
        />
      )}
    </div>
  );
}
