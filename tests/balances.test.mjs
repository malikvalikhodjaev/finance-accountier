import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createFinanceServer } from '../web/server.mjs';
import { balanceReport, createBalances, accountId } from '../web/balances.mjs';
import { createStore, today } from '../web/store.mjs';
const now = Date.parse('2026-10-10T10:00:00+05:00');
const sample = (changes = {}) => ({ id: randomUUID(), fingerprint: randomUUID(), source_type: 'sms', source_name: 'TEST BANK', source_ref: 'TEST', received_at: '2026-10-10T05:00:00Z', event_millis: now, raw_title: 'Original', raw_text: 'Original raw', raw_fragment: 'Original raw', card_suffix: '8084', amount_minor: 100, balance_minor: 50000, currency: 'UZS', date: '2026-10-09', time: '10:00', state: 'review', kind: 'unknown', ...changes });

test('Баланс — последний остаток по дате операции, без суммирования SMS и push одной карты', () => {
  const rows = [sample(), sample({ date: '2026-10-08', balance_minor: 90000, received_at: '2026-10-11T00:00:00Z' }), sample({ source_type: 'push', source_name: 'Uzum', balance_minor: 50000 })], original = JSON.stringify(rows);
  const result = balanceReport(rows, [], now);
  assert.equal(result.accounts.length, 1); assert.equal(result.totals[0].amountMinor, '50000'); assert.equal(result.accounts[0].asOf, '2026-10-09');
  assert.equal(JSON.stringify(rows), original);
  assert.equal(balanceReport([sample({ balance_minor: 0 })], [], now).totals[0].amountMinor, '0');
});

test('Неизвестный, старый и конфликтующий остаток видны; старые карты изначально не включены', () => {
  const result = balanceReport([sample(), sample({ card_suffix: '2670', date: '2024-01-01' }), sample({ card_suffix: '6351', balance_minor: null }), sample({ balance_minor: 80000 })], [], now);
  assert.equal(result.accounts.find(a => a.cardSuffix === '2670').included, false);
  assert.equal(result.accounts.find(a => a.cardSuffix === '8084').conflict, true);
  assert.equal(result.totals[0].amountMinor, null); assert.equal(result.totals[0].accountCount, 2); assert.equal(result.totals[0].incomplete, true);
  const later = balanceReport([sample(), sample({ time: '11:00', balance_minor: null })], [], now);
  assert.equal(later.accounts[0].incomplete, true);
  const included = balanceReport([sample({ date: '2024-01-01' })], [{ id: accountId('8084', 'UZS'), name: 'Старая', included: true, version: 1 }], now);
  assert.equal(included.totals[0].amountMinor, '50000'); assert.equal(included.totals[0].incomplete, true);
});

test('Валюты независимы, большие суммы точны, будущие и исключённые записи не задают остаток', () => {
  const rows = Array.from({ length: 100 }, (_, i) => sample({ card_suffix: String(i).padStart(4, '0'), balance_minor: 100000000000000 }));
  rows.push(sample({ currency: 'USD', balance_minor: 123 }), sample({ date: '2027-01-01', balance_minor: 1 }), sample({ state: 'ignored', time: '23:00', balance_minor: 1 }));
  const result = balanceReport(rows, [], now);
  assert.equal(result.totals.find(a => a.currency === 'UZS').amountMinor, '10000000000000000'); assert.equal(result.totals.find(a => a.currency === 'USD').amountMinor, '123');
});

test('Ручной снимок не переписывает историю; новое уведомление обновляет его, старый импорт — нет', () => {
  const setting = { id: accountId('8084', 'UZS'), name: 'Visa', included: true, version: 1, manual: { amountMinor: '70000', date: '2026-10-09', at: Date.parse('2026-10-09T15:00:00+05:00') } };
  const before = JSON.stringify(setting);
  assert.equal(balanceReport([sample()], [setting], now).accounts[0].amountMinor, '70000');
  assert.equal(balanceReport([sample({ time: '16:00', balance_minor: 60000 })], [setting], now).accounts[0].amountMinor, '60000');
  assert.equal(JSON.stringify(setting), before);
});

test('Изменение остатка хранит версии и не создаёт доходы, расходы или изменения исходных данных', () => {
  const store = createStore(':memory:');
  try {
    store.save(sample({ date: today() }), 'test'); const before = JSON.stringify(store.all()); const balances = createBalances(store);
    const input = { type: 'card', name: 'Моя Visa', cardSuffix: '8084', currency: 'UZS', included: true, expectedVersion: 0, amountMinor: 0, asOf: today() };
    const first = balances.save(input); assert.equal(first.version, 1); assert.equal(balances.report().accounts[0].amountMinor, '0');
    assert.throws(() => balances.save(input), error => error.status === 409);
    const second = balances.save({ ...input, id: first.id, expectedVersion: 1, amountMinor: undefined, included: false }); assert.equal(second.manual.amountMinor, '0');
    balances.save({ type: 'cash', name: 'Наличные', currency: 'USD', included: true, expectedVersion: 0, amountMinor: 12345, asOf: today() });
    assert.equal(balances.backup().accounts.length, 2); assert.equal(balances.backup().history.length, 3); assert.equal(JSON.stringify(store.all()), before);
    assert.throws(() => balances.save({ type: 'cash', name: 'Cash', currency: 'UZS', included: true, expectedVersion: 0, amountMinor: -1, asOf: today() }), /отрицательными/);
    assert.throws(() => balances.save({ ...input, cardSuffix: '6351', asOf: '2099-01-01' }), /будущем/);
    assert.equal(balances.backup().history.length, 3);
  } finally { store.close(); }
});

test('API балансов закрыто без входа, резервная копия содержит версии, операции не создаются', async () => {
  const base = path.resolve('build'); mkdirSync(base, { recursive: true }); const directory = mkdtempSync(path.join(base, 'balances-api-'));
  const app = createFinanceServer({ directory, allowLocalLogin: false }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const url = 'http://127.0.0.1:' + app.server.address().port;
  try {
    assert.equal((await fetch(url + '/api/balances')).status, 401);
    const password = readFileSync(path.join(directory, 'admin-password.txt'), 'utf8').trim();
    const login = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const headers = { 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie').split(';')[0] };
    const input = { type: 'cash', name: 'Cash', currency: 'UZS', included: true, amountMinor: 0, asOf: today(), expectedVersion: 0 };
    const response = await fetch(url + '/api/balances', { method: 'POST', headers, body: JSON.stringify(input) }); assert.equal(response.status, 200);
    const account = await response.json();
    assert.equal((await fetch(url + '/api/balances', { method: 'POST', headers, body: JSON.stringify({ ...input, id: account.id }) })).status, 409);
    const report = await (await fetch(url + '/api/balances', { headers })).json(); assert.equal(report.totals[0].amountMinor, '0');
    const backup = await (await fetch(url + '/api/backup', { headers })).json(); assert.equal(backup.balances.history.length, 1); assert.equal(backup.events.length, 0);
    assert.match((await fetch(url + '/balances-ui.mjs')).headers.get('content-type'), /javascript/);
  } finally {
    await app.close(); const relative = path.relative(realpathSync(base), realpathSync(directory)); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unexpected test path'); rmSync(directory, { recursive: true });
  }
});
