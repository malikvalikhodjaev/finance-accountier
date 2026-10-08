import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.join(root, '.tools');
await mkdir(toolRoot, { recursive: true });
const jdkUrl = 'https://aka.ms/download-jdk/microsoft-jdk-17.0.20.1-windows-x64.zip';
const hashResponse = await fetch(jdkUrl + '.sha256sum.txt', { signal: AbortSignal.timeout(60000) });
if (!hashResponse.ok) throw new Error('Не получена официальная контрольная сумма JDK: ' + hashResponse.status);
const jdkHash = (await hashResponse.text()).match(/\b[a-f0-9]{64}\b/i)?.[0];
if (!jdkHash) throw new Error('Некорректная контрольная сумма JDK.');
const packages = [
  { name: 'jdk', url: jdkUrl, algorithm: 'sha256', hash: jdkHash, archive: 'jdk.zip' },
  { name: 'platform', url: 'https://dl.google.com/android/repository/platform-35_r02.zip', algorithm: 'sha1', hash: '0bb560a90a7a2cbd0dd8348224d518b638fe7949', archive: 'platform.zip' },
  { name: 'build-tools', url: 'https://dl.google.com/android/repository/build-tools_r35_windows.zip', algorithm: 'sha1', hash: 'af059bb67cf7786f45ee0db85e2d24985df1b4b6', archive: 'build-tools.zip' }
];
await Promise.all(packages.map(async item => {
  const destination = path.join(toolRoot, item.archive);
  try { await stat(destination); }
  catch {
    console.log('Загрузка: ' + item.name);
    const response = await fetch(item.url, { signal: AbortSignal.timeout(600000) });
    if (!response.ok) throw new Error(item.name + ': HTTP ' + response.status);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: 'wx' }));
  }
  const hasher = createHash(item.algorithm);
  for await (const chunk of createReadStream(destination)) hasher.update(chunk);
  if (hasher.digest('hex').toLowerCase() !== item.hash.toLowerCase()) throw new Error('Контрольная сумма не совпала: ' + item.name);
  const target = path.join(toolRoot, item.name);
  await mkdir(target, { recursive: true });
  execFileSync('tar.exe', ['-xf', destination, '-C', target], { windowsHide: true, stdio: 'pipe' });
  console.log('Готово: ' + item.name);
}));
await writeFile(path.join(toolRoot, 'provenance.json'), JSON.stringify({ downloadedAt: new Date().toISOString(), packages }, null, 2) + '\n', 'utf8');
