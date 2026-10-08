import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, hash } from './store.mjs';
import { createOrders } from './orders.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [filename, mode = '--preview'] = process.argv.slice(2);
if (!filename || !['--preview', '--apply'].includes(mode)) throw new Error('Укажи JSON исходных сведений из .samples/service-orders и --preview или --apply.');
const sourceRoot = realpathSync(path.join(root, '.samples', 'service-orders'));
function sourceFile(value) {
  const file = realpathSync(path.resolve(root, value));
  if (!file.toLocaleLowerCase().startsWith(sourceRoot.toLocaleLowerCase() + path.sep)) throw new Error('Источник должен находиться в приватном архиве .samples/service-orders.');
  return file;
}
const original = sourceFile(filename), bytes = readFileSync(original);
if (bytes.length > 8 * 1024 * 1024) throw new Error('Пакет заказов слишком большой.');
const source = JSON.parse(bytes.toString('utf8')), artifactPaths = source.artifactPaths || [];
if (!Array.isArray(artifactPaths) || artifactPaths.length > 99) throw new Error('Некорректные исходные файлы.');
const files = artifactPaths.map(item => ({ source: sourceFile(item.path), name: item.name }));
files.push({ source: original, name: 'Исходный пакет сведений.json' });
const artifacts = files.map(item => {
  const extension = path.extname(item.source).slice(1).toLowerCase(), data = readFileSync(item.source);
  if (!['png', 'pdf', 'xml', 'html', 'json', 'txt'].includes(extension) || !data.length || data.length > 20 * 1024 * 1024) throw new Error('Неподдерживаемый исходный файл заказа.');
  const digest = hash(data);
  return { name: typeof item.name === 'string' ? item.name : path.basename(item.source), file: digest + '.' + extension, sha256: digest, bytes: data.length };
});
const packet = { ...source, artifacts }; delete packet.artifactPaths;
const digest = hash(JSON.stringify(packet)), directory = path.join(root, '.web');
const store = createStore(path.join(directory, 'money.sqlite'));
try {
  const orders = createOrders(store), preview = orders.preview(packet);
  const summary = { service: source.service, total: preview.rows.length, new: preview.rows.filter(row => row.importStatus === 'new').length, existing: preview.rows.filter(row => row.importStatus === 'existing').length, updated: preview.rows.filter(row => row.importStatus === 'changed').length, withPaymentCandidates: preview.rows.filter(row => row.candidates > 0).length, datesNeedingReview: preview.rows.filter(row => row.dateCertainty !== 'exact').length, artifacts: artifacts.length, coverageNote: source.coverageNote };
  if (mode === '--preview') console.log(JSON.stringify({ mode, ...summary }, null, 2));
  else {
    const before = store.db.prepare('SELECT id,data,version FROM events ORDER BY id').all();
    const at = new Date().toISOString().replaceAll(':', '-'), backups = path.join(directory, 'backups'); mkdirSync(backups, { recursive: true });
    const backup = path.join(backups, 'before-service-orders-' + at + '.sqlite');
    store.db.exec("VACUUM INTO '" + backup.replaceAll("'", "''") + "'");
    const batchId = digest.slice(0, 8) + '-' + digest.slice(8, 12) + '-' + digest.slice(12, 16) + '-' + digest.slice(16, 20) + '-' + digest.slice(20, 32);
    const target = path.join(directory, 'order-files', batchId); mkdirSync(target, { recursive: true });
    for (let i = 0; i < files.length; i++) {
      const file = path.join(target, artifacts[i].file);
      if (!existsSync(file)) copyFileSync(files[i].source, file);
      if (hash(readFileSync(file)) !== artifacts[i].sha256) throw new Error('Исходный файл изменился; импорт остановлен.');
    }
    const result = orders.commit(packet, digest);
    const after = store.db.prepare('SELECT id,data,version FROM events ORDER BY id').all();
    const report = { mode, ...summary, ...result, backup, bankLedgerUnchanged: JSON.stringify(before) === JSON.stringify(after), integrity: store.db.prepare('PRAGMA integrity_check').get().integrity_check };
    writeFileSync(path.join(target, 'import-result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
} finally { store.close(); }
