import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../workflow.mjs';
import { createStore, hash } from './store.mjs';
import { flowOf } from './flows.mjs';

const args = process.argv.slice(2);
if (args.some(arg => !['--preview', '--apply'].includes(arg)) || (args.includes('--preview') && args.includes('--apply'))) throw new Error('Используй --preview или --apply. Без аргументов выполняется предпросмотр.');
const filename = path.join(root, '.web/money.sqlite');
const db = new DatabaseSync(filename, { readOnly: true });
const originals = db.prepare('SELECT id,data,version FROM events').all(); db.close();
const untouched = originals.map(row => ({ ...JSON.parse(row.data), version: row.version })).filter(row => row.version === 1 && row.source_type === 'sms' && row.state === 'review' && row.amount_minor === null && row.date === null && !row.purpose);
const jdk = readdirSync(path.join(root, '.tools/jdk')).map(name => path.join(root, '.tools/jdk', name)).find(folder => existsSync(path.join(folder, 'bin/java.exe')));
if (!jdk) throw new Error('Для повторного разбора нужен настроенный JDK проекта.');
const classes = path.join(root, 'build/sms-reparse'); mkdirSync(classes, { recursive: true });
const run = (tool, values, input) => execFileSync(path.join(jdk, 'bin', tool + '.exe'), values, { cwd: root, windowsHide: true, encoding: 'utf8', input, maxBuffer: 64000000, timeout: 120000 });
run('javac', ['-encoding', 'UTF-8', '--release', '8', '-d', classes, 'src/uz/rhythm/money/Formats.java', 'src/uz/rhythm/money/BankParser.java', 'tools/SmsReparseCli.java']);
const encoded = untouched.map(row => Buffer.from(row.raw_fragment, 'utf8').toString('base64')).join('\n');
const output = untouched.length ? run('java', ['-cp', classes, 'uz.rhythm.money.SmsReparseCli'], encoded + '\n').trim().split(/\r?\n/) : [];
if (output.length !== untouched.length) throw new Error('Число ответов парсера не совпало с числом SMS.');
const changes = [];
for (let index = 0; index < output.length; index++) {
  if (output[index] === '0') continue;
  const fields = output[index].split('\t');
  if (fields.length !== 10 || fields[0] !== '1') throw new Error('Некорректный ответ парсера SMS.');
  const decoded = value => Buffer.from(value, 'base64').toString('utf8');
  const values = { amount_minor: Number(fields[1]), balance_minor: fields[2] ? Number(fields[2]) : null, currency: decoded(fields[3]), date: decoded(fields[4]), time: decoded(fields[5]), merchant: decoded(fields[6]), card_suffix: decoded(fields[7]), signature: decoded(fields[8]), bank_operation: decoded(fields[9]) };
  if (!Number.isSafeInteger(values.amount_minor) || (values.balance_minor !== null && !Number.isSafeInteger(values.balance_minor))) throw new Error('Неточная сумма при повторном разборе.');
  changes.push({ id: untouched[index].id, expectedVersion: untouched[index].version, fields: values });
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = path.join(root, '.web/reparse-sms', stamp); mkdirSync(directory, { recursive: true });
const summary = { mode: args.includes('--apply') ? 'apply' : 'preview', scanned: untouched.length, recognised: changes.length, incoming: changes.filter(change => flowOf({ ...change.fields, kind: 'unknown' }) === 'incoming').length, stillUnknown: untouched.length - changes.length, changed: 0 };
writeFileSync(path.join(directory, 'preview.json'), JSON.stringify({ summary, changes }, null, 2) + '\n');
if (args.includes('--apply')) {
  const store = createStore(filename);
  try {
    const backupPath = path.join(root, '.web/backups/before-sms-reparse-' + stamp + '.sqlite'); mkdirSync(path.dirname(backupPath), { recursive: true });
    store.db.exec("VACUUM INTO '" + backupPath.replaceAll("'", "''") + "'");
    summary.changed = store.reparseSms(changes).length;
    const rawKeys = ['id', 'fingerprint', 'source_type', 'source_name', 'source_ref', 'received_at', 'event_millis', 'raw_title', 'raw_text', 'raw_fragment'];
    const modified = new Set(changes.map(change => change.id));
    const after = new Map(store.db.prepare('SELECT id,data,version FROM events').all().map(row => [row.id, row]));
    summary.rawPreserved = originals.every(row => { const current = after.get(row.id); if (!current) return false; const original = JSON.parse(row.data), latest = JSON.parse(current.data); return rawKeys.every(key => original[key] === latest[key]); });
    summary.otherRecordsUnchanged = originals.filter(row => !modified.has(row.id)).every(row => after.get(row.id)?.data === row.data && after.get(row.id)?.version === row.version);
    summary.originalSnapshotSha256 = hash(JSON.stringify(originals)); summary.backupPath = backupPath;
    summary.integrity = Object.values(store.db.prepare('PRAGMA integrity_check').get())[0];
    if (!summary.rawPreserved || !summary.otherRecordsUnchanged || summary.integrity !== 'ok') throw new Error('Проверка сохранности после повторного разбора не прошла.');
  } finally { store.close(); }
}
writeFileSync(path.join(directory, 'result.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, auditDirectory: directory }, null, 2));
