import { CheckCircle2, Clock, Ban, AlertTriangle, AlertOctagon, Loader2 } from 'lucide-react';
import type { OrderStatus, OutboxStatus } from '../types';

export function OrderStatusText({ status }: { status: OrderStatus }) {
  if (status === 'EstoqueReservado') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        EstoqueReservado
      </span>
    );
  }

  if (status === 'PedidoCancelado') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <Ban className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        PedidoCancelado
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      PedidoCriado
    </span>
  );
}

export function OutboxStatusText({
  status,
  secondsRemaining,
}: {
  status: OutboxStatus;
  secondsRemaining?: number | null;
}) {
  if (status === 'Dispatched') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Enviado ao Estoque
      </span>
    );
  }

  if (status === 'Cancelled') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <Ban className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Outbox Cancelada
      </span>
    );
  }

  if (status === 'DeadLetter') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <AlertOctagon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Limite Atingido (DeadLetter)
      </span>
    );
  }

  if (status === 'FailedWaitingRetry') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 tabular-nums whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        {typeof secondsRemaining === 'number' && secondsRemaining > 0
          ? `Retry em ${secondsRemaining}s`
          : 'Pronto p/ retentativa'}
      </span>
    );
  }

  if (status === 'Processing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 whitespace-nowrap">
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
        Processando (Lock)
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      Aguardando Worker
    </span>
  );
}
