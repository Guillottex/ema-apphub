import { useEffect, useState } from 'react';
import { GitCommitVertical, Save, Wand2 } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth';
import CodeEditor from '../../components/CodeEditor';
import { Field, Spinner, useAction, useData } from '../../components/ui';
import { TabProps } from './OverviewTab';
import { VersionViewer } from './VersionsTab';

export default function DockerTab({ app, env, reload }: TabProps) {
  const versionId = env.deployed_version_id ?? app.current_version?.id;
  const { data: version, reload: reloadVersion } = useData(() => (versionId ? api(`/applications/${app.id}/versions/${versionId}`) : Promise.resolve(null)), [versionId]);
  const { data: compose } = useData(() => api(`/applications/${app.id}/compose`, { query: { environment: env.name } }), [app.id, env.name, env.deployed_version_id]);
  const [dockerfile, setDockerfile] = useState('');
  const [newVersion, setNewVersion] = useState('');
  const [files, setFiles] = useState(false);
  const { can } = useAuth();
  const { run, busy } = useAction();
  const editable = can('versions.create');

  useEffect(() => { if (version) setDockerfile(version.dockerfile); }, [version]);

  const regenerate = () => run(async () => {
    const r = await api('/applications/dockerfile/preview', { body: { technology: app.technology, internalPort: app.internal_port, buildConfig: app.build_config } });
    setDockerfile(r.dockerfile);
  }, 'Dockerfile regenerado (sin guardar)');

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card stack">
        <div className="card-title">
          <div><h3>Dockerfile {version && <span className="badge">v{version.version}</span>}</h3>
            <p className="muted small" style={{ margin: '4px 0 0' }}>Guardar en la versión marca la imagen para reconstruirse en el próximo deploy. "Guardar como nueva versión" conserva el historial.</p></div>
          {editable && version && (
            <div className="row">
              <button className="btn sm outline" onClick={regenerate}><Wand2 size={14} />Regenerar</button>
              <button className="btn sm outline" onClick={() => setFiles(true)}>Explorar / editar archivos</button>
            </div>
          )}
        </div>
        {!versionId ? <div className="alert info">Todavía no hay código cargado. Use “Subir nueva versión” en la pestaña Versiones.</div> : !version ? <Spinner /> : (
          <>
            <CodeEditor value={dockerfile} onChange={setDockerfile} language="dockerfile" height="420px" readOnly={!editable} />
            {editable && (
              <div className="row">
                <button className="btn outline" disabled={busy || dockerfile === version.dockerfile} onClick={() => run(async () => {
                  await api(`/applications/${app.id}/versions/${version.id}/dockerfile`, { method: 'PUT', body: { dockerfile } }); reloadVersion();
                }, `Dockerfile guardado en v${version.version}`)}><Save size={14} />Guardar en v{version.version}</button>
                <div className="row right">
                  <Field label=""><input className="input mono" style={{ width: 140 }} placeholder="nueva versión" value={newVersion} onChange={(e) => setNewVersion(e.target.value)} /></Field>
                  <button className="btn primary" disabled={busy} onClick={() => run(async () => {
                    await api(`/applications/${app.id}/versions`, { body: { fromVersionId: version.id, version: newVersion || undefined, dockerfile, comment: 'Cambio de Dockerfile' } });
                    setNewVersion(''); reload();
                  }, 'Nueva versión creada')}><GitCommitVertical size={14} />Guardar como nueva versión</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="card stack">
        <div className="card-title"><div><h3>docker-compose.yml — {env.name}</h3><p className="muted small" style={{ margin: '4px 0 0' }}>
          {compose?.generated ? 'Archivo activo en el servidor.' : 'Vista previa: se genera en el próximo deploy.'} Las credenciales viven en <code>.env</code> / <code>db.env</code> (permisos 0600), nunca en este archivo.</p></div></div>
        {compose ? <CodeEditor value={compose.compose} language="yaml" height="360px" readOnly /> : <Spinner />}
      </div>
      {files && versionId && <VersionViewer app={app} versionId={versionId} onClose={() => { setFiles(false); reloadVersion(); }} />}
    </div>
  );
}
