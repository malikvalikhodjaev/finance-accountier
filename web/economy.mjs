import { randomUUID } from 'node:crypto';
import { selectRows, fail } from './store.mjs';

import { economyRoles, validatePlan, calculatePlan } from './public/economy-math.mjs';
export { economyRoles, validatePlan, calculatePlan };
const empty = currency => ({ currency, earned: 0n, variable: 0n, work: 0n, living: 0n, investment: 0n, other: 0n, financing: 0n, unassignedExpense: 0n, unassignedIncome: 0n, pendingIncoming: 0n, pendingOutgoing: 0n, earnedCount: 0, variableCount: 0, workCount: 0, livingCount: 0, investmentCount: 0, unassignedCount: 0, pendingCount: 0, transferCount: 0 });
const serialize = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'bigint' ? String(item) : item]));
function finish(value) {
  const known = value.earnedCount > 0, throughput = value.earned - value.variable, operating = throughput - value.work, personal = operating - value.living;
  return serialize({ ...value, throughputMinor: known ? throughput : null, operatingMinor: known ? operating : null, personalMinor: known ? personal : null, availableMinor: known ? personal - value.investment : null, incomplete: !known || value.unassignedCount > 0 || value.pendingCount > 0 });
}
export function economyReport(rows, fields, filters = {}) {
  const totals = new Map(), months = new Map(), sources = new Map(), unassigned = [];
  let unreadableCount = 0;
  for (const row of selectRows(rows, filters)) {
    if (['duplicate', 'ignored'].includes(row.state)) continue;
    if (!row.currency || !row.date || !(row.amount_minor > 0)) { unreadableCount++; continue; }
    if (!totals.has(row.currency)) totals.set(row.currency, empty(row.currency));
    const total = totals.get(row.currency), month = row.date.slice(0, 7), monthKey = month + '|' + row.currency;
    if (!months.has(monthKey)) months.set(monthKey, { month, ...empty(row.currency) });
    const period = months.get(monthKey), amount = BigInt(row.amount_minor);
    if (row.kind === 'transfer' && row.state === 'recorded') { total.transferCount++; period.transferCount++; continue; }
    if (row.state !== 'recorded' || !['income', 'expense'].includes(row.kind)) {
      const key = row.flow === 'incoming' ? 'pendingIncoming' : row.flow === 'outgoing' ? 'pendingOutgoing' : null;
      for (const item of [total, period]) { item.pendingCount++; if (key) item[key] += amount; }
      continue;
    }
    const label = row.custom?.[fields.role], role = Object.keys(economyRoles).find(key => economyRoles[key] === label);
    if (!role) {
      const key = row.kind === 'income' ? 'unassignedIncome' : 'unassignedExpense';
      for (const item of [total, period]) { item[key] += amount; item.unassignedCount++; }
      unassigned.push({ id: row.id, version: row.version, date: row.date, merchant: row.merchant, amountMinor: row.amount_minor, currency: row.currency, kind: row.kind });
      continue;
    }
    if (role === 'exclude') continue;
    const sign = row.kind === 'income' ? 1n : -1n, delta = ['earned', 'other', 'financing'].includes(role) ? amount * sign : -amount * sign;
    for (const item of [total, period]) { item[role] += delta; if (['earned', 'variable', 'work', 'living', 'investment'].includes(role)) item[role + 'Count']++; }
    if (['earned', 'variable'].includes(role)) {
      const source = row.custom?.[fields.source] || 'Источник не указан', key = source + '|' + row.currency;
      if (!sources.has(key)) sources.set(key, { source, currency: row.currency, earned: 0n, variable: 0n });
      sources.get(key)[role] += delta;
    }
  }
  return { totals: [...totals.values()].map(finish), months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency)).map(finish), sources: [...sources.values()].map(value => serialize({ ...value, throughputMinor: value.earned - value.variable })), unassigned, roles: economyRoles, fields, unreadableCount };
}
export function createEconomy(store) {
  store.db.exec('CREATE TABLE IF NOT EXISTS economy_plans(currency TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS economy_plan_history(currency TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(currency,version)); CREATE TABLE IF NOT EXISTS economy_classification_history(event_id TEXT NOT NULL,version INTEGER NOT NULL,previous_json TEXT NOT NULL,next_json TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(event_id,version));');
  const definitions = [{ builtin: 'economy-role', name: 'Роль в экономике', type: 'select', options: Object.values(economyRoles) }, { builtin: 'economy-source', name: 'Источник заработка', type: 'text' }];
  const fields = {};
  for (const definition of definitions) {
    const existing = store.settings('field').find(field => field.builtin === definition.builtin);
    const field = existing || store.setting('field', { ...definition, id: 'f_' + randomUUID(), active: true });
    fields[definition.builtin === 'economy-role' ? 'role' : 'source'] = field.id;
  }
  const readPlan = currency => {
    if (!/^[A-Z]{3}$/.test(currency || '')) fail('Выбери валюту модели.');
    const row = store.db.prepare('SELECT * FROM economy_plans WHERE currency=?').get(currency);
    const input = row ? JSON.parse(row.data) : validatePlan({ currency });
    return { ...input, version: row?.version || 0, calculation: calculatePlan(input) };
  };
  const savePlan = input => store.transaction(() => {
    const plan = validatePlan(input), current = readPlan(plan.currency);
    if (input.expectedVersion !== current.version) fail('Модель изменилась в другой вкладке. Перечитай её перед сохранением.', 409);
    const version = current.version + 1, json = JSON.stringify(plan);
    store.db.prepare('INSERT INTO economy_plans VALUES(?,?,?) ON CONFLICT(currency) DO UPDATE SET data=excluded.data,version=excluded.version').run(plan.currency, json, version);
    store.db.prepare('INSERT INTO economy_plan_history VALUES(?,?,?,?)').run(plan.currency, version, json, new Date().toISOString());
    return readPlan(plan.currency);
  });
  const classify = input => store.transaction(() => {
    if (!economyRoles[input.role] || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > 5000 || new Set(input.rows.map(row => row.id)).size !== input.rows.length) fail('Выбери роль и до 5000 разных операций.');
    const roleField = store.settings('field').find(field => field.id === fields.role);
    if (!roleField?.active || !roleField.options.includes(economyRoles[input.role])) fail('Включи колонку роли и нужный вариант в её настройках.');
    const rows = input.rows.map(item => {
      const row = store.get(item.id);
      if (row.version !== item.expectedVersion) fail('Одна из операций изменилась. Перечитай список.', 409);
      if (row.state !== 'recorded' || !['income', 'expense'].includes(row.kind)) fail('Сначала уточни тип и подтверди операцию.');
      return row;
    });
    for (const row of rows) {
      const custom = { ...row.custom, [fields.role]: economyRoles[input.role] };
      const saved = store.save(row, 'economy:classification', true);
      store.db.prepare('INSERT INTO extras VALUES(?,?) ON CONFLICT(event_id) DO UPDATE SET data=excluded.data').run(row.id, JSON.stringify(custom));
      store.db.prepare('INSERT INTO economy_classification_history VALUES(?,?,?,?,?)').run(row.id, saved.version, JSON.stringify(row.custom), JSON.stringify(custom), new Date().toISOString());
    }
    return { changed: rows.length };
  });
  const audit = (before, after) => store.db.prepare('INSERT INTO economy_classification_history VALUES(?,?,?,?,?)').run(after.id, after.version, JSON.stringify(before.custom), JSON.stringify(after.custom), new Date().toISOString());
  return { fields, readPlan, savePlan, classify, audit, report: filters => economyReport(store.all(false), fields, filters), backup: () => ({ plans: store.db.prepare('SELECT * FROM economy_plans').all(), history: store.db.prepare('SELECT * FROM economy_plan_history').all(), classifications: store.db.prepare('SELECT * FROM economy_classification_history').all() }) };
}
