import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { pool } from './pool';
import { config } from '../config';

/** Aplica migraciones pendientes (database/migrations/*.sql) y seeds idempotentes. */
export async function migrate(): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query(`SELECT pg_advisory_lock(424242)`);
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(200) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const dir = path.join(config.migrationsDir, 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await c.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      console.log(`[migrate] aplicando ${f}`);
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [f]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
    const seedDir = path.join(config.migrationsDir, 'seeds');
    if (fs.existsSync(seedDir)) {
      for (const f of fs.readdirSync(seedDir).filter((x) => x.endsWith('.sql')).sort()) {
        await c.query(fs.readFileSync(path.join(seedDir, f), 'utf8'));
      }
    }
    // Super administrador inicial
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM users`);
    if (rows[0].n === 0) {
      const hash = await bcrypt.hash(config.adminPassword, 12);
      await c.query(
        `INSERT INTO users (username, email, full_name, password_hash, role_id, must_change_password)
         VALUES ($1,$2,'Super Administrador',$3,(SELECT id FROM roles WHERE code='superadmin'), true)`,
        [config.adminUsername, config.adminEmail, hash],
      );
      console.log(`[migrate] usuario inicial creado: ${config.adminUsername}`);
    }
  } finally {
    await c.query(`SELECT pg_advisory_unlock(424242)`).catch(() => undefined);
    c.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => { console.log('[migrate] OK'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
