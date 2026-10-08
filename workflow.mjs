import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.dirname(fileURLToPath(import.meta.url));
export function run(executable, args, options = {}) {
  return execFileSync(executable, args, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], ...options });
}
export const git = args => run('git', args).trim();
export function readVersion() {
  const xml = readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');
  const name = xml.match(/android:versionName="([^"]+)"/)?.[1];
  const code = Number(xml.match(/android:versionCode="(\d+)"/)?.[1]);
  const packageId = xml.match(/\bpackage="([^"]+)"/)?.[1];
  parseVersion(name);
  if (!Number.isSafeInteger(code) || code < 1 || code > 2100000000 || packageId !== 'uz.rhythm.money') throw new Error('Некорректные данные версии в AndroidManifest.xml.');
  return { name, code, packageId, xml };
}
export function parseVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('Нужна версия вида 0.2.1.');
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('Слишком большой номер версии.');
  return parts;
}
export function newerVersion(next, previous) {
  const a = parseVersion(next), b = parseVersion(previous);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function sourceRevision() {
  try { return { commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain']).length !== 0 }; }
  catch { return { commit: null, dirty: true }; }
}
export function requireSigningKey() {
  const key = path.join(root, '.signing', 'local.jks');
  if (!existsSync(key)) throw new Error('Нет прежнего ключа .signing/local.jks. Восстанови его из своей копии: новый ключ не обновит установленное приложение.');
  return key;
}
export function latestBuild() {
  const meta = JSON.parse(readFileSync(path.join(root, 'output', 'latest-build.json'), 'utf8'));
  if (typeof meta.apk !== 'string' || path.basename(meta.apk) !== meta.apk || !meta.apk.endsWith('.apk') || !/^[a-f0-9]{64}$/.test(meta.sha256)) throw new Error('Некорректное описание сборки.');
  return { ...meta, apkPath: path.join(root, 'output', meta.apk) };
}
