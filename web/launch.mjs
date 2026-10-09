import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), url = 'http://127.0.0.1:8788';
async function ready() { try { const response = await fetch(url + '/health', { signal: AbortSignal.timeout(1500) }); return response.ok && (await response.json()).service === 'rhythm-money-web'; } catch { return false; } }
if (!await ready()) {
  mkdirSync(path.join(root, '.web'), { recursive: true });
  const output = openSync(path.join(root, '.web', 'server.log'), 'a'), errors = openSync(path.join(root, '.web', 'server-errors.log'), 'a');
  const child = spawn(process.execPath, [path.join(root, 'web/server.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output, errors] });
  child.unref(); closeSync(output); closeSync(errors);
  let online = false; for (let attempt = 0; attempt < 30; attempt++) { if (await ready()) { online = true; break; } await new Promise(resolve => setTimeout(resolve, 300)); }
  if (!online) throw new Error('Сервер не запустился. Проверь .web/server-errors.log.');
}
spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Process', url], { windowsHide: true, stdio: 'ignore' }).unref();
console.log('My Personal Throughput Accounting: ' + url);
