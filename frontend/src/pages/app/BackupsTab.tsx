import { useState } from 'react';
import { Archive, CalendarClock, Download, RotateCcw, Trash2 } from 'lucide-react';
import { api, ENV_LABEL, fmtBytes, fmtDate } from '../../api/client';
import { useAuth } from '../../auth';
import { Confirm, Empty, Field, Spinner, StatusBadge, useAction, useData } from '../../components/ui';
import { TabProps } from './OverviewTab';

const PRESETS = [['0 3 * * *', 'Diario 03:00'], ['0 */6 * * *', 'Cada 6 horas'], ['0 2 * * 0', 'Semanal (domingo 02:00)'], ['0 1 1 * *', 'Mensual (día 1, 01:00)']];

export default function BackupsTab({ app, env, reload }: TabProps) {
  const { data, reload: reloadList } = useData<any[]>(() => api('/backups', { query: { applicationId: app.id } }), [app.id]);
  const { data: schedules, reload: reloadSch } = useData<any[]>(() => api(`/applications/${app.id}/backup-schedules`), [app.id]);
  const { can } = useAuth();
  const { run, busy } = useAction();
  const [restore, setRestore] = useState<any>(null);
  const [sch, setSch] = useState({ type: 'database', cron: '0 3 * * *', retention: 7 });
  const manage = can('backups.manage');

  const backup = (type: string) => run(async () => { await api(`/applications/${app.id}/backup`, { body: { environment: env.name, type } }); reloadList(); }, 'Backup completado');

  return (
    <div className="stack" style={{ gap: 16 }}>
      {manage && (
        <div className="card row">
          <div><h3>Backup manual — {ENV_LABEL[env.name]}</h3><p className="muted small" style={{ margin: '4px 0 0' }}>Aplicación: código, Dockerfile, compose y variables (cifradas). Base: <code>pg_dump -Fc</code>.</p></div>
          <div className="row right">
            <button className="btn outline" disabled={busy} onClick={() => backup('app')}><Archive size={14} />Aplicación</button>
            <button className="btn outline" disabled={busy || !env.database_id} onClick={() => backup('database')}><Archive size={14} />Base de datos</button>
            <button className="btn primary" disabled={busy} onClick={() => backup('both')}>{busy ? <span className="spinner" /> : <Archive size={14} />}Completo</button>
          </div>
        </div>
      )}
      <div className="card stack">
        <h3>Historial</h3>
        {!data ? <Spinner /> : !data.length ? <Empty title="Sin backups" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Ambiente</th><th>Archivo</th><th>Tamaño</th><th>Estado</th><th>Origen</th><th /></tr></thead>
            <tbody>{data.map((b) => (
              <tr key={b.id}>
                <td className="small nowrap">{fmtDate(b.created_at)}</td>
                <td><span className="badge">{b.type === 'app' ? 'Aplicación' : 'PostgreSQL'}</span></td>
                <td>{b.environment ? ENV_LABEL[b.environment] : '—'}</td>
                <td className="mono small">{b.file_name ?? '—'}</td>
                <td className="small">{fmtBytes(b.size_bytes)}</td>
                <td><StatusBadge status={b.status === 'running' ? 'queued' : b.status} />{b.error && <div className="small" style={{ color: 'var(--err)' }}>{b.error.slice(0, 120)}</div>}</td>
                <td className="small">{b.scheduled ? 'Programado' : b.user_name ?? '—'}</td>
                <td className="nowrap">{manage && b.status === 'success' && <>
                  <a className="btn ghost icon" title="Descargar" href={`/api/backups/${b.id}/download`}><Download size={15} /></a>
                  <button className="btn sm outline" onClick={() => setRestore(b)}><RotateCcw size={13} />Restaurar</button>
                  <button className="btn ghost icon" title="Eliminar" onClick={() => run(async () => { await api(`/backups/${b.id}`, { method: 'DELETE' }); reloadList(); }, 'Backup eliminado')}><Trash2 size={15} /></button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      <div className="card stack">
        <h3 className="row"><CalendarClock size={16} />Backups programados</h3>
        <table className="table"><thead><tr><th>Ambiente</th><th>Tipo</th><th>Programación (cron)</th><th>Retención</th><th>Última ejecución</th><th /></tr></thead>
          <tbody>
            {(schedules ?? []).length === 0 && <tr><td colSpan={6} className="muted">Sin programaciones.</td></tr>}
            {(schedules ?? []).map((s) => (
              <tr key={s.id}><td>{ENV_LABEL[s.environment]}</td><td>{s.type === 'app' ? 'Aplicación' : 'PostgreSQL'}</td><td className="mono">{s.cron} <span className="muted small">{PRESETS.find((p) => p[0] === s.cron)?.[1]}</span></td>
                <td>{s.retention} copias</td><td className="small">{fmtDate(s.last_run_at)}</td>
                <td>{manage && <button className="btn ghost icon" onClick={() => run(async () => { await api(`/applications/${app.id}/backup-schedules/${s.id}`, { method: 'DELETE' }); reloadSch(); }, 'Programación eliminada')}><Trash2 size={15} /></button>}</td></tr>
            ))}
          </tbody></table>
        {manage && (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Tipo"><select className="input" value={sch.type} onChange={(e) => setSch({ ...sch, type: e.target.value })}><option value="database">PostgreSQL</option><option value="app">Aplicación</option></select></Field>
            <Field label="Frecuencia"><select className="input" value={PRESETS.some((p) => p[0] === sch.cron) ? sch.cron : 'custom'} onChange={(e) => e.target.value !== 'custom' && setSch({ ...sch, cron: e.target.value })}>
              {PRESETS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}<option value="custom">Personalizada…</option></select></Field>
            <Field label="Cron"><input className="input mono" style={{ width: 140 }} value={sch.cron} onChange={(e) => setSch({ ...sch, cron: e.target.value })} /></Field>
            <Field label="Retención"><input className="input" type="number" style={{ width: 90 }} value={sch.retention} onChange={(e) => setSch({ ...sch, retention: Number(e.target.value) })} /></Field>
            <button className="btn primary" onClick={() => run(async () => { await api(`/applications/${app.id}/backup-schedules`, { body: { ...sch, environment: env.name } }); reloadSch(); }, 'Backup programado')}>Programar en {ENV_LABEL[env.name]}</button>
          </div>
        )}
      </div>
      {restore && <Confirm title="Restaurar backup" danger={restore.type === 'database'} confirmLabel="Restaurar"
        text={restore.type === 'database'
          ? <>Se reemplazará el contenido de la base de <b>{ENV_LABEL[restore.environment]}</b> con <code>{restore.file_name}</code>. Los datos actuales se perderán.</>
          : <>Se creará una nueva versión con el código y la configuración de <code>{restore.file_name}</code> y se desplegará en <b>{ENV_LABEL[restore.environment]}</b>.</>}
        requireText={restore.type === 'database' ? app.slug : undefined}
        onConfirm={() => run(async () => { await api(`/applications/${app.id}/restore`, { body: { backupId: restore.id } }); reload(); reloadList(); }, 'Restauración iniciada')} onClose={() => setRestore(null)} />}
    </div>
  );
}
