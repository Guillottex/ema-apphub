import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { paths } from '../config';
import { run, runOk } from '../lib/exec';
import { badRequest } from '../lib/http';
import { rmrf } from '../lib/util';

export interface GitSource {
  url: string;
  provider?: string;
  authType?: 'none' | 'token' | 'basic' | 'ssh';
  username?: string | null;
  credential?: string | null; // token, password o clave privada SSH (en claro, sólo en memoria)
  branch?: string | null;
  tag?: string | null;
  commit?: string | null;
}

const URL_RE = /^(https?:\/\/[^\s]+|ssh:\/\/[^\s]+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+)$/;
const REF_RE = /^[A-Za-z0-9._\/-]{1,200}$/;

export function detectProvider(url: string): string {
  if (/github\.com/i.test(url)) return 'github';
  if (/gitlab/i.test(url)) return 'gitlab';
  if (/bitbucket/i.test(url)) return 'bitbucket';
  return 'git';
}

export function validateSource(s: GitSource) {
  if (!URL_RE.test(s.url) || s.url.startsWith('-')) throw badRequest('URL de repositorio inválida (use https://… o git@host:repo.git)');
  for (const r of [s.branch, s.tag]) if (r && (!REF_RE.test(r) || r.startsWith('-'))) throw badRequest(`Referencia Git inválida: ${r}`);
  if (s.commit && !/^[0-9a-f]{7,40}$/i.test(s.commit)) throw badRequest('Commit inválido (hash hexadecimal)');
  if (s.authType === 'ssh' && !/^(ssh:\/\/|[A-Za-z0-9._-]+@)/.test(s.url)) throw badRequest('La autenticación SSH requiere una URL SSH (git@host:repo.git)');
}

function tokenUser(provider: string, username?: string | null) {
  if (username) return username;
  return provider === 'gitlab' ? 'oauth2' : provider === 'bitbucket' ? 'x-token-auth' : 'x-access-token';
}

/** Prepara entorno/argumentos de autenticación sin dejar credenciales en disco ni en la URL. */
function authContext(s: GitSource) {
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' };
  const pre: string[] = [];
  let keyDir: string | null = null;
  const provider = s.provider || detectProvider(s.url);
  if ((s.authType === 'token' || s.authType === 'basic') && s.credential) {
    const user = s.authType === 'token' ? tokenUser(provider, s.username) : s.username || '';
    const b64 = Buffer.from(`${user}:${s.credential}`).toString('base64');
    pre.push('-c', `http.extraHeader=Authorization: Basic ${b64}`);
  }
  fs.mkdirSync(paths.ssh(), { recursive: true });
  const knownHosts = path.join(paths.ssh(), 'known_hosts');
  let sshCmd = `ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${knownHosts} -o BatchMode=yes`;
  if (s.authType === 'ssh' && s.credential) {
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emakey-'));
    const keyFile = path.join(keyDir, 'id');
    fs.writeFileSync(keyFile, s.credential.replace(/\r\n/g, '\n').trimEnd() + '\n', { mode: 0o600 });
    sshCmd += ` -i ${keyFile} -o IdentitiesOnly=yes`;
  }
  env.GIT_SSH_COMMAND = sshCmd;
  return { env, pre, cleanup: () => keyDir && rmrf(keyDir) };
}

/** Descarga el código en `dest` para el branch / tag / commit indicado. Devuelve el SHA. */
export async function fetchSource(s: GitSource, dest: string, onLine?: (l: string) => void): Promise<string> {
  validateSource(s);
  const ctx = authContext(s);
  try {
    fs.mkdirSync(dest, { recursive: true });
    const g = (args: string[], extra: string[] = []) => runOk('git', [...ctx.pre, ...extra, '-C', dest, ...args], { env: ctx.env, timeoutMs: 10 * 60_000, onLine });
    await g(['init', '-q']);
    await g(['remote', 'add', 'origin', s.url]);
    const ref = s.commit || (s.tag ? `refs/tags/${s.tag}` : s.branch ? `refs/heads/${s.branch}` : 'HEAD');
    onLine?.(`git fetch ${s.url} ${ref}`);
    const r = await run('git', [...ctx.pre, '-C', dest, 'fetch', '--depth', '1', 'origin', ref], { env: ctx.env, timeoutMs: 10 * 60_000, onLine });
    if (r.code !== 0) {
      if (s.commit) { await g(['fetch', 'origin']); } // servidores que no permiten fetch por SHA
      else throw new Error(`No se pudo obtener ${ref}: ${r.stderr.slice(-600)}`);
    }
    await g(['checkout', '-q', s.commit && r.code !== 0 ? s.commit : 'FETCH_HEAD']);
    const sha = (await g(['rev-parse', 'HEAD'])).stdout.trim();
    rmrf(path.join(dest, '.git'));
    return sha;
  } finally {
    ctx.cleanup();
  }
}

/** Lista branches y tags remotos (sirve también para probar credenciales). */
export async function listRefs(s: GitSource): Promise<{ branches: string[]; tags: string[] }> {
  validateSource({ ...s, branch: null, tag: null, commit: null });
  const ctx = authContext(s);
  try {
    const r = await runOk('git', [...ctx.pre, 'ls-remote', '--heads', '--tags', s.url], { env: ctx.env, timeoutMs: 60_000 });
    const branches: string[] = [];
    const tags: string[] = [];
    for (const line of r.stdout.split('\n')) {
      const ref = line.split('\t')[1];
      if (!ref) continue;
      if (ref.startsWith('refs/heads/')) branches.push(ref.slice(11));
      else if (ref.startsWith('refs/tags/') && !ref.endsWith('^{}')) tags.push(ref.slice(10));
    }
    return { branches, tags };
  } finally {
    ctx.cleanup();
  }
}

export const newWebhookSecret = () => crypto.randomBytes(20).toString('hex');
