import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createStore } from '../web/store.mjs';
import { createEconomy, economyReport, economyRoles, calculatePlan } from '../web/economy.mjs';
import { createAssets } from '../web/assets.mjs';
import { createFinanceServer } from '../web/server.mjs';
const plan = changes => ({ currency: 'UZS', revenueMinor: 100000000, variableBps: 1000, workMinor: 20000000, livingMinor: 80000000, investmentMinor: 5000000, goalMinor: 10000000, ...changes });
const fields = { role: 'role', source: 'source' };
const sample = (role, changes = {}) => ({ id: randomUUID(), fingerprint: randomUUID(), source_type: 'sms', source_name: 'TEST', source_ref: 'test', received_at: '2026-10-01T05:00:00Z', event_millis: 1790830800000, raw_title: 'Original', raw_text: 'Original raw source', raw_fragment: 'Original fragment', amount_minor: 10000, currency: 'UZS', state: 'recorded', kind: 'expense', date: '2026-10-01', time: '10:00', merchant: 'Test', custom: role ? { role: economyRoles[role], source: 'Проект A' } : {}, ...changes });

test('Поступление с телефона сразу входит в заработок; повтор синхронизации не удваивает и не переписывает роль', () => {
  const store = createStore(':memory:');
  try {
    const economy = createEconomy(store), income = sample(null, { source_type: 'manual', source_ref: 'manual-earned-v1', kind: 'income', merchant: 'Проект A', category: 'Заработок' });
    const packet = { cursor: 0, changes: [{ event: income, baseVersion: 0, clientRevision: 1 }] };
    const first = store.sync(packet, 'phone-test', economy.acceptManualIncome);
    assert.equal(first.acknowledgements[0].version, 1);
    assert.equal(store.get(income.id).custom[economy.fields.role], economyRoles.earned);
    assert.equal(store.get(income.id).custom[economy.fields.source], 'Проект A');
    assert.equal(economy.report({ period: 'all' }).totals[0].earned, '10000');
    store.sync(packet, 'phone-test', economy.acceptManualIncome);
    assert.equal(store.all().length, 1); assert.equal(economy.backup().classifications.length, 1);
    store.edit(income.id, { expectedVersion: 1, custom: { [economy.fields.role]: economyRoles.other } }, 'web', economy.audit);
    store.sync(packet, 'phone-test', economy.acceptManualIncome);
    assert.equal(store.get(income.id).custom[economy.fields.role], economyRoles.other);
    assert.equal(economy.backup().classifications.length, 2);
    assert.equal(store.get(income.id).raw_text, income.raw_text);
    for (const overrides of [{ source_type: 'sms', source_ref: 'manual-earned-v1' }, { source_type: 'manual', source_ref: 'manual' }, { source_type: 'manual', source_ref: 'manual-earned-v1', kind: 'transfer' }, { source_type: 'manual', source_ref: 'manual-earned-v1', state: 'review' }]) {
      const row = sample(null, { kind: 'income', ...overrides });
      store.sync({ cursor: 0, changes: [{ event: row, baseVersion: 0, clientRevision: 1 }] }, 'phone-test', economy.acceptManualIncome);
      assert.deepEqual(store.get(row.id).custom, {});
    }
    const rejected = sample(null, { source_type: 'manual', source_ref: 'manual-earned-v1', kind: 'income' });
    assert.throws(() => store.sync({ cursor: 0, changes: [{ event: rejected, baseVersion: 0, clientRevision: 1 }] }, 'phone-test', row => { economy.acceptManualIncome(row); throw new Error('Storage interrupted'); }), /Storage interrupted/);
    assert.throws(() => store.get(rejected.id), /не найдена/);
    assert.equal(economy.backup().classifications.length, 2);
  } finally { store.close(); }
});

test('ТОС-модель отделяет рабочий результат, личные расходы, инвестиции и отрицательный остаток', () => {
  const result = calculatePlan(plan());
  assert.deepEqual(result, { complete: true, variableMinor: '10000000', throughputMinor: '90000000', operatingMinor: '70000000', personalMinor: '-10000000', availableMinor: '-15000000', goalGapMinor: '-25000000', requiredRevenueMinor: '127777778' });
  assert.equal(calculatePlan(plan({ revenueMinor: null })).complete, false);
  assert.equal(calculatePlan(plan({ variableBps: 10000 })).requiredRevenueMinor, null);
  assert.equal(calculatePlan(plan({ revenueMinor: 1, variableBps: 5000, workMinor: 0, livingMinor: 0, investmentMinor: 0, goalMinor: 0 })).variableMinor, '1');
  assert.throws(() => calculatePlan(plan({ variableBps: 10001 })), /Доля/);
  assert.throws(() => calculatePlan(plan({ revenueMinor: -1 })), /сумма/);
});

test('Факт исключает свои переводы, повторы и непроверенные поступления; возврат уменьшает прямые затраты', () => {
  const rows = [sample('earned', { kind: 'income', amount_minor: 100000 }), sample('variable', { amount_minor: 20000 }), sample('variable', { kind: 'income', amount_minor: 5000 }), sample('work', { amount_minor: 10000 }), sample('living', { amount_minor: 30000 }), sample('investment', { amount_minor: 7000 }), sample('financing', { kind: 'income', amount_minor: 900000 }), sample('earned', { kind: 'transfer', amount_minor: 800000 }), sample('earned', { kind: 'income', state: 'review', flow: 'incoming', amount_minor: 700000 }), sample('earned', { kind: 'income', state: 'duplicate', amount_minor: 600000 }), sample('earned', { kind: 'income', state: 'ignored', amount_minor: 500000 }), sample(null, { amount_minor: 40000 }), sample(null, { currency: 'USD', kind: 'income', amount_minor: 10000 }), sample(null, { amount_minor: null })];
  const snapshot = JSON.stringify(rows), result = economyReport(rows, fields, { period: 'all' }), total = result.totals.find(item => item.currency === 'UZS');
  assert.equal(total.earned, '100000'); assert.equal(total.variable, '15000'); assert.equal(total.throughputMinor, '85000'); assert.equal(total.operatingMinor, '75000'); assert.equal(total.personalMinor, '45000'); assert.equal(total.availableMinor, '38000');
  assert.equal(total.financing, '900000'); assert.equal(total.pendingIncoming, '700000'); assert.equal(total.transferCount, 1); assert.equal(total.unassignedExpense, '40000'); assert.equal(total.incomplete, true);
  assert.equal(result.totals.find(item => item.currency === 'USD').throughputMinor, null); assert.equal(result.unreadableCount, 1); assert.equal(result.sources[0].throughputMinor, '85000'); assert.equal(JSON.stringify(rows), snapshot);
});

test('Большие итоги точны, валюта и месяцы независимы, пустой заработок остаётся неизвестным', () => {
  const rows = Array.from({ length: 100 }, () => sample('earned', { kind: 'income', amount_minor: 100000000000000 }));
  rows.push(sample('earned', { kind: 'income', currency: 'USD', date: '2026-09-01', amount_minor: 123 }));
  const report = economyReport(rows, fields, { from: '2026-09-01', to: '2026-10-09' });
  assert.equal(report.totals.find(item => item.currency === 'UZS').earned, '10000000000000000'); assert.equal(report.months.length, 2); assert.equal(report.months[0].month, '2026-09');
  assert.equal(economyReport([sample('living')], fields, { period: 'all' }).totals[0].availableMinor, null);
});

test('Повторный запуск не создаёт колонки заново; массовая разметка атомарна и сохраняет исходные тексты', () => {
  const store = createStore(':memory:');
  try {
    const economy = createEconomy(store), second = createEconomy(store); assert.deepEqual(second.fields, economy.fields); assert.equal(store.settings('field').length, 2);
    const a = store.save(sample(null), 'test'), b = store.save(sample(null), 'test');
    assert.throws(() => economy.classify({ role: 'living', rows: [{ id: a.id, expectedVersion: 1 }, { id: b.id, expectedVersion: 0 }] }), /изменилась/);
    assert.equal(store.get(a.id).version, 1); assert.equal(store.get(a.id).custom[economy.fields.role], undefined);
    assert.equal(economy.classify({ role: 'living', rows: [{ id: a.id, expectedVersion: 1 }, { id: b.id, expectedVersion: 1 }] }).changed, 2);
    assert.equal(store.get(a.id).raw_text, 'Original raw source'); assert.equal(store.get(a.id).custom[economy.fields.role], economyRoles.living); assert.equal(economy.backup().classifications.length, 2);
    assert.equal(economy.report({ period: 'all' }).totals[0].living, '20000');
    store.edit(a.id, { expectedVersion: 2, custom: { [economy.fields.role]: economyRoles.work } }, 'web', economy.audit);
    const audit = economy.backup().classifications.at(-1);
    assert.equal(JSON.parse(audit.previous_json)[economy.fields.role], economyRoles.living);
    assert.equal(JSON.parse(audit.next_json)[economy.fields.role], economyRoles.work);
    assert.throws(() => store.edit(a.id, { expectedVersion: 2, custom: {} }, 'web', economy.audit), /изменилась/);
    assert.equal(economy.backup().classifications.length, 3);
    assert.throws(() => store.edit(a.id, { expectedVersion: 3, custom: { [economy.fields.role]: economyRoles.living } }, 'web', () => { throw new Error('Audit write failed'); }), /Audit write failed/);
    assert.equal(store.get(a.id).version, 3); assert.equal(store.get(a.id).custom[economy.fields.role], economyRoles.work);
  } finally { store.close(); }
});

test('Сохранение сценария проверяет версии и не создаёт операций', () => {
  const store = createStore(':memory:');
  try {
    const economy = createEconomy(store); assert.equal(economy.readPlan('UZS').version, 0); assert.equal(economy.readPlan('UZS').revenueMinor, null);
    const saved = economy.savePlan({ ...plan(), expectedVersion: 0 }); assert.equal(saved.version, 1); assert.equal(saved.calculation.availableMinor, '-15000000');
    assert.throws(() => economy.savePlan({ ...plan(), expectedVersion: 0 }), /изменилась/);
    economy.savePlan({ ...plan({ revenueMinor: 200000000 }), expectedVersion: 1 }); assert.equal(economy.backup().history.length, 2); assert.equal(store.all().length, 0);
  } finally { store.close(); }
});

test('Активы считаются по оценкам отдельно от долга и заработка; история оценок сохраняется', () => {
  const store = createStore(':memory:');
  try {
    const assets = createAssets(store); assert.equal(assets.report().totals.length, 0);
    const bank = assets.save({ name: 'Счёт', kind: 'bank', currency: 'UZS', amountMinor: 100000, asOf: '2026-10-01', expectedVersion: 0 });
    assets.save({ name: 'Долг', kind: 'liability', currency: 'UZS', amountMinor: 120000, asOf: '2026-10-02', expectedVersion: 0 });
    assets.save({ name: 'USD', kind: 'cash', currency: 'USD', amountMinor: 100, asOf: '2026-10-02', expectedVersion: 0 });
    assert.equal(assets.report().totals.find(item => item.currency === 'UZS').netMinor, '-20000');
    assert.throws(() => assets.save({ ...bank, amountMinor: 200000, expectedVersion: 0 }), /изменилась/);
    assets.save({ ...bank, amountMinor: 200000, expectedVersion: 1 }); assert.equal(assets.backup().history.length, 4); assert.equal(store.all().length, 0);
  } finally { store.close(); }
});

test('API экономики и активов требует вход, отдаёт историю в резервной копии и сохраняет конфликты версий', async () => {
  const base = path.resolve('build'); mkdirSync(base, { recursive: true }); const directory = mkdtempSync(path.join(base, 'economy-api-'));
  const app = createFinanceServer({ directory, allowLocalLogin: false }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const url = 'http://127.0.0.1:' + app.server.address().port;
  try {
    for (const route of ['/api/economy', '/api/economy/plan', '/api/assets']) assert.equal((await fetch(url + route)).status, 401);
    const password = readFileSync(path.join(directory, 'admin-password.txt'), 'utf8').trim(), login = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const headers = { 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie').split(';')[0] };
    assert.equal((await fetch(url + '/api/economy', { headers })).status, 200);
    assert.equal((await fetch(url + '/api/economy/plan', { method: 'POST', headers, body: JSON.stringify({ ...plan(), expectedVersion: 0 }) })).status, 200);
    assert.equal((await fetch(url + '/api/economy/plan', { method: 'POST', headers, body: JSON.stringify({ ...plan(), expectedVersion: 0 }) })).status, 409);
    assert.equal((await fetch(url + '/api/assets', { method: 'POST', headers, body: JSON.stringify({ name: 'Счёт', kind: 'bank', currency: 'UZS', amountMinor: 10000, asOf: '2026-10-01', expectedVersion: 0 }) })).status, 200);
    const backup = await (await fetch(url + '/api/backup', { headers })).json(); assert.equal(backup.economy.history.length, 1); assert.equal(backup.personalAssets.history.length, 1); assert.equal(backup.events.length, 0);
    const pairing = await (await fetch(url + '/api/pairing', { method: 'POST', headers, body: '{}' })).json();
    const device = await (await fetch(url + '/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: pairing.code, label: 'Income test phone' }) })).json();
    const income = sample(null, { source_type: 'manual', source_ref: 'manual-earned-v1', kind: 'income', merchant: 'Проект API', category: 'Заработок' });
    const packet = { cursor: 0, changes: [{ event: income, baseVersion: 0, clientRevision: 1 }] };
    const mobile = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + device.token }, body: JSON.stringify(packet) };
    assert.equal((await fetch(url + '/api/sync', mobile)).status, 200);
    assert.equal((await fetch(url + '/api/sync', mobile)).status, 200);
    const afterIncome = await (await fetch(url + '/api/backup', { headers })).json();
    assert.equal(afterIncome.events.length, 1); assert.equal(afterIncome.economy.classifications.length, 1);
    assert.equal(afterIncome.events[0].custom[afterIncome.fields.find(field => field.builtin === 'economy-role').id], economyRoles.earned);
    for (const asset of ['/economy-ui.mjs', '/economy-math.mjs', '/assets-ui.mjs']) assert.match((await fetch(url + asset)).headers.get('content-type'), /javascript/);
  } finally {
    await app.close(); const relative = path.relative(realpathSync(base), realpathSync(directory)); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unexpected test path'); rmSync(directory, { recursive: true });
  }
});
