import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { root } from '../workflow.mjs';
import { createStore, aggregate, normaliseEvent, today } from '../web/store.mjs';
import { createFinanceServer } from '../web/server.mjs';
const sample = overrides => normaliseEvent({ id: randomUUID(), fingerprint: randomUUID(), source_type: 'sms', source_name: 'TEST BANK', source_ref: 'TEST', received_at: new Date().toISOString(), event_millis: Date.now(), raw_title: 'TEST BANK', raw_text: 'Pokupka: TEST SHOP. summa:5000.00 UZS', raw_fragment: 'Pokupka: TEST SHOP. summa:5000.00 UZS', state: 'recorded', amount_minor: 500000, currency: 'UZS', kind: 'expense', date: today(), time: '10:00', merchant: 'TEST SHOP', category: 'Без категории', description: 'TEST SHOP', purpose: '', bank_operation: 'Pokupka', ...overrides });
const push = (store, row, baseVersion = 0, clientRevision = 1, cursor = 0) => store.sync({ cursor, changes: [{ event: row, baseVersion, clientRevision }] }, 'phone-test');

test('37000 операций: пакеты по 100, повтор без удвоения, лёгкие таблицы и точные итоги', () => {
  const store = createStore(':memory:');
  try {
    let cursor = 0, expected = 0n, first;
    for (let offset=0;offset<37000;offset+=100) {
      const changes = Array.from({ length:100 }, (_,i) => {
        const index=offset+i, row=sample({ amount_minor:100+index, kind:index%4===1 ? 'transfer' : 'expense', state:index%4===2 ? 'review' : index%4===3 ? 'duplicate' : 'recorded' });
        if (index%4===0) expected+=BigInt(row.amount_minor);
        return { event:row,clientRevision:1,baseVersion:0 };
      });
      if (!first) first=changes;
      const response=store.sync({cursor,changes},'phone-test');
      assert.equal(response.acknowledgements.length,100); assert.equal(response.changes.length,100); cursor=response.cursor;
    }
    store.sync({cursor,changes:first},'phone-test');
    assert.equal(store.db.prepare('SELECT COUNT(*) count FROM events').get().count,37000);
    const light=store.all(false); assert.equal(light.length,37000); assert.equal(light[0].raw_text,undefined);
    assert.equal(store.get(first[0].event.id).raw_text,first[0].event.raw_text);
    assert.equal(store.get(first[0].event.id).version,1);
    assert.equal(aggregate(light,{metric:'expense',group:''},{period:'all'})[0].amountMinor,expected.toString());
  } finally { store.close(); }
});

test('Повторный пакет и повтор ответа не удваивают операции; исходный текст неизменен', () => {
  const store = createStore(':memory:'); try {
    const row = sample(), initial = push(store, row); assert.equal(initial.acknowledgements[0].version, 1);
    push(store, row); assert.equal(store.all().length, 1); assert.equal(store.get(row.id).version, 1);
    assert.throws(() => push(store, { ...row, raw_text: 'replaced' }, 1, 2), /Исходное поле/); assert.equal(store.get(row.id).raw_text, row.raw_text);
  } finally { store.close(); }
});
test('Несовпадающие поля с ПК и телефона объединяются; одинаковое поле создаёт конфликт', () => {
  const store = createStore(':memory:'); try {
    const row = sample(); push(store, row); store.edit(row.id, { expectedVersion: 1, event: { category: 'Продукты' } });
    const merged = push(store, { ...row, purpose: 'покупки для дома' }, 1, 2);
    assert.equal(merged.conflicts.length, 0); assert.equal(store.get(row.id).category, 'Продукты'); assert.equal(store.get(row.id).purpose, 'покупки для дома');
    const conflict = push(store, { ...row, purpose: 'кофе', description: 'новая заметка' }, 1, 3);
    assert.deepEqual(conflict.conflicts[0].fields, ['purpose']); assert.equal(store.get(row.id).purpose, 'покупки для дома'); assert.equal(store.get(row.id).description, 'новая заметка'); assert.equal(store.get(row.id).raw_text, row.raw_text);
    assert.throws(() => store.edit(row.id, { expectedVersion: 1, event: { category: 'Старая форма' } }), error => error.status === 409);
  } finally { store.close(); }
});
test('Итоги точны, валюты разделены; переводы, повторы и уточнения не становятся расходами', () => {
  const rows = [sample({ amount_minor: 12345 }), sample({ amount_minor: 100, currency: 'USD' }), sample({ kind: 'transfer', amount_minor: 90000 }), sample({ state: 'review', amount_minor: 80000 }), sample({ state: 'duplicate', amount_minor: 60000 })];
  const result = aggregate(rows, { metric: 'expense', group: 'category' }, { period: 'all' });
  assert.equal(result.find(row => row.currency === 'UZS').amountMinor, '12345'); assert.equal(result.find(row => row.currency === 'USD').amountMinor, '100');
  const large = aggregate([sample({ amount_minor: 100000000000000 }), sample({ amount_minor: 100000000000000 })], { metric: 'expense', group: '' }, { period: 'all' }); assert.equal(large[0].amountMinor, '200000000000000');
});
test('Свои колонки и представления сохраняются; тип и устаревшая запись защищены', () => {
  const store = createStore(':memory:'); try {
    const field = store.setting('field', { name: 'Проект', type: 'select', options: ['Дом', 'Работа'] }); assert.ok(field.id.startsWith('f_'));
    const row = sample(); push(store, row); store.edit(row.id, { expectedVersion: 1, event: {}, custom: { [field.id]: 'Дом' } });
    assert.equal(store.get(row.id).custom[field.id], 'Дом'); assert.throws(() => store.edit(row.id, { expectedVersion: 2, custom: { [field.id]: 'несуществующий' } }));
    store.setting('view', { name: 'Дом', filters: { customField: field.id, customValue: 'Дом' }, columns: [field.id, 'amount_minor'] }); assert.equal(store.settings('view').length, 2);
    assert.throws(() => store.setting('field', { ...field, expectedVersion: field.version, type: 'number' }));
  } finally { store.close(); }
});
test('HTTP: данные закрыты, код одноразовый, токен отзывается, сторонний сайт не пишет', async () => {
  const build = path.join(root, 'build'); mkdirSync(build, { recursive: true }); const directory = mkdtempSync(path.join(build, 'web-test-'));
  const app = createFinanceServer({ directory, allowLocalLogin: false, port: 8788 }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const url = 'http://127.0.0.1:' + app.server.address().port;
  try {
    assert.equal((await fetch(url + '/api/events')).status, 401);
    const password = readFileSync(path.join(directory, 'admin-password.txt'), 'utf8').trim();
    const login = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0]; const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    assert.equal((await fetch(url + '/api/pairing', { method: 'POST', headers: { ...headers, Origin: 'https://other.example' }, body: '{}' })).status, 403);
    const code = (await (await fetch(url + '/api/pairing', { method: 'POST', headers, body: '{}' })).json()).code;
    const pairRequest = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, label: 'Test Android' }) };
    const paired = await fetch(url + '/api/pair', pairRequest); assert.equal(paired.status, 201); const device = await paired.json(); assert.ok(device.serverId);
    assert.equal((await fetch(url + '/api/pair', pairRequest)).status, 401);
    const row = sample(); const synced = await fetch(url + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + device.token }, body: JSON.stringify({ cursor: 0, changes: [{ event: row, clientRevision: 1, baseVersion: 0 }] }) }); assert.equal(synced.status, 200);
    const mobileHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + device.token };
    const ticket = await (await fetch(url + '/api/mobile/browser-session', { method: 'POST', headers: mobileHeaders, body: '{}' })).json();
    const mobileLogin = await fetch(url + ticket.path, { redirect: 'manual' }); assert.equal(mobileLogin.status, 303);
    const browserCookie = mobileLogin.headers.get('set-cookie').split(';')[0]; assert.equal((await fetch(url + '/api/events', { headers: { Cookie: browserCookie } })).status, 200);
    assert.equal((await fetch(url + ticket.path, { redirect: 'manual' })).status, 401);
    await fetch(url + '/api/events/' + row.id, { method: 'PATCH', headers, body: JSON.stringify({ expectedVersion: 1, event: { purpose: 'дом' } }) });
    const conflicted = await (await fetch(url + '/api/sync', { method: 'POST', headers: mobileHeaders, body: JSON.stringify({ cursor: 0, changes: [{ event: { ...row, purpose: 'кофе' }, clientRevision: 2, baseVersion: 1 }] }) })).json(); assert.equal(conflicted.conflicts.length, 1);
    const conflict = (await (await fetch(url + '/api/conflicts', { headers })).json()).conflicts[0];
    const resolution = await fetch(url + '/api/conflicts/resolve', { method: 'POST', headers, body: JSON.stringify({ id: conflict.id, choice: 'server', expectedVersion: conflict.current.version }) }); assert.equal(resolution.status, 200);
    const resolved = await (await fetch(url + '/api/sync', { method: 'POST', headers: mobileHeaders, body: JSON.stringify({ cursor: 0, changes: [] }) })).json(); assert.equal(resolved.resolutions[0].event.purpose, 'дом');
    const confirmed = await (await fetch(url + '/api/sync', { method: 'POST', headers: mobileHeaders, body: JSON.stringify({ cursor: 0, changes: [], resolvedIds: [conflict.id] }) })).json(); assert.equal(confirmed.resolutions.length, 0);
    assert.equal((await (await fetch(url + '/api/events', { headers })).json()).total, 1);
    assert.equal((await fetch(url + '/api/events', { headers: { Authorization: 'Bearer ' + device.token } })).status, 403);
    assert.equal((await fetch(url + '/api/device/revoke', { method: 'POST', headers, body: JSON.stringify({ id: device.deviceId }) })).status, 200);
    assert.equal((await fetch(url + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + device.token }, body: JSON.stringify({ cursor: 0, changes: [] }) })).status, 401);
  } finally {
    await app.close(); const relative = path.relative(realpathSync(build), realpathSync(directory)); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unexpected test directory'); rmSync(directory, { recursive: true });
  }
});
