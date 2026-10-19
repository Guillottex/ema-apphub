import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pause, Play, Search, Trash2, History } from 'lucide-react';
import { api, wsUrl } from '../api/client';

const MAX_LINES = 5000;

function splitTs(line: string): [string, string] {
  const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.?\d*Z?\s(.*)$/);
  if (!m) return ['', line];
  const d = new Date(m[1] + 'Z');
  return [d.toLocaleString('es-AR', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }), m[2]];
}

/** Visor de logs en tiempo real (WebSocket) con pausa, búsqueda, filtro por fecha y descarga. */
export default function LogViewer({ appId, environment, service }: { appId: string; environment: string; service: 'app' | 'db' }) {
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState('');
  const [state, setState] = useState<'connecting' | 'live' | 'closed' | 'history'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const pausedRef = useRef(false);
  const buffer = useRef<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  pausedRef.current = paused;

  useEffect(() => {
    if (state === 'history') return;
    setLines([]); setError(null); setState('connecting');
    const ws = new WebSocket(wsUrl('/ws/logs', { app: appId, environment, service, tail: '500' }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'ready') setState('live');
      if (msg.type === 'error') setError(msg.message);
      if (msg.type === 'lines') {
        if (pausedRef.current) { buffer.current.push(...msg.lines); return; }
        setLines((l) => [...l, ...msg.lines].slice(-MAX_LINES));
      }
    };
    ws.onclose = () => setState((s) => (s === 'history' ? s : 'closed'));
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, environment, service, state === 'history']);

  useEffect(() => {
    if (!paused && buffer.current.length) { setLines((l) => [...l, ...buffer.current].slice(-MAX_LINES)); buffer.current = []; }
  }, [paused]);

  useEffect(() => {
    if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, paused]);

  const loadHistory = async () => {
    setState('history');
    try {
      const r = await api('/applications/' + appId + '/logs', { query: { environment, service, since: since || undefined, until: until || undefined, tail: 20000 } });
      setLines(r.lines); setError(null);
    } catch (e: any) { setError(e.message); }
  };

  const shown = useMemo(() => {
    const s = search.toLowerCase();
    return s ? lines.filter((l) => l.toLowerCase().includes(s)) : lines;
  }, [lines, search]);

  const hl = (text: string) => {
    if (!search) return text;
    const i = text.toLowerCase().indexOf(search.toLowerCase());
    if (i < 0) return text;
    return <>{text.slice(0, i)}<mark>{text.slice(i, i + search.length)}</mark>{text.slice(i + search.length)}</>;
  };

  const download = () => { location.href = `/api/applications/${appId}/logs?environment=${environment}&service=${service}&tail=50000&download=1`; };

  return (
    <div className="stack">
      <div className="row">
        <span className={`badge ${state === 'live' ? 'ok' : state === 'history' ? 'sky' : ''}`}>
          <span className={`dot ${state === 'live' ? 'ok pulse' : ''}`} />{state === 'live' ? 'En vivo' : state === 'history' ? 'Histórico' : state === 'connecting' ? 'Conectando…' : 'Desconectado'}
        </span>
        <div className="row" style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, color: '#8a8fa8' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Buscar en logs…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn outline sm" onClick={() => setPaused(!paused)}>{paused ? <><Play size={14} />Reanudar</> : <><Pause size={14} />Pausar</>}</button>
        <button className="btn outline sm" onClick={() => setLines([])}><Trash2 size={14} />Limpiar</button>
        <button className="btn outline sm" onClick={download}><Download size={14} />Descargar</button>
      </div>
      <div className="row small">
        <History size={15} className="muted" /><span className="muted">Filtrar por fecha:</span>
        <input type="datetime-local" className="input" style={{ width: 210 }} value={since} onChange={(e) => setSince(e.target.value)} />
        <span className="muted">a</span>
        <input type="datetime-local" className="input" style={{ width: 210 }} value={until} onChange={(e) => setUntil(e.target.value)} />
        <button className="btn sm" onClick={loadHistory}>Aplicar</button>
        {state === 'history' && <button className="btn sm sky" onClick={() => setState('connecting')}>Volver a en vivo</button>}
      </div>
      {error && <div className="alert warn">{error}</div>}
      <div className="console" ref={box} style={{ height: 460 }}>
        {shown.length === 0 && <span className="muted">Sin líneas para mostrar.</span>}
        {shown.map((l, i) => {
          const [ts, text] = splitTs(l);
          const cls = /\b(error|exception|fatal|fail(ed)?)\b/i.test(text) ? 'e' : /\bwarn(ing)?\b/i.test(text) ? 'w' : '';
          return <span key={i} className={`ln ${cls}`}>{ts && <span className="ts">[{ts}]</span>}{hl(text)}</span>;
        })}
      </div>
      <div className="muted small">{shown.length} líneas {search && `(filtradas de ${lines.length})`} {paused && `· ${buffer.current.length} en espera`}</div>
    </div>
  );
}
