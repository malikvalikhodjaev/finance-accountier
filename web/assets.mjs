import { randomUUID } from 'node:crypto';
import { fail, validDate, today } from './store.mjs';
export const assetKinds = { cash: 'Наличные', bank: 'Деньги на счетах', investment: 'Инвестиции', property: 'Имущество', other: 'Другие активы', liability: 'Долги и обязательства' };
export function createAssets(store) {
  store.db.exec('CREATE TABLE IF NOT EXISTS personal_assets(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS personal_asset_history(id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(id,version));');
  const all = () => store.db.prepare('SELECT * FROM personal_assets ORDER BY rowid').all().map(row => ({ ...JSON.parse(row.data), version: row.version }));
  const report = () => {
    const rows = all(), currencies = new Map();
    for (const row of rows) {
      const item = currencies.get(row.currency) || { currency: row.currency, assetsMinor: 0n, liabilitiesMinor: 0n, count: 0, oldestDate: row.asOf, newestDate: row.asOf };
      item[row.kind === 'liability' ? 'liabilitiesMinor' : 'assetsMinor'] += BigInt(row.amountMinor); item.count++;
      if (row.asOf < item.oldestDate) item.oldestDate = row.asOf; if (row.asOf > item.newestDate) item.newestDate = row.asOf;
      currencies.set(row.currency, item);
    }
    return { rows, kinds: assetKinds, totals: [...currencies.values()].map(item => ({ ...item, assetsMinor: String(item.assetsMinor), liabilitiesMinor: String(item.liabilitiesMinor), netMinor: String(item.assetsMinor - item.liabilitiesMinor) })) };
  };
  const save = input => store.transaction(() => {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || !assetKinds[input.kind] || !/^[A-Z]{3}$/.test(input.currency || '') || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0 || input.amountMinor > 100000000000000 || typeof (input.note || '') !== 'string' || (input.note || '').length > 1000) fail('Проверь название, тип, валюту и текущую оценку актива.');
    validDate(input.asOf); if (input.asOf > today()) fail('Дата оценки не может быть в будущем.');
    const id = input.id || randomUUID(); if (!/^[a-f0-9-]{36}$/i.test(id)) fail('Некорректный актив.');
    const current = store.db.prepare('SELECT * FROM personal_assets WHERE id=?').get(id);
    if (input.id && !current) fail('Актив не найден.', 404);
    if (input.expectedVersion !== (current?.version || 0)) fail('Оценка актива изменилась в другой вкладке. Перечитай её.', 409);
    const version = (current?.version || 0) + 1, row = { id, name: input.name.trim(), kind: input.kind, currency: input.currency, amountMinor: input.amountMinor, asOf: input.asOf, note: input.note || '' }, json = JSON.stringify(row);
    store.db.prepare('INSERT INTO personal_assets VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version').run(id, json, version);
    store.db.prepare('INSERT INTO personal_asset_history VALUES(?,?,?,?)').run(id, version, json, new Date().toISOString());
    return { ...row, version };
  });
  return { report, save, backup: () => ({ assets: all(), history: store.db.prepare('SELECT * FROM personal_asset_history').all() }) };
}
