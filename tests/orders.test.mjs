import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, normaliseEvent, hash } from '../web/store.mjs';
import { createOrders, normaliseOrder, candidatePayments } from '../web/orders.mjs';
import { createFinanceServer } from '../web/server.mjs';
const order = overrides => ({ identity: 'TEST TRIP A', title: 'TEST TAXI', date: '2026-01-10', dateCertainty: 'exact', amountMinor: 2900000, currency: 'UZS', cardSuffix: '8084', rawText: 'TEST ORDER SOURCE', ...overrides });
const packet = overrides => ({ schema: 'rhythm-service-orders-v1', service: 'yandex_go', account: 'test-owner', capturedAt: '2026-01-11T10:00:00Z', coverageNote: 'TEST: one saved screen, incomplete history.', orders: [order()], ...overrides });
const bank = overrides => normaliseEvent({ id: randomUUID(), fingerprint: randomUUID(), source_type: 'sms', source_name: 'TEST BANK', source_ref: 'TEST BANK', received_at: '2026-01-10T10:00:00Z', event_millis: 1, raw_title: '', raw_text: 'TEST BANK ORIGINAL', raw_fragment: 'TEST BANK ORIGINAL', state: 'recorded', kind: 'expense', date: '2026-01-10', amount_minor: 2900000, currency: 'UZS', merchant: 'TEST YANDEX', card_suffix: '8084', ...overrides });

test('Импорт и повтор заказов не меняют банковские строки, расходы и исходники', () => {
  const store = createStore(':memory:'); try {
    store.save(bank(), 'test'); const before = JSON.stringify(store.all()), orders = createOrders(store), data = packet(), digest = hash(JSON.stringify(data));
    assert.equal(orders.commit(data, digest).inserted, 1); assert.equal(orders.commit(data, digest).repeated, true); assert.equal(orders.all().length, 1); assert.equal(orders.detail(orders.all()[0].id).candidates.length, 1); assert.equal(orders.links, undefined);
    assert.equal(orders.all()[0].links.length, 0); assert.equal(JSON.stringify(store.all()), before);
    const update = packet({ orders: [order({ status: 'TEST UPDATED' })] }); orders.commit(update, hash(JSON.stringify(update)));
    const detail = orders.detail(orders.all()[0].id); assert.equal(detail.observations.length, 2); assert.equal(detail.observations.find(item => item.order.status === '').order.rawText, 'TEST ORDER SOURCE'); assert.equal(detail.row.version, 2); assert.equal(JSON.stringify(store.all()), before);
  } finally { store.close(); }
});
test('Совпадение суммы недостаточно: карта, валюта, дата, направление, наличные и год проверяются', () => {
  const normalized = normaliseOrder(order(), 'yandex_go', 'test-owner'), event = bank();
  assert.equal(candidatePayments(normalized, [event]).length, 1);
  for (const changed of [{ card_suffix: '9999' }, { currency: 'USD' }, { date: '2026-01-14' }, { state: 'duplicate' }, { kind: 'income' }, { merchant: 'OTHER STORE' }]) assert.equal(candidatePayments(normalized, [{ ...event, ...changed }]).length, 0);
  assert.equal(candidatePayments({ ...normalized, dateCertainty: 'inferred_year' }, [event]).length, 0); assert.equal(candidatePayments({ ...normalized, paymentMethod: 'Наличные' }, [event]).length, 0);
  assert.equal(candidatePayments({ ...normalized, details: { cancelled: true } }, [event]).length, 0);
  assert.equal(candidatePayments({ ...normalized, status: 'Отмена указана в истории' }, [event]).length, 0);
});
test('Связь подтверждается отдельно, проверяет версии, допускает отмену и сохраняет историю', () => {
  const store = createStore(':memory:'); try {
    const event = store.save(bank(), 'test'), orders = createOrders(store), data = packet(); orders.commit(data, hash(JSON.stringify(data))); const row = orders.all()[0];
    const input = { eventId: event.id, relation: 'payment', active: true, expectedOrderVersion: 1, expectedEventVersion: 1 };
    assert.equal(orders.link(row.id, input).links.length, 1); assert.equal(orders.forEvent(event.id).length, 1);
    store.edit(event.id, { expectedVersion: 1, event: { purpose: 'TEST PURPOSE' } }); assert.equal(orders.detail(row.id).links[0].needsReview, true); assert.throws(() => orders.link(row.id, input), error => error.status === 409);
    assert.equal(orders.link(row.id, { ...input, expectedEventVersion: 2, active: false }).links.length, 0); assert.equal(orders.backup().linkHistory.length, 2); assert.equal(store.get(event.id).raw_text, 'TEST BANK ORIGINAL');
  } finally { store.close(); }
});
test('Некорректный пакет не оставляет частичный импорт', () => {
  const store = createStore(':memory:'); try {
    const orders = createOrders(store), data = packet({ orders: [order(), order({ identity: 'B', amountMinor: -1 })] });
    assert.throws(() => orders.commit(data, hash(JSON.stringify(data))), /Некорректная сумма/); assert.equal(orders.all().length, 0); assert.equal(orders.batches().length, 0);
    assert.throws(() => orders.preview(packet({ orders: [order(), order()] })), /повторились/);
    assert.throws(() => orders.preview(packet({ artifacts: [{ file: '../../auth.json' }] })), /целостность/);
  } finally { store.close(); }
});
test('График, детали и оригиналы требуют сессию; выдаются только архивные файлы с проверенным хешем', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rhythm-orders-test-')), app = createFinanceServer({ directory, allowLocalLogin: false, port: 0 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + app.server.address().port, secret = 'a'.repeat(43), headers = { cookie: 'rhythm_session=' + secret };
  try {
    app.store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(secret), null, Date.now() + 60000); app.store.save(bank(), 'test');
    for (const route of ['/api/cashflow', '/api/orders', '/api/order-files/00000000-0000-0000-0000-000000000000/0']) assert.equal((await fetch(base + route)).status, 401);
    const bytes = Buffer.from('%PDF-TEST'), digest = hash(bytes), data = packet({ artifacts: [{ name: 'TEST receipt', file: digest + '.pdf', sha256: digest, bytes: bytes.length }] }), batch = app.orders.commit(data, hash(JSON.stringify(data))), folder = path.join(directory, 'order-files', batch.id); mkdirSync(folder, { recursive: true }); writeFileSync(path.join(folder, digest + '.pdf'), bytes);
    const source = '/api/order-files/' + batch.id + '/0'; assert.equal((await fetch(base + source, { headers })).status, 200); assert.equal((await fetch(base + '/api/cashflow', { headers })).status, 200); assert.equal((await (await fetch(base + '/api/orders', { headers })).json()).rows.length, 1);
    writeFileSync(path.join(folder, digest + '.pdf'), 'CHANGED'); assert.equal((await fetch(base + source, { headers })).status, 409); assert.equal((await fetch(base + '/api/order-files/' + batch.id + '/99', { headers })).status, 404);
    assert.equal((await (await fetch(base + '/api/backup', { headers })).json()).serviceOrders.orders.length, 1);
    const deviceId = 'd'.repeat(43); app.store.db.prepare('INSERT INTO devices(id,label,token_hash,created_at) VALUES(?,?,?,?)').run(deviceId, 'TEST DEVICE', hash('c'.repeat(43)), new Date().toISOString());
    for (const [tab, expected] of [['dashboard', 'dashboard'], ['table', 'table'], ['orders', 'orders'], ['https://other.example', 'table']]) {
      const ticket = 'b'.repeat(43); app.store.db.prepare('INSERT INTO tickets VALUES(?,?,?)').run(hash(ticket), deviceId, Date.now() + 60000);
      const login = await fetch(base + '/mobile-login?ticket=' + ticket + '&tab=' + encodeURIComponent(tab), { redirect: 'manual' }); assert.equal(login.headers.get('location'), '/?tab=' + expected);
    }
  } finally { await app.close(); if (directory.startsWith(path.join(tmpdir(), 'rhythm-orders-test-'))) rmSync(directory, { recursive: true, force: true }); }
});
