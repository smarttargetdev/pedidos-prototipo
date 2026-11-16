import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Ban, Eye, X } from 'lucide-react';

export interface OperationalAlert {
  id: string;
  kind: 'aborted-order' | 'worker-error-burst';
  title: string;
  message: string;
  createdAtMs: number;
  orderId?: string;
}

interface OperationalAlertsProps {
  alerts: OperationalAlert[];
  onDismiss: (id: string) => void;
  onInspectOrder: (orderId: string) => void;
}

export function OperationalAlerts({
  alerts,
  onDismiss,
  onInspectOrder,
}: OperationalAlertsProps) {
  return (
    <div aria-live="polite" className="space-y-2.5">
      <AnimatePresence initial={false}>
        {alerts.map((alert) => {
          const isErrorBurst = alert.kind === 'worker-error-burst';
          const containerClass = isErrorBurst
            ? 'bg-red-50 border border-red-200 text-red-900'
            : 'bg-amber-50 border border-amber-200 text-amber-900';
          const subTextClass = isErrorBurst ? 'text-red-800' : 'text-amber-800';
          const iconClass = isErrorBurst ? 'text-red-700' : 'text-amber-700';

          return (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              role="status"
              className={`rounded-xl px-4 py-3 flex items-start justify-between gap-4 ${containerClass}`}
            >
              <div className="flex items-start gap-3 min-w-0">
                {isErrorBurst ? (
                  <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${iconClass}`} aria-hidden="true" />
                ) : (
                  <Ban className={`w-4 h-4 mt-0.5 shrink-0 ${iconClass}`} aria-hidden="true" />
                )}
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span>{alert.title}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono font-normal tabular-nums opacity-80">
                      {new Date(alert.createdAtMs).toLocaleTimeString('pt-BR')}
                    </span>
                  </div>
                  <p className={`text-xs leading-relaxed ${subTextClass}`}>
                    {alert.message}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {alert.orderId && (
                  <button
                    type="button"
                    onClick={() => onInspectOrder(alert.orderId!)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white border border-slate-200 text-slate-800 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    Inspecionar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDismiss(alert.id)}
                  aria-label="Dispensar alerta"
                  className="p-1 rounded-md hover:bg-black/5 transition-colors"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
