import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, fmtDate } from '../api/client';
import { Field, Spinner, useData } from '../components/ui';

export default function AuditPage() {
  const [f, setF] = useState({ user: '', action: '', application: '', result: '', from: '', to: '' });
  const [q, setQ] = useState(f);
  const { data } = useData<any[]>(() => api('/audit', { query: { ...q, limit: 1000 } }), [q]);

  const exportCsv = () => {
    const rows = [['fecha', 'usuario', 'ip', 'accion', 'aplicacion', 'resultado', 'detalle'], ...(data ?? []).map((a) => [a.created_at, a.username, a.ip, a.action, a.application_name ?? '', a.result, JSON.stringify(a.details ?? {})])];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="page-head"><div><span className="eyebrow">Seguridad</span><h1>Auditoría</h1><p>Registro de todas las acciones: usuario, fecha, IP, aplicación, acción y resultado.</p></div>
        <button className="btn outline" onClick={exportCsv}><Download size={15} />Exportar CSV</button></div>
      <div className="card row" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
        <Field label="Usuario"><input className="input" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} /></Field>
        <Field label="Acción"><input className="input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="deploy, login…" /></Field>
        <Field label="Aplicación"><input className="input" value={f.application} onChange={(e) => setF({ ...f, application: e.target.value })} /></Field>
        <Field label="Resultado"><select className="input" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="">Todos</option><option value="success">Éxito</option><option value="failure">Fallo</option></select></Field>
        <Field label="Desde"><input className="input" type="datetime-local" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="Hasta"><input className="input" type="datetime-local" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <button className="btn primary" onClick={() => setQ(f)}>Filtrar</button>
      </div>
      {!data ? <Spinner /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Fecha</th><th>Usuario</th><th>IP</th><th>Acción</th><th>Aplicación</th><th>Detalle</th><th>Resultado</th></tr></thead>
          <tbody>{data.map((a) => (
            <tr key={a.id}>
              <td className="small nowrap">{fmtDate(a.created_at)}</td><td><b>{a.username}</b></td><td className="mono small">{a.ip ?? '—'}</td>
              <td><span className="badge">{a.action}</span></td><td>{a.application_name ?? '—'}</td>
              <td className="mono small" style={{ maxWidth: 420 }}><div className="ellipsis" title={JSON.stringify(a.details)}>{a.details ? Object.entries(a.details).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : ''}</div></td>
              <td>{a.result === 'success' ? <span className="badge ok">Éxito</span> : <span className="badge err">Fallo</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
