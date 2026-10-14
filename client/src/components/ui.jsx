import { useState } from 'react';
import clsx from 'clsx';

const STATUS_STYLES = {
  published: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  preview_only: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  processing: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  scheduled: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  planned: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  disabled: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  super_admin: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  user: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

const STATUS_LABELS = { preview_only: 'preview', super_admin: 'super admin' };

export function Badge({ status, children, className }) {
  return (
    <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', STATUS_STYLES[status] || 'bg-slate-100 text-slate-600 ring-slate-500/20', className)}>
      {children ?? STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** Button that shows a spinner and blocks repeat clicks while its async handler runs. */
export function AsyncButton({ onClick, busyLabel, children, className = 'btn-primary', type = 'button', disabled = false, ...rest }) {
  const [busy, setBusy] = useState(false);
  const handle = async (event) => {
    if (busy) return;
    setBusy(true);
    try {
      await onClick?.(event);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type={type} className={clsx('btn', className)} disabled={busy || disabled} onClick={handle} {...rest}>
      {busy && <span className="spinner" />}
      {busy ? busyLabel || children : children}
    </button>
  );
}

export function PageHeader({ title, description, actions, icon: Icon }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-pilot/15 to-violet/15 text-violet">
            <Icon size={22} />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function StatCard({ label, value, icon: Icon, tone = 'sky' }) {
  const tones = {
    sky: 'bg-sky-50 text-sky-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="card flex items-center gap-4 p-4">
      {Icon && <div className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-xl', tones[tone])}><Icon size={20} /></div>}
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="mt-0.5 font-display text-2xl font-bold text-slate-900">{value ?? '–'}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      {Icon && <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><Icon size={22} /></div>}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 text-left">
      <span className={clsx('relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-gradient-to-r from-pilot to-violet' : 'bg-slate-300')}>
        <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </button>
  );
}

export function formatDate(value, timezone = 'Asia/Dhaka') {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

/** Wall-clock parts of an instant in a timezone: { date: 'YYYY-MM-DD', time: 'HH:mm' }. */
export function zonedInputParts(value, timezone = 'Asia/Dhaka') {
  const date = value ? new Date(value) : new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
