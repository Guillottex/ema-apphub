import { useEffect, useState } from 'react';
import { Copy, DownloadCloud, Save, Trash2 } from 'lucide-react';
import { api, ENV_LABEL, fmtDate } from '../../api/client';
import { useAuth } from '../../auth';
import { Field, Switch, useAction, useToast } from '../../components/ui';
import { TabProps } from './OverviewTab';

export default function GitTab({ app, env, reload }: TabProps) {
  const repo = app.repository;
  const { can } = useAuth();
  const toast = useToast();
  const { run, busy } = useAction();
  const [f, setF] = useState<any>({});
  const [deploy, setDeploy] = useState(true);
  const manage = can('git.manage');

  useEffect(() => {
    setF({ url: repo?.url ?? '', authType: repo?.auth_type ?? 'none', username: repo?.username ?? '', credential: '',
      refType: repo?.commit_sha ? 'commit' : repo?.tag ? 'tag' : 'branch', ref: repo?.commit_sha ?? repo?.tag ?? repo?.branch ?? 'main',
      subdirectory: repo?.subdirectory ?? '', autoDeployEnvironment: repo?.auto_deploy_environment ?? '' });
  }, [repo]);

  const save = () => run(async () => {
    await api(`/applications/${app.id}/repository`, { method: 'PUT', body: {
      url: f.url, authType: f.authType, username: f.username || null, credential: f.credential || null,
      branch: f.refType === 'branch' ? f.ref : null, tag: f.refType === 'tag' ? f.ref : null, commit: f.refType === 'commit' ? f.ref : null,
      subdirectory: f.subdirectory || null, autoDeployEnvironment: f.autoDeployEnvironment || null,
    } });
    reload();
  }, 'Repositorio guardado');

  const pull = () => run(async () => {
    const r = await api(`/applications/${app.id}/git/pull`, { body: { environment: env.name, deploy } });
    reload();
    if (r.deployment) location.search = `?tab=deployments&dep=${r.deployment.id}&env=${env.name}`;
  }, 'Código actualizado desde Git');

  const webhook = `${location.origin}/api/webhooks/git/${app.id}`;
  return (
    <div className="stack" style={{ gap: 16 }}>
      {repo && (
        <div className="card row">
          <div><h3>Actualizar desde Git</h3><p className="muted small" style={{ margin: '4px 0 0' }}>Pull → nueva versión → Build → Tests → Deploy → Health check (rollback automático si falla).
            {repo.last_sync_at && <> Última sincronización: {fmtDate(repo.last_sync_at)} ({repo.last_commit?.slice(0, 8)}).</>}</p></div>
          <div className="row right">
            <Switch checked={deploy} onChange={setDeploy} label={`Desplegar en ${ENV_LABEL[env.name]}`} />
            {can('versions.create') && <button className="btn primary" disabled={busy} onClick={pull}>{busy ? <span className="spinner" /> : <DownloadCloud size={15} />}Actualizar desde Git</button>}
          </div>
        </div>
      )}
      <div className="card stack">
        <h3>Repositorio</h3>
        <div className="grid c2">
          <Field label="URL" hint="GitHub, GitLab, Bitbucket o servidor Git privado"><input className="input mono" disabled={!manage} value={f.url ?? ''} onChange={(e) => setF({ ...f, url: e.target.value.trim() })} /></Field>
          <Field label="Autenticación"><select className="input" disabled={!manage} value={f.authType} onChange={(e) => setF({ ...f, authType: e.target.value })}>
            <option value="none">Pública</option><option value="token">Token</option><option value="basic">Usuario / contraseña</option><option value="ssh">Clave SSH</option></select></Field>
        </div>
        {f.authType !== 'none' && (
          <div className="grid c2">
            {f.authType !== 'ssh' && <Field label="Usuario"><input className="input" disabled={!manage} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>}
            <Field label="Credencial" hint={repo?.has_credential ? 'Hay una credencial guardada (cifrada). Deje vacío para conservarla.' : 'Se guarda cifrada.'}>
              {f.authType === 'ssh' ? <textarea className="input" rows={4} disabled={!manage} value={f.credential} onChange={(e) => setF({ ...f, credential: e.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                : <input className="input" type="password" disabled={!manage} value={f.credential} onChange={(e) => setF({ ...f, credential: e.target.value })} placeholder={repo?.has_credential ? '••••••••' : ''} />}
            </Field>
          </div>
        )}
        <div className="grid c4">
          <Field label="Tipo de referencia"><select className="input" disabled={!manage} value={f.refType} onChange={(e) => setF({ ...f, refType: e.target.value })}><option value="branch">Branch</option><option value="tag">Tag</option><option value="commit">Commit</option></select></Field>
          <Field label="Referencia"><input className="input mono" disabled={!manage} value={f.ref ?? ''} onChange={(e) => setF({ ...f, ref: e.target.value.trim() })} /></Field>
          <Field label="Subdirectorio"><input className="input mono" disabled={!manage} value={f.subdirectory ?? ''} onChange={(e) => setF({ ...f, subdirectory: e.target.value })} /></Field>
          <Field label="Auto-deploy por webhook"><select className="input" disabled={!manage} value={f.autoDeployEnvironment} onChange={(e) => setF({ ...f, autoDeployEnvironment: e.target.value })}>
            <option value="">No desplegar (sólo crear versión)</option>{Object.entries(ENV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        {manage && (
          <div className="row">
            {repo && <button className="btn danger" onClick={() => run(async () => { await api(`/applications/${app.id}/repository`, { method: 'DELETE' }); reload(); }, 'Repositorio desvinculado')}><Trash2 size={14} />Desvincular</button>}
            <button className="btn primary right" disabled={busy || !f.url} onClick={save}><Save size={14} />Guardar</button>
          </div>
        )}
      </div>
      {repo && manage && (
        <div className="card stack">
          <h3>Webhook (CI/CD)</h3>
          <p className="muted small" style={{ margin: 0 }}>Configure este webhook en GitHub/GitLab/Bitbucket para generar una versión (y desplegar si se eligió un ambiente) en cada push.</p>
          <div className="grid c2">
            <Field label="URL (Payload URL)"><div className="row"><input className="input mono" readOnly value={webhook} /><button className="btn ghost icon" onClick={() => { void navigator.clipboard.writeText(webhook); toast('Copiado'); }}><Copy size={14} /></button></div></Field>
            <Field label="Secreto" hint="GitHub: 'Secret' (firma HMAC). GitLab: 'Secret token'. Otros: ?token=…"><div className="row"><input className="input mono" readOnly type="password" value={app.webhook_secret ?? ''} />
              <button className="btn ghost icon" onClick={() => { void navigator.clipboard.writeText(app.webhook_secret ?? ''); toast('Secreto copiado'); }}><Copy size={14} /></button></div></Field>
          </div>
        </div>
      )}
    </div>
  );
}
