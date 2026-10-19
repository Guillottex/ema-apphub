import { Activity, HeartPulse, RefreshCw } from 'lucide-react';
import { api, ENV_LABEL, fmtBytes, fmtDate } from '../../api/client';
import { Meter, StatusBadge, useAction, useData } from '../../components/ui';

export interface TabProps { app: any; env: any; reload: () => void }

export default function OverviewTab({ app, env }: TabProps) {
  const { data: st, reload } = useData(() => api(`/applications/${app.id}/status`, { query: { environment: env.name } }), [app.id, env.name], 10000);
  const { run, busy } = useAction();
  const c = st?.app?.container;
  const s = st?.app?.stats;
  const health = st?.health ?? [];
  const last = health[0];

  const info: [string, React.ReactNode][] = [
    ['Nombre', app.name], ['Descripción', app.description || '—'], ['Identificador', <code key="s">{app.slug}</code>],
    ['Tecnología', app.framework_label || app.technology_label], ['Versión actual', app.current_version ? `v${app.current_version.version}` : '—'],
    ['Versión en este ambiente', env.deployed_version ? `v${env.deployed_version}` : 'Sin desplegar'], ['Estado', <StatusBadge key="st" status={env.status} />],
    ['Creada', fmtDate(app.created_at)], ['Última actualización', fmtDate(app.updated_at)], ['Autor', app.author?.full_name ?? '—'],
    ['URL', env.url ? <a key="u" href={env.url} target="_blank" rel="noopener">{env.url}</a> : '—'],
    ['Puerto', env.external_port ? `${env.external_port} → ${env.internal_port || app.internal_port}` : `interno ${env.internal_port || app.internal_port}`],
    ['Dominio', env.domain || '—'], ['Estado Docker', c ? `${c.state}${c.health ? ` (${c.health})` : ''}` : 'Sin contenedor'],
    ['Base de datos', env.database_engine ? `PostgreSQL (${env.database_status})` : '—'],
    ['Repositorio Git', app.repository ? <span key="r" className="mono small">{app.repository.url}</span> : '—'],
    ['Ubicación de archivos', <span key="p" className="mono small">{app.storage_path}</span>], ['Health check', <code key="h">{app.healthcheck_path || '/'}</code>],
  ];

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
      <div className="card">
        <div className="card-title"><h3>Información — {ENV_LABEL[env.name]}</h3></div>
        <table className="table"><tbody>{info.map(([k, v]) => <tr key={k}><td className="muted" style={{ width: 200 }}>{k}</td><td>{v}</td></tr>)}</tbody></table>
      </div>
      <div className="stack" style={{ gap: 16 }}>
        <div className="card stack">
          <div className="card-title"><h3 className="row"><Activity size={16} />Contenedor</h3><button className="btn ghost icon" onClick={reload}><RefreshCw size={15} /></button></div>
          {!c ? <span className="muted">El ambiente todavía no tiene contenedor.</span> : (
            <>
              <div className="row small"><StatusBadge status={c.running ? 'running' : c.state} /><code>{c.name}</code><span className="muted">{c.image}</span></div>
              <Meter label="CPU" value={s?.cpuPercent ?? 0} />
              <Meter label="RAM" value={s?.memoryLimitBytes ? (s.memoryBytes / s.memoryLimitBytes) * 100 : 0} detail={s ? `${fmtBytes(s.memoryBytes)} / ${fmtBytes(s.memoryLimitBytes)}` : '—'} />
              <div className="row small muted"><span>Iniciado: {fmtDate(c.startedAt)}</span><span>Reinicios: {c.restartCount}</span>{s && <span>Red ↓{fmtBytes(s.netRxBytes)} ↑{fmtBytes(s.netTxBytes)}</span>}</div>
              {st?.db?.container && <div className="row small"><span className="muted">PostgreSQL:</span><StatusBadge status={st.db.container.health === 'healthy' ? 'running' : st.db.container.state} />{st.db.stats && <span className="muted">{fmtBytes(st.db.stats.memoryBytes)} RAM</span>}</div>}
            </>
          )}
        </div>
        <div className="card stack">
          <div className="card-title">
            <h3 className="row"><HeartPulse size={16} />Health check</h3>
            <button className="btn sm outline" disabled={busy || !env.deployed_version_id} onClick={() => run(async () => { await api(`/applications/${app.id}/healthcheck`, { body: { environment: env.name } }); await reload(); })}>Verificar ahora</button>
          </div>
          {last ? (
            <div className="row">
              <span className={`badge ${last.status === 'healthy' ? 'ok' : 'err'}`}><span className={`dot ${last.status === 'healthy' ? 'ok' : 'err'}`} />{last.status === 'healthy' ? 'Aplicación funcionando' : 'Aplicación con problemas'}</span>
              <span className="muted small">{last.http_status ? `HTTP ${last.http_status}` : last.error} · {last.response_ms} ms · {fmtDate(last.checked_at)}</span>
            </div>
          ) : <span className="muted">Sin chequeos todavía.</span>}
          <div className="row" style={{ gap: 3 }}>
            {[...health].reverse().map((h: any, i: number) => <span key={i} title={`${fmtDate(h.checked_at)} · ${h.http_status ?? h.error}`} style={{ width: 8, height: 22, borderRadius: 3, background: h.status === 'healthy' ? 'var(--ok)' : 'var(--err)', opacity: .85 }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
