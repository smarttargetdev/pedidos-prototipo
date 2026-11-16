import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { InventoryMetricPointDto } from '../types';

interface InventoryMetricsChartProps {
  data: InventoryMetricPointDto[];
}

type ChartMode = 'rate' | 'count';

export function InventoryMetricsChart({ data }: InventoryMetricsChartProps) {
  const [mode, setMode] = useState<ChartMode>('rate');

  const totals = useMemo(() => {
    const success = data.reduce((sum, p) => sum + p.successCount, 0);
    const failure = data.reduce((sum, p) => sum + p.failureCount, 0);
    const total = success + failure;
    const rate = total > 0 ? Math.round((success / total) * 1000) / 10 : 0;
    return { success, failure, total, rate };
  }, [data]);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Processamento de Estoque · Últimos 30 Minutos
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 tabular-nums">
            <span>
              Taxa de Sucesso:{' '}
              <strong className="font-mono text-emerald-700">{totals.rate.toFixed(1)}%</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Sucessos: <strong className="font-mono text-slate-800">{totals.success}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Falhas: <strong className="font-mono text-red-700">{totals.failure}</strong>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-emerald-600 inline-block" aria-hidden="true" />
              Sucesso
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-red-600 inline-block" aria-hidden="true" />
              Falhas
            </span>
          </div>

          <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setMode('rate')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'rate'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Taxa (%)
            </button>
            <button
              type="button"
              onClick={() => setMode('count')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'count'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Eventos
            </button>
          </div>
        </div>
      </div>

      <div className="h-64 w-full min-w-0">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
            Aguardando métricas de processamento de estoque...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis
                dataKey="minuteLabel"
                tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                axisLine={{ stroke: '#E2E8F0' }}
                minTickGap={24}
              />
              <YAxis
                domain={mode === 'rate' ? [0, 100] : [0, 'auto']}
                allowDecimals={false}
                unit={mode === 'rate' ? '%' : ''}
                tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const point = payload[0]?.payload as InventoryMetricPointDto | undefined;
                  if (!point) return null;
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm text-xs space-y-1 tabular-nums">
                      <div className="font-mono font-semibold text-slate-900">{label}</div>
                      <div className="flex items-center justify-between gap-4 text-emerald-700">
                        <span>Sucesso</span>
                        <span className="font-mono font-medium">
                          {point.successRate.toFixed(1)}% ({point.successCount})
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4 text-red-700">
                        <span>Falhas</span>
                        <span className="font-mono font-medium">
                          {point.failureRate.toFixed(1)}% ({point.failureCount})
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey={mode === 'rate' ? 'successRate' : 'successCount'}
                name="Sucesso"
                stroke="#16A34A"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#16A34A' }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey={mode === 'rate' ? 'failureRate' : 'failureCount'}
                name="Falhas"
                stroke="#DC2626"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#DC2626' }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
