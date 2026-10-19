import { useState } from 'react';
import { Eye, FileArchive, FolderUp, Rocket, Trash2, Upload } from 'lucide-react';
import { api, ENV_LABEL, fmtBytes, fmtDate, uploadForm } from '../../api/client';
import { useAuth } from '../../auth';
import CodeEditor, { langFor } from '../../components/CodeEditor';
import { Confirm, Empty, Field, Modal, Spinner, Switch, useAction, useData } from '../../components/ui';
import { TabProps } from './OverviewTab';

export default function VersionsTab({ app, env, reload }: TabProps) {
  const { data, reload: reloadList } = useData<any[]>(() => api(`/applications/${app.id}/versions`), [app.id]);
  const { can } = useAuth();
  const { run } = useAction();
  const [upload, setUpload] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [del, setDel] = useState<any>(null);
  const canDeploy = can(env.name === 'production' ? 'apps.deploy.prod' : 'apps.deploy.nonprod');

  const deploy = (v: any) => run(async () => {
    const dep = await api(`/applications/${app.id}/deploy`, { body: { environment: env.name, versionId: v.id } });
    reload();
    location.search = `?tab=deployments&dep=${dep.id}&env=${env.name}`;
  }, `Deploy de v${v.version} iniciado`);

  return (
    <div className="card stack">
      <div className="card-title"><h3>Versiones</h3>{can('versions.create') && <button className="btn primary sm" onClick={() => setUpload(true)}><Upload size={14} />Subir nueva versión</button>}</div>
      {!data ? <Spinner /> : !data.length ? <Empty title="Sin versiones">Suba el código de la aplicación para crear la primera versión.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Versión</th><th>Origen</th><th>Commit</th><th>Comentario</th><th>Desplegada en</th><th>Tamaño</th><th>Fecha / usuario</th><th /></tr></thead>
            <tbody>
              {data.map((v) => (
                <tr key={v.id}>
                  <td><b>v{v.version}</b>{v.has_image && <span className="badge sky small" style={{ marginLeft: 6 }}>imagen</span>}</td>
                  <td><span className="badge">{v.source_type}</span></td>
                  <td className="mono small">{v.commit_sha?.slice(0, 8) ?? '—'}</td>
                  <td className="small" style={{ maxWidth: 280 }}>{v.comment}</td>
                  <td>{(v.deployed_in ?? []).map((e: string) => <span key={e} className="badge ok" style={{ marginRight: 4 }}>{ENV_LABEL[e]}</span>)}</td>
                  <td className="small">{fmtBytes(v.size_bytes)}</td>
                  <td className="small nowrap">{fmtDate(v.created_at)}<div className="muted">{v.created_by_name ?? '—'}</div></td>
                  <td className="nowrap">
                    <button className="btn ghost icon" title="Ver código y Dockerfile" onClick={() => setView(v.id)}><Eye size={15} /></button>
                    {canDeploy && <button className="btn sm outline" onClick={() => deploy(v)}><Rocket size={13} />{(v.deployed_in ?? []).includes(env.name) ? 'Redeploy' : `Deploy a ${ENV_LABEL[env.name]}`}</button>}
                    {can('apps.edit') && !(v.deployed_in ?? []).length && <button className="btn ghost icon" title="Eliminar" onClick={() => setDel(v)}><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {upload && <UploadVersionModal app={app} env={env} canDeploy={canDeploy} onClose={() => setUpload(false)} onDone={(dep) => { setUpload(false); reloadList(); reload(); if (dep) location.search = `?tab=deployments&dep=${dep.id}&env=${env.name}`; }} />}
      {view && <VersionViewer app={app} versionId={view} onClose={() => setView(null)} />}
      {del && <Confirm title={`Eliminar v${del.version}`} danger text="Se eliminará el código y la configuración de esta versión. No afecta ambientes en ejecución." confirmLabel="Eliminar"
        onConfirm={() => run(async () => { await api(`/applications/${app.id}/versions/${del.id}`, { method: 'DELETE' }); reloadList(); }, 'Versión eliminada')} onClose={() => setDel(null)} />}
    </div>
  );
}

function UploadVersionModal({ app, env, canDeploy, onClose, onDone }: { app: any; env: any; canDeploy: boolean; onClose: () => void; onDone: (dep: any) => void }) {
  const [mode, setMode] = useState<'zip' | 'files'>('zip');
  const [zip, setZip] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [version, setVersion] = useState('');
  const [comment, setComment] = useState('');
  const [regen, setRegen] = useState(false);
  const [deploy, setDeploy] = useState(canDeploy);
  const [progress, setProgress] = useState(0);
  const { run, busy } = useAction();
  const submit = () => run(async () => {
    const fd = new FormData();
    if (mode === 'zip') { if (!zip) throw new Error('Seleccione un ZIP'); fd.append('file', zip); }
    else { if (!files.length) throw new Error('Seleccione una carpeta'); files.forEach((f) => { fd.append('paths', (f as any).webkitRelativePath || f.name); fd.append('files', f); }); }
    if (version) fd.append('version', version);
    fd.append('comment', comment); fd.append('environment', env.name);
    fd.append('regenerateDockerfile', String(regen)); fd.append('deploy', String(deploy && canDeploy));
    const r = await uploadForm(`/applications/${app.id}/upload`, fd, setProgress);
    onDone(r.deployment);
  }, 'Versión creada');
  return (
    <Modal title={`Nueva versión de ${app.name}`} onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy} onClick={submit}>{busy ? <span className="spinner" /> : <Upload size={14} />}Subir{deploy && canDeploy ? ' y desplegar' : ''}</button></>}>
      <div className="stack">
        <div className="seg"><button className={mode === 'zip' ? 'active' : ''} onClick={() => setMode('zip')}><FileArchive size={13} /> ZIP</button><button className={mode === 'files' ? 'active' : ''} onClick={() => setMode('files')}><FolderUp size={13} /> Carpeta</button></div>
        {mode === 'zip'
          ? <input type="file" accept=".zip" onChange={(e) => setZip(e.target.files?.[0] ?? null)} />
          : <input type="file" multiple {...({ webkitdirectory: '' } as any)} onChange={(e) => setFiles(Array.from(e.target.files ?? []).filter((f) => !/(^|\/)(node_modules|\.git)\//.test((f as any).webkitRelativePath)))} />}
        <div className="grid c2">
          <Field label="Versión" hint="Vacío = incrementa automáticamente (patch)"><input className="input mono" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="2.5.1" /></Field>
          <Field label="Comentario"><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Corrección de reportes" /></Field>
        </div>
        <Switch checked={regen} onChange={setRegen} label="Regenerar Dockerfile automáticamente (si no, se reutiliza el de la versión anterior o el del ZIP)" />
        <Switch checked={deploy && canDeploy} disabled={!canDeploy} onChange={setDeploy} label={`Desplegar en ${ENV_LABEL[env.name]} al finalizar`} />
        {busy && <div className="progress"><i style={{ width: `${progress}%` }} /></div>}
      </div>
    </Modal>
  );
}

export function VersionViewer({ app, versionId, onClose }: { app: any; versionId: string; onClose: () => void }) {
  const { data: v } = useData(() => api(`/applications/${app.id}/versions/${versionId}`), [versionId]);
  const [file, setFile] = useState<string>('Dockerfile');
  const [content, setContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const { can } = useAuth();
  const { run, busy } = useAction();
  const open = (p: string) => run(async () => {
    const r = await api(`/applications/${app.id}/versions/${versionId}/file`, { query: { path: p } });
    setFile(p); setContent(r.content); setDirty(false);
  });
  const text = content ?? v?.dockerfile ?? '';
  return (
    <Modal size="lg" title={v ? `v${v.version} — código` : 'Versión'} onClose={onClose} footer={can('versions.create') && dirty ? (
      <button className="btn primary" disabled={busy} onClick={() => run(async () => {
        if (file === 'Dockerfile' && content === null) await api(`/applications/${app.id}/versions/${versionId}/dockerfile`, { method: 'PUT', body: { dockerfile: text } });
        else await api(`/applications/${app.id}/versions/${versionId}/file`, { method: 'PUT', body: { path: file, content: text } });
        setDirty(false);
      }, 'Guardado. El próximo deploy reconstruirá la imagen.')}>Guardar cambios</button>) : undefined}>
      {!v ? <Spinner /> : (
        <div className="grid" style={{ gridTemplateColumns: '260px minmax(0,1fr)' }}>
          <div className="console" style={{ height: 470, background: '#f7f8fc', color: 'var(--ema-text)' }}>
            {v.tree.map((t: any) => (
              <div key={t.path} className="ellipsis" style={{ paddingLeft: (t.path.split('/').length - 1) * 12, cursor: t.type === 'file' ? 'pointer' : 'default', fontWeight: t.path === file ? 700 : 400, color: t.type === 'dir' ? 'var(--ema-navy)' : undefined }}
                onClick={() => t.type === 'file' && open(t.path)}>{t.type === 'dir' ? '▸ ' : ''}{t.path.split('/').pop()}</div>
            ))}
          </div>
          <div className="stack">
            <div className="row small"><code>{file}</code>{dirty && <span className="badge warn">modificado</span>}</div>
            <CodeEditor value={text} language={langFor(file)} height="440px" readOnly={!can('versions.create')} onChange={(val) => { setContent(val); setDirty(true); if (file === 'Dockerfile' && content === null) setContent(val); }} />
          </div>
        </div>
      )}
    </Modal>
  );
}
