import { Request } from 'express';
import { q } from '../db/pool';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  app?: { id: string; name: string } | null;
  details?: Record<string, unknown>;
  result?: 'success' | 'failure';
}

export function clientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || '').replace('::ffff:', '');
}

export async function audit(req: Request | null, e: AuditEntry, user?: { id: string; username: string } | null) {
  const u = user ?? req?.user ?? null;
  try {
    await q(
      `INSERT INTO audit_logs (user_id, username, ip, action, entity_type, entity_id, application_id, application_name, details, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [u?.id ?? null, u?.username ?? 'sistema', req ? clientIp(req) : null, e.action, e.entityType ?? null,
       e.entityId ?? null, e.app?.id ?? null, e.app?.name ?? null, e.details ? JSON.stringify(e.details) : null, e.result ?? 'success'],
    );
  } catch (err) {
    console.error('[audit] no se pudo registrar', err);
  }
}
