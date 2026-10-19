import AdmZip from 'adm-zip';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config, paths } from '../config';
import { badRequest } from '../lib/http';
import { rmrf, safeJoin } from '../lib/util';

export function ensureDataDirs() {
  for (const d of [paths.apps(), paths.uploads(), path.join(config.dataDir, 'backups'), path.join(config.dataDir, 'databases'), paths.logs(), paths.ssh()]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/** Crea un directorio temporal de trabajo dentro de DATA_DIR/tmp. */
export function createStaging(prefix = 'stg'): string {
  const dir = path.join(paths.uploads(), `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const IGNORED = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/;

/**
 * Descomprime un ZIP validando: firma, cantidad de entradas, tamaño total
 * descomprimido (zip-bomb), rutas (zip-slip) y enlaces simbólicos.
 */
export function extractZip(zipFile: string, dest: string) {
  const fd = fs.openSync(zipFile, 'r');
  const sig = Buffer.alloc(4);
  fs.readSync(fd, sig, 0, 4, 0);
  fs.closeSync(fd);
  if (sig.readUInt32LE(0) !== 0x04034b50) throw badRequest('El archivo no es un ZIP válido');

  let zip: AdmZip;
  try { zip = new AdmZip(zipFile); } catch { throw badRequest('ZIP corrupto o ilegible'); }
  const entries = zip.getEntries();
  if (entries.length > config.maxZipEntries) throw badRequest(`El ZIP supera el máximo de ${config.maxZipEntries} archivos`);
  const total = entries.reduce((s, e) => s + (e.header.size || 0), 0);
  if (total > config.maxUnzippedMb * 1024 * 1024) throw badRequest(`El contenido descomprimido supera ${config.maxUnzippedMb} MB`);

  const base = path.resolve(dest);
  for (const e of entries) {
    const name = e.entryName.replace(/\\/g, '/');
    if (IGNORED.test(name)) continue;
    const isSymlink = ((e.attr >>> 16) & 0o170000) === 0o120000;
    if (isSymlink) continue;
    const target = safeJoin(base, name);
    if (e.isDirectory) { fs.mkdirSync(target, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.getData());
    const mode = (e.attr >>> 16) & 0o777;
    if (mode & 0o111) fs.chmodSync(target, 0o755);
  }
  flattenSingleRoot(base);
}

/** Si el contenido es una única carpeta (mi-app/...), sube su contenido un nivel. */
export function flattenSingleRoot(dir: string) {
  const items = fs.readdirSync(dir).filter((n) => !IGNORED.test(n));
  if (items.length !== 1) return;
  const only = path.join(dir, items[0]);
  if (!fs.statSync(only).isDirectory()) return;
  const tmp = `${dir}.__flat`;
  fs.renameSync(only, tmp);
  rmrf(dir);
  fs.renameSync(tmp, dir);
}

/** Guarda archivos subidos desde el navegador (carga de carpeta) respetando sus rutas relativas. */
export function placeUploadedFiles(files: Express.Multer.File[], relPaths: string[], dest: string) {
  const base = path.resolve(dest);
  files.forEach((f, i) => {
    const rel = (relPaths[i] || f.originalname).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || IGNORED.test(rel) || rel.split('/').includes('node_modules') || rel.split('/').includes('.git')) {
      fs.rmSync(f.path, { force: true });
      return;
    }
    const target = safeJoin(base, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(f.path, target);
  });
  flattenSingleRoot(base);
}

export function moveDir(src: string, dst: string) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  rmrf(dst);
  try { fs.renameSync(src, dst); } catch { fs.cpSync(src, dst, { recursive: true }); rmrf(src); }
}

export function listTree(root: string, maxEntries = 400): { path: string; type: 'file' | 'dir'; size?: number }[] {
  const out: { path: string; type: 'file' | 'dir'; size?: number }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= maxEntries) return;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      const rel = path.relative(root, p);
      if (e.isDirectory()) { out.push({ path: rel, type: 'dir' }); walk(p); }
      else out.push({ path: rel, type: 'file', size: fs.statSync(p).size });
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/** Limpia temporales de más de 24 h. */
export function cleanupTmp() {
  const dir = paths.uploads();
  if (!fs.existsSync(dir)) return;
  const limit = Date.now() - 24 * 3600 * 1000;
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    try { if (fs.statSync(p).mtimeMs < limit) rmrf(p); } catch { /* ignore */ }
  }
}
