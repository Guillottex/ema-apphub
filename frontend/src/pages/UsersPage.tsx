import { useState } from 'react';
import { Pencil, Plus, ShieldCheck } from 'lucide-react';
import { api, fmtDate } from '../api/client';
import { Field, Modal, Spinner, Switch, useAction, useData } from '../components/ui';

export default function UsersPage() {
  const { data, reload } = useData<any[]>(() => api('/users'), []);
  const { data: roles } = useData<any[]>(() => api('/roles'), []);
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <div className="page-head"><div><span className="eyebrow">Seguridad</span><h1>Usuarios y permisos</h1><p>Control de acceso basado en roles (RBAC).</p></div>
        <button className="btn primary" onClick={() => setEdit({})}><Plus size={15} />Nuevo usuario</button></div>
      {!data ? <Spinner /> : (
        <div className="table-wrap" style={{ marginBottom: 20 }}><table className="table">
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Email</th><th>Rol</th><th>Último acceso</th><th>Estado</th><th /></tr></thead>
          <tbody>{data.map((u) => (
            <tr key={u.id}><td><b>{u.full_name}</b></td><td className="mono">{u.username}</td><td>{u.email}</td><td><span className="badge sky">{u.role_name}</span></td>
              <td className="small">{fmtDate(u.last_login_at)}</td><td>{u.active ? <span className="badge ok">Activo</span> : <span className="badge">Inactivo</span>}</td>
              <td><button className="btn ghost icon" onClick={() => setEdit(u)}><Pencil size={15} /></button></td></tr>
          ))}</tbody>
        </table></div>
      )}
      <h2 className="row" style={{ marginBottom: 12 }}><ShieldCheck size={20} />Roles</h2>
      <div className="grid c4">{roles?.map((r) => (
        <div key={r.id} className="card stack" style={{ gap: 8 }}>
          <h3>{r.name}</h3><p className="muted small" style={{ margin: 0 }}>{r.description}</p>
          <div className="row" style={{ gap: 4 }}>{r.permissions.map((p: string) => <span key={p} className="badge" style={{ fontSize: 10.5 }}>{p}</span>)}</div>
        </div>
      ))}</div>
      {edit && <UserModal user={edit} roles={roles ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function UserModal({ user, roles, onClose, onSaved }: { user: any; roles: any[]; onClose: () => void; onSaved: () => void }) {
  const isNew = !user.id;
  const [f, setF] = useState({ username: user.username ?? '', email: user.email ?? '', fullName: user.full_name ?? '', role: user.role ?? 'developer', password: '', active: user.active ?? true });
  const { run, busy } = useAction();
  const save = () => run(async () => {
    if (isNew) await api('/users', { body: { username: f.username, email: f.email, fullName: f.fullName, role: f.role, password: f.password } });
    else await api(`/users/${user.id}`, { method: 'PUT', body: { email: f.email, fullName: f.fullName, role: f.role, active: f.active, password: f.password || undefined } });
    onSaved();
  }, isNew ? 'Usuario creado' : 'Usuario actualizado');
  return (
    <Modal title={isNew ? 'Nuevo usuario' : `Editar ${user.full_name}`} onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>Guardar</button></>}>
      <div className="stack">
        <div className="grid c2">
          <Field label="Nombre completo"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <Field label="Usuario"><input className="input mono" disabled={!isNew} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Rol"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></Field>
        </div>
        <Field label={isNew ? 'Contraseña inicial' : 'Restablecer contraseña'} hint="Mínimo 10 caracteres con letras y números. Se pedirá cambiarla en el primer ingreso.">
          <input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={isNew ? '' : 'Dejar vacío para no cambiar'} />
        </Field>
        {!isNew && <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Usuario activo" />}
      </div>
    </Modal>
  );
}
