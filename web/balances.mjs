import { randomUUID } from 'node:crypto';
import { fail, validDate, today } from './store.mjs';
const day = 86400000;
export const accountId = (card, currency) => `card:${card}:${currency}`;
function eventTime(row) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) return null;
  try { validDate(row.date); } catch { return null; }
  const time = /^\d{2}:\d{2}(?::\d{2})?$/.test(row.time || '') ? row.time : '23:59:59';
  const result = Date.parse(`${row.date}T${time}+05:00`);
  return Number.isFinite(result) ? result : null;
}
export function balanceReport(rows, settings = [], now = Date.now()) {
  const accounts = new Map();
  for (const row of rows) {
    if (!/^\d{4}$/.test(row.card_suffix || '') || !/^[A-Z]{3}$/.test(row.currency || '') || row.state === 'ignored') continue;
    const at = eventTime(row); if (at === null || at > now) continue;
    const id = accountId(row.card_suffix, row.currency);
    const account = accounts.get(id) || { id, type: 'card', cardSuffix: row.card_suffix, currency: row.currency, name: `Карта •${row.card_suffix}`, version: 0, lastActivity: 0, observation: null };
    account.lastActivity = Math.max(at, account.lastActivity);
    if (Number.isSafeInteger(row.balance_minor) && row.balance_minor >= 0) {
      // Imported copies of one message are observations of one account, never extra money.
      const value = { at, amountMinor: String(row.balance_minor), date: row.date, source: row.source_name, eventId: row.id, conflict: false };
      if (!account.observation || at > account.observation.at) account.observation = value;
      else if (at === account.observation.at && value.amountMinor !== account.observation.amountMinor) account.observation.conflict = true;
    }
    accounts.set(id, account);
  }
  for (const setting of settings) {
    const account = accounts.get(setting.id) || { id: setting.id, type: setting.type, cardSuffix: setting.cardSuffix, currency: setting.currency, version: 0, lastActivity: 0, observation: null };
    Object.assign(account, { name: setting.name, included: setting.included, version: setting.version });
    if (setting.manual && (!account.observation || setting.manual.at >= account.observation.at)) account.observation = { ...setting.manual, source: 'Вручную', conflict: false };
    if (setting.manual) account.lastActivity = Math.max(account.lastActivity, setting.manual.at);
    accounts.set(setting.id, account);
  }
  const totals = new Map();
  const result = [...accounts.values()].map(account => {
    const value = account.observation;
    const included = account.included ?? (account.lastActivity >= now - 30 * day);
    const amountMinor = value && !value.conflict ? value.amountMinor : null;
    const stale = !!value && now - value.at > 7 * day;
    const incomplete = amountMinor === null || stale || account.lastActivity > (value?.at || 0);
    if (included) {
      const total = totals.get(account.currency) || { currency: account.currency, amount: 0n, knownCount: 0, accountCount: 0, incomplete: false, oldestDate: null };
      total.accountCount++; total.incomplete ||= incomplete;
      if (amountMinor !== null) { total.amount += BigInt(amountMinor); total.knownCount++; if (!total.oldestDate || value.date < total.oldestDate) total.oldestDate = value.date; }
      totals.set(account.currency, total);
    }
    return { id: account.id, type: account.type, cardSuffix: account.cardSuffix || '', currency: account.currency, name: account.name, version: account.version, included, amountMinor, asOf: value?.date || null, updatedAt: value?.at || null, source: value?.source || '', conflict: !!value?.conflict, stale, incomplete };
  }).sort((a, b) => Number(b.included) - Number(a.included) || (b.updatedAt || 0) - (a.updatedAt || 0) || a.id.localeCompare(b.id));
  return { accounts: result, totals: [...totals.values()].map(({ amount, ...total }) => ({ ...total, amountMinor: total.knownCount ? String(amount) : null })) };
}
export function createBalances(store) {
  store.db.exec('CREATE TABLE IF NOT EXISTS balance_accounts(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS balance_account_history(id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(id,version));');
  const all = () => store.db.prepare('SELECT * FROM balance_accounts ORDER BY rowid').all().map(row => ({ ...JSON.parse(row.data), version: row.version }));
  const report = () => balanceReport(store.all(false), all());
  const save = input => store.transaction(() => {
    if (!input || !['card', 'cash'].includes(input.type) || !/^[A-Z]{3}$/.test(input.currency || '') || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || typeof input.included !== 'boolean') fail('Проверь название, валюту и тип счёта.');
    if (input.type === 'card' && !/^\d{4}$/.test(input.cardSuffix || '')) fail('Укажи последние четыре цифры карты.');
    const id = input.type === 'card' ? accountId(input.cardSuffix, input.currency) : input.id || 'cash:' + randomUUID();
    if (input.id && input.id !== id || input.type === 'cash' && !/^cash:[a-f0-9-]{36}$/i.test(id)) fail('Некорректный счёт.');
    const current = store.db.prepare('SELECT * FROM balance_accounts WHERE id=?').get(id);
    if (input.expectedVersion !== (current?.version || 0)) fail('Счёт изменился в другой вкладке. Перечитай баланс.', 409);
    const previous = current ? JSON.parse(current.data) : {};
    if (current && (previous.type !== input.type || previous.currency !== input.currency)) fail('Тип и валюту существующего счёта менять нельзя.');
    let manual = previous.manual || null;
    if (input.amountMinor !== undefined) {
      if (!Number.isSafeInteger(input.amountMinor) || Math.abs(input.amountMinor) > 100000000000000 || input.type === 'cash' && input.amountMinor < 0) fail('Проверь остаток. Наличные не могут быть отрицательными.');
      validDate(input.asOf); if (input.asOf > today()) fail('Дата остатка не может быть в будущем.');
      manual = { amountMinor: String(input.amountMinor), date: input.asOf, at: input.asOf === today() ? Date.now() : Date.parse(input.asOf + 'T23:59:59+05:00') };
    }
    if (input.type === 'cash' && !manual) fail('Укажи остаток наличных.');
    const row = { id, name: input.name.trim(), type: input.type, cardSuffix: input.type === 'card' ? input.cardSuffix : '', currency: input.currency, included: input.included, manual };
    const version = (current?.version || 0) + 1, json = JSON.stringify(row);
    store.db.prepare('INSERT INTO balance_accounts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version').run(id, json, version);
    store.db.prepare('INSERT INTO balance_account_history VALUES(?,?,?,?)').run(id, version, json, new Date().toISOString());
    return { ...row, version };
  });
  return { report, save, backup: () => ({ accounts: all(), history: store.db.prepare('SELECT * FROM balance_account_history').all() }) };
}
