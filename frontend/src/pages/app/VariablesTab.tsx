import { useEffect, useState } from 'react';
import { Download, RotateCw, Save } from 'lucide-react';
import { api, ENV_LABEL } from '../../api/client';
import { useAuth } from '../../auth';
import { VarRow, VarsEditor } from '../../components/Editors';
import { Spinner, useAction } from '../../components/ui';
import { TabProps } from './OverviewTab';

export default function VariablesTab({ app, env, reload }: TabProps) {
  const [rows, setRows] = useState<VarRow[] | null>(null);
  const [restart, setRestart] = useState(false);
  const { can } = useAuth();
  const { run, busy } = useAction();

  const load = async () => {
    const vars = await api<any[]>(`/applications/${app.id}/env`, { query: { environment: env.name } });
    setRows(vars.map((v) => ({ key: v.key, value: v.isSecret ? '' : v.value ?? '', isSecret: v.isSecret, isSystem: v.isSystem, masked: v.isSecret })));
  };
  useEffect(() => { setRows(null); void load(); /* eslint-disable-next-line */ }, [app.id, env.name]);

  const save = () => run(async () => {
    const variables = rows!.filter((r) => r.key && !r.isSystem).map((r) => ({ key: r.key, isSecret: r.isSecret, value: r.masked && !r.value ? '********' : r.value }));
    const r = await api(`/applications/${app.id}/env`, { method: 'PUT', body: { environment: env.name, variables } });
    setRestart(r.restartRequired);
    await load();
  }, 'Variables guardadas');

  if (!rows) return <Spinner />;
  return (
    <div className="card stack">
      <div className="card-title">
        <div><h3>Variables de entorno — {ENV_LABEL[env.name]}</h3><p className="muted small" style={{ margin: '4px 0 0' }}>Los valores secretos se guardan cifrados (AES-256-GCM) y nunca se vuelven a mostrar. Deje el campo vacío para conservar el valor actual.</p></div>
        <div className="row">
          <a className="btn sm outline" href={`/api/applications/${app.id}/env/export?environment=${env.name}`}><Download size={14} />Exportar .env</a>
          {can('apps.edit') && <button className="btn sm primary" disabled={busy} onClick={save}><Save size={14} />Guardar</button>}
        </div>
      </div>
      {restart && (
        <div className="alert warn row">Las variables se aplican al recrear el contenedor.
          <button className="btn sm primary right" onClick={() => run(async () => { await api(`/applications/${app.id}/recreate`, { body: { environment: env.name } }); setRestart(false); reload(); }, 'Contenedor recreado')}><RotateCw size={13} />Aplicar ahora</button>
        </div>
      )}
      <VarsEditor rows={rows} onChange={setRows} readOnly={!can('apps.edit')} />
    </div>
  );
}
