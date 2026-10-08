import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adb, resolvePhone } from '../phone.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packages = { yandex_go: 'ru.yandex.taxi', uzum_market: 'uz.uzum.app', uzum_tezkor: 'uz.uzum.tezkor', wildberries: 'com.wildberries.ru', paynet: 'uz.paynet.app' };
const [service, label = 'screen', mode = ''] = process.argv.slice(2);
if (!packages[service] || !/^[a-z0-9-]{1,80}$/.test(label)) throw new Error('Укажи сервис yandex_go, uzum_market, uzum_tezkor, wildberries или paynet и короткое имя экрана.');
if (mode && mode !== '--image-only') throw new Error('Неподдерживаемый режим снимка.');
const endpoint = resolvePhone();
function foreground() {
  const top = adb(['shell', 'dumpsys', 'activity', 'activities'], endpoint).split(/\r?\n/).find(line => /topResumedActivity|mResumedActivity/.test(line));
  if (!top?.includes(packages[service] + '/')) throw new Error('На телефоне открыт другой экран. Снимок остановлен.');
  return top.trim();
}
const activity = foreground(), at = new Date().toISOString();
const remote = '/data/local/tmp/rhythm-service-orders.xml';
let xml = '';
if (!mode) {
  adb(['shell', 'uiautomator', 'dump', remote], endpoint, { timeout: 45000 });
  foreground();
  xml = adb(['shell', 'cat', remote], endpoint);
}
foreground();
const png = adb(['exec-out', 'screencap', '-p'], endpoint, { encoding: null });
foreground();
const directory = path.join(root, '.samples', 'service-orders', service, at.replaceAll(':', '-'));
mkdirSync(directory, { recursive: true });
if (xml) writeFileSync(path.join(directory, label + '.xml'), xml, { flag: 'wx' });
writeFileSync(path.join(directory, label + '.png'), png, { flag: 'wx' });
writeFileSync(path.join(directory, 'source.json'), JSON.stringify({ service, package: packages[service], label, capturedAt: at, activity, method: mode ? 'visible-app-image' : 'visible-app-screen', completeness: 'screen-only' }, null, 2) + '\n', { flag: 'wx' });
const nodes = [];
for (const node of xml.matchAll(/<node\b[^>]*>/g)) {
  const attributes = Object.fromEntries([...node[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2].replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>')]));
  const bounds = attributes.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (attributes.package !== packages[service] || !bounds || Number(bounds[4]) <= Number(bounds[2]) || Number(bounds[3]) <= Number(bounds[1])) continue;
  if (attributes.text || attributes['content-desc']) nodes.push({ text: attributes.text, description: attributes['content-desc'], resourceId: attributes['resource-id'], clickable: attributes.clickable === 'true', bounds: attributes.bounds });
}
console.log(JSON.stringify({ service, capturedAt: at, directory, nodes: nodes.slice(0, 100) }, null, 2));
