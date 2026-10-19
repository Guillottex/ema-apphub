import { one, q } from '../db/pool';
import { decrypt, encrypt, randomPassword } from '../lib/crypto';
import { badRequest, conflict, notFound } from '../lib/http';
import { dbContainerName, projectName, sleep } from '../lib/util';
import { AppRow, EnvRow, currentImageFor, imageTag, upsertVar, writeEnvFiles, envProject } from './core';
import * as dk from './docker';

/**
 * Bases de datos por ambiente. Hoy: PostgreSQL como servicio "db" dentro del
 * compose del ambiente (red interna aislada). La columna `engine` y este módulo
 * permiten sumar MySQL/MariaDB/MongoDB/Redis implementando un "engine adapter".
 */

export const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const PW_RE = /^[A-Za-z0-9!@#%^*_+=.,:-]{12,128}$/;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function psql(container: string, user: string, db: string, sql: string) {
  const r = await dk.execIn(container, ['psql', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', db, '-q'], sql);
  if (r.code !== 0) throw new Error(`psql: ${r.stderr.slice(-800)}`);
  return r.stdout;
}

async function owner(dbId: string) {
  const o = await one(`SELECT * FROM database_credentials WHERE database_id=$1 AND is_owner`, [dbId]);
  if (!o) throw notFound('Credencial propietaria no encontrada');
  return o;
}

async function waitDbHealthy(container: string, seconds = 90) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const s = await dk.containerState(container);
    if (s?.health === 'healthy') return;
    if (s && !s.running && s.state === 'exited') throw new Error('El contenedor de base de datos se detuvo');
    await sleep(2000);
  }
  throw new Error('La base de datos no quedó saludable a tiempo');
}

async function setSystemVars(app: AppRow, env: EnvRow, db: any, user: string, password: string) {
  await upsertVar(env.id, 'DATABASE_HOST', db.host, false, true);
  await upsertVar(env.id, 'DATABASE_PORT', String(db.port), false, true);
  await upsertVar(env.id, 'DATABASE_NAME', db.database_name, false, true);
  await upsertVar(env.id, 'DATABASE_USER', user, false, true);
  await upsertVar(env.id, 'DATABASE_PASSWORD', password, true, true);
  await upsertVar(env.id, 'DATABASE_URL', `postgresql://${user}:${encodeURIComponent(password)}@${db.host}:${db.port}/${db.database_name}`, true, true);
}

async function placeholderImage(app: AppRow, env: EnvRow) {
  return (await currentImageFor(app, env)) ?? imageTag(app.slug, 'pending');
}

async function refreshApp(app: AppRow, env: EnvRow) {
  const image = await placeholderImage(app, env);
  const dir = await writeEnvFiles(app, env, image);
  if (env.deployed_version_id && env.status !== 'stopped') {
    await dk.compose(dir, envProject(app, env), ['up', '-d', 'app']).catch((e) => console.error('[db] recrear app', e.message));
  }
  return dir;
}

export async function createDatabase(app: AppRow, env: EnvRow, opts: { databaseName?: string; username?: string; version?: string }) {
  if (await one(`SELECT 1 FROM databases WHERE environment_id=$1`, [env.id])) throw conflict('El ambiente ya tiene una base de datos');
  const dbName = opts.databaseName || app.slug.replace(/-/g, '_');
  const user = opts.username || `${dbName}_user`.slice(0, 63);
  if (!IDENT_RE.test(dbName) || !IDENT_RE.test(user)) throw badRequest('Nombre de base/usuario inválido (minúsculas, números y _)');
  const version = opts.version && /^\d{2}$/.test(opts.version) ? opts.version : '16';
  const password = randomPassword();
  const container = dbContainerName(app.slug, env.name);
  const db = await one(
    `INSERT INTO databases (application_id, environment_id, engine, engine_version, container_name, host, port, database_name, volume_name)
     VALUES ($1,$2,'postgres',$3,$4,$4,5432,$5,$6) RETURNING *`,
    [app.id, env.id, version, container, dbName, `${projectName(app.slug, env.name)}-dbdata`],
  );
  await q(`INSERT INTO database_credentials (database_id, username, password_enc, is_owner, privileges) VALUES ($1,$2,$3,true,'owner')`,
    [db.id, user, encrypt(password)]);
  await setSystemVars(app, env, db, user, password);
  try {
    const dir = await writeEnvFiles(app, env, await placeholderImage(app, env));
    await dk.ensureNetwork();
    await dk.compose(dir, envProject(app, env), ['up', '-d', 'db']);
    await waitDbHealthy(container);
    await q(`UPDATE databases SET status='running' WHERE id=$1`, [db.id]);
    await refreshApp(app, env);
  } catch (e) {
    await q(`UPDATE databases SET status='error' WHERE id=$1`, [db.id]);
    throw e;
  }
  return one(`SELECT * FROM databases WHERE id=$1`, [db.id]);
}

export async function deleteDatabase(app: AppRow, env: EnvRow) {
  const db = await one(`SELECT * FROM databases WHERE environment_id=$1`, [env.id]);
  if (!db) throw notFound('El ambiente no tiene base de datos');
  const dir = await writeEnvFiles(app, env, await placeholderImage(app, env));
  await dk.compose(dir, envProject(app, env), ['rm', '-s', '-f', 'db']).catch(() => undefined);
  await dk.removeVolume(db.volume_name);
  await q(`DELETE FROM environment_variables WHERE environment_id=$1 AND is_system AND key LIKE 'DATABASE_%'`, [env.id]);
  await q(`DELETE FROM databases WHERE id=$1`, [db.id]);
  await refreshApp(app, env);
}

export async function restartDatabase(env: EnvRow) {
  const db = await one(`SELECT * FROM databases WHERE environment_id=$1`, [env.id]);
  if (!db) throw notFound('El ambiente no tiene base de datos');
  await dk.containerAction(db.container_name, 'restart');
  await waitDbHealthy(db.container_name, 60);
  await q(`UPDATE databases SET status='running' WHERE id=$1`, [db.id]);
}

export async function databaseInfo(env: EnvRow) {
  const db = await one(`SELECT * FROM databases WHERE environment_id=$1`, [env.id]);
  if (!db) return null;
  const users = await q(`SELECT id, username, is_owner, privileges, created_at, rotated_at FROM database_credentials WHERE database_id=$1 ORDER BY is_owner DESC, username`, [db.id]);
  const state = await dk.containerState(db.container_name);
  const stats = state?.running ? await dk.containerStats(db.container_name) : null;
  let sizeBytes: number | null = null;
  if (state?.running) {
    try {
      const o = await owner(db.id);
      const out = await psql(db.container_name, o.username, db.database_name, `SELECT pg_database_size(current_database());`);
      sizeBytes = Number(out.split('\n').map((l) => l.trim()).find((l) => /^\d+$/.test(l)) ?? NaN) || null;
    } catch { /* ignore */ }
  }
  const ownerUser = users.find((u) => u.is_owner)?.username ?? '';
  return {
    ...db, users, container: state, stats, sizeBytes,
    connection: {
      host: db.host, port: db.port, database: db.database_name, username: ownerUser, password: '********',
      url: `postgresql://${ownerUser}:********@${db.host}:${db.port}/${db.database_name}`,
    },
  };
}

export async function addUser(env: EnvRow, username: string, privileges: 'readwrite' | 'readonly', password?: string) {
  const db = await one(`SELECT * FROM databases WHERE environment_id=$1`, [env.id]);
  if (!db) throw notFound('El ambiente no tiene base de datos');
  if (!IDENT_RE.test(username)) throw badRequest('Usuario inválido');
  if (password && !PW_RE.test(password)) throw badRequest('Contraseña inválida (12-128 caracteres, sin comillas ni espacios)');
  if (await one(`SELECT 1 FROM database_credentials WHERE database_id=$1 AND username=$2`, [db.id, username])) throw conflict(`El usuario ${username} ya existe`);
  const pw = password || randomPassword();
  const o = await owner(db.id);
  const grants = privileges === 'readonly'
    ? `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${username};
       ALTER DEFAULT PRIVILEGES FOR ROLE ${o.username} IN SCHEMA public GRANT SELECT ON TABLES TO ${username};`
    : `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${username};
       GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${username};
       ALTER DEFAULT PRIVILEGES FOR ROLE ${o.username} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${username};
       ALTER DEFAULT PRIVILEGES FOR ROLE ${o.username} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${username};`;
  await psql(db.container_name, o.username, db.database_name,
    `CREATE ROLE ${username} LOGIN PASSWORD ${lit(pw)};
     GRANT CONNECT ON DATABASE ${db.database_name} TO ${username};
     GRANT USAGE ON SCHEMA public TO ${username};
     ${grants}`);
  return one(`INSERT INTO database_credentials (database_id, username, password_enc, privileges) VALUES ($1,$2,$3,$4)
              RETURNING id, username, privileges, created_at`, [db.id, username, encrypt(pw), privileges]);
}

export async function removeUser(env: EnvRow, credId: string) {
  const db = await one(`SELECT * FROM databases WHERE environment_id=$1`, [env.id]);
  const cred = db && (await one(`SELECT * FROM database_credentials WHERE id=$1 AND database_id=$2`, [credId, db.id]));
  if (!db || !cred) throw notFound('Usuario no encontrado');
  if (cred.is_owner) throw badRequest('No se puede eliminar el usuario propietario');
  const o = await owner(db.id);
  await psql(db.container_name, o.username, db.database_name,
    `REASSIGN OWNED BY ${cred.username} TO ${o.username}; DROP OWNED BY ${cred.username}; DROP ROLE IF EXISTS ${cred.username};`);
  await q(`DELETE FROM database_credentials WHERE id=$1`, [credId]);
}

/** Cambia la contraseña. Nunca la devuelve: si es del propietario se reinyecta en las variables y se recrea la app. */
export async function rotatePassword(app: AppRow, env: EnvRow, credId: string, password?: string) {
  const db = await one(`SELECT * FROM databases WHERE environment_id=$1`, [env.id]);
  const cred = db && (await one(`SELECT * FROM database_credentials WHERE id=$1 AND database_id=$2`, [credId, db.id]));
  if (!db || !cred) throw notFound('Usuario no encontrado');
  if (password && !PW_RE.test(password)) throw badRequest('Contraseña inválida (12-128 caracteres, sin comillas ni espacios)');
  const pw = password || randomPassword();
  const o = await owner(db.id);
  await psql(db.container_name, o.username, db.database_name, `ALTER ROLE ${cred.username} WITH PASSWORD ${lit(pw)};`);
  await q(`UPDATE database_credentials SET password_enc=$2, rotated_at=now() WHERE id=$1`, [credId, encrypt(pw)]);
  if (cred.is_owner) {
    await setSystemVars(app, env, db, cred.username, pw);
    await refreshApp(app, env);
  }
}

export async function ownerCredentials(dbId: string) {
  const o = await owner(dbId);
  return { username: o.username as string, password: decrypt(o.password_enc) };
}
