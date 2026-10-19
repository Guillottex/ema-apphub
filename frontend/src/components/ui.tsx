import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { X, Inbox } from 'lucide-react';

// ───────── Toasts ─────────
type Toast = { id: number; text: string; kind: 'ok' | 'err' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{list.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Ejecuta una acción async mostrando toast de éxito/error. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r;
    } catch (e: any) {
      toast(e?.message || 'Error inesperado', 'err');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { run, busy };
}

// ───────── datos ─────────
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = [], intervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try { setData(await loader()); setError(null); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    setLoading(true);
    void reload();
    if (!intervalMs) return;
    const t = setInterval(() => void reload(), intervalMs);
    return () => clearInterval(t);
  }, [reload, intervalMs]);
  return { data, error, loading, reload, setData };
}

// ───────── primitivas ─────────
export function Modal({ title, onClose, children, footer, size }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'lg' }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true">
        <header><h3>{title}</h3><button className="btn ghost icon" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Confirm({ title, text, confirmLabel = 'Confirmar', danger, requireText, onConfirm, onClose }: {
  title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; requireText?: string; onConfirm: () => Promise<unknown> | void; onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn outline" onClick={onClose}>Cancelar</button>
      <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy || (!!requireText && typed !== requireText)}
        onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>
        {busy && <span className="spinner" />}{confirmLabel}
      </button></>}>
      <div className="stack">
        <div>{text}</div>
        {requireText && <label className="field">Escriba <code>{requireText}</code> para confirmar<input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>}
      </div>
    </Modal>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return <label className="field">{label}{children}{hint && <span className="hint">{hint}</span>}</label>;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />{label}
    </label>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; icon?: ReactNode; hidden?: boolean }[] }) {
  return (
    <div className="tabs">
      {items.filter((i) => !i.hidden).map((i) => (
        <button key={i.id} className={value === i.id ? 'active' : ''} onClick={() => onChange(i.id)}>{i.icon}{i.label}</button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return <div className="empty">{icon ?? <Inbox size={36} />}<h3>{title}</h3>{children && <div style={{ marginTop: 8 }}>{children}</div>}</div>;
}

export const Spinner = ({ label }: { label?: string }) => <div className="row muted" style={{ padding: 20 }}><span className="spinner" />{label ?? 'Cargando…'}</div>;

const STATUS: Record<string, { label: string; cls: string }> = {
  running: { label: 'Ejecutando', cls: 'ok' }, healthy: { label: 'Saludable', cls: 'ok' }, success: { label: 'Exitoso', cls: 'ok' },
  stopped: { label: 'Detenida', cls: '' }, not_deployed: { label: 'Sin desplegar', cls: '' }, exited: { label: 'Detenido', cls: '' },
  error: { label: 'Error', cls: 'err' }, unhealthy: { label: 'Con problemas', cls: 'err' }, failed: { label: 'Fallido', cls: 'err' },
  deploying: { label: 'Desplegando', cls: 'warn' }, queued: { label: 'En cola', cls: 'warn' }, creating: { label: 'Creando', cls: 'warn' },
  rolled_back: { label: 'Rollback', cls: 'warn' }, restarting: { label: 'Reiniciando', cls: 'warn' }, unknown: { label: 'Desconocido', cls: '' },
};
export function StatusBadge({ status, pulse }: { status?: string | null; pulse?: boolean }) {
  const s = STATUS[status ?? 'unknown'] ?? { label: status ?? '—', cls: '' };
  return <span className={`badge ${s.cls}`}><span className={`dot ${s.cls} ${pulse || ['deploying', 'running', 'queued'].includes(status ?? '') && s.cls === 'warn' ? 'pulse' : ''}`} />{s.label}</span>;
}

export function Meter({ value, label, detail }: { value: number; label: string; detail?: string }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row between small"><span className="muted">{label}</span><b>{detail ?? `${value.toFixed(1)}%`}</b></div>
      <div className={`meter ${value > 85 ? 'hot' : ''}`}><i style={{ width: `${Math.min(100, Math.max(1, value))}%` }} /></div>
    </div>
  );
}

export function Guard({ perm, children }: { perm: boolean; children: ReactNode }) {
  return perm ? <>{children}</> : null;
}
