import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createStore, aggregate, hash } from '../web/store.mjs';
import { createImporter, statementEvents } from '../web/imports.mjs';
import { createFinanceServer } from '../web/server.mjs';
import { root } from '../workflow.mjs';

const row = (number, details, amount = 1234500) => ({ documentDate: '2024-01-22', documentNumber: String(number), postingDate: '2024-01-22', postingTime: '12:00:00', amountMinor: amount, details, authorizationDate: '2024-01-21', authorizationTime: '11:00:00', fragments: [{ page: 1, cells: ['22.01.2024\n12:00:00', '22.01.2024', String(number), '12 345,00', details] }] });
const parsed = rows => ({ source: 'uzum-account-pdf-v1', account: '22618000000000001234', currency: 'UZS', period: { from: '2024-01-01', to: '2024-01-31' }, pages: 1, rows });
const purchase = row(1, 'Оплата с карты Visa UB 123456******1234 по MID 123ABC в TID TEST001 в YANDEXGO по Host2Host');
const upload = () => ({ filename: 'statement.pdf', data: Buffer.from('%PDF-synthetic-test').toString('base64') });
const directory = () => mkdtempSync(path.join(root, 'output/import-test-'));

test('Выписка: покупки и кешбэк учтены; свои переводы, P2P и возвраты требуют проверки', () => {
  const source = parsed([purchase, row(2, 'Зачисление Кешбека на карту VISA UB 123456******1234'), row(3, 'Закрытие/Списание со вклада на ПК VISA UB 123456******1234'), row(4, 'P2P c ПК VISA UZUM 123456******1234'), row(5, 'Зачисление возврата средств на карту Visa UB 123456******1234')]);
  const events = statementEvents(source, '2024-02-01T00:00:00Z', 'statement.pdf');
  assert.deepEqual(events.map(row => [row.event.kind, row.event.state]), [['expense', 'recorded'], ['income', 'recorded'], ['transfer', 'review'], ['unknown', 'review'], ['unknown', 'review']]);
  assert.equal(events[0].event.merchant, 'Яндекс Go');
  assert.equal(events[0].event.date, '2024-01-22');
  assert.equal(events[0].event.card_suffix, '1234');
  assert.equal(events[0].event.raw_text, JSON.stringify(purchase.fragments));
  assert.equal(events[0].event.fingerprint, statementEvents(source, '2025-02-01T00:00:00Z', 'new-name.pdf')[0].event.fingerprint);
  assert.throws(() => statementEvents(parsed([purchase, purchase]), '2024-02-01T00:00:00Z', 'file.pdf'), /Повтор/);
});

test('Предпросмотр не меняет операции; повтор файла и пересечение периодов не удваивают данные и не стирают правки', async () => {
  const store = createStore(':memory:'), dir = directory(); let current = parsed([purchase]);
  const importer = createImporter(store, dir, { parser: async () => current });
  try {
    const first = await importer.upload(upload()); assert.equal(store.all().length, 0); assert.equal(first.summary.recorded, 1);
    assert.equal(hash(readFileSync(path.join(dir, 'imports', first.id, 'source.pdf'))), first.sha256);
    assert.equal(importer.commit(first.id).inserted, 1);
    const event = store.all()[0]; store.edit(event.id, { expectedVersion: 1, event: { category: 'Моя категория' } });
    assert.equal(importer.commit(first.id).inserted, 0);
    current = parsed([purchase, row(2, 'Оплата по карте МПС UZS 123456******1234 по MID 123ABC')]);
    const second = await importer.upload(upload()); assert.equal(second.summary.existing, 1); assert.equal(second.summary.recorded, 1);
    assert.deepEqual(importer.commit(second.id), { id: second.id, inserted: 1, skipped: 1, repeated: false });
    assert.equal(store.all().length, 2); assert.equal(store.get(event.id).category, 'Моя категория'); assert.equal(store.get(event.id).version, 2);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM bank_import_rows').get().n, 3);
    const pulled = store.sync({ changes: [], cursor: 0 }, 'test-phone'); assert.equal(pulled.changes.length, 3); assert.equal(pulled.changes[0].event.source_type, 'bank_export');
  } finally { store.close(); }
});

test('Совпадение с SMS отмечено как возможный повтор и не увеличивает расходы', async () => {
  const store = createStore(':memory:');
  try {
    const event = statementEvents(parsed([purchase]), '2024-02-01T00:00:00Z', 'file.pdf')[0].event;
    store.save({ ...event, id: randomUUID(), fingerprint: 'sms:' + randomUUID(), source_type: 'sms', date: '2024-01-21', time: '11:01:00' }, 'phone');
    const importer = createImporter(store, directory(), { parser: async () => parsed([purchase]) });
    const preview = await importer.upload(upload()); assert.equal(preview.summary.duplicates, 1);
    importer.commit(preview.id); assert.equal(store.all().length, 2);
    assert.equal(aggregate(store.all(), { metric: 'expense', group: '' }, { period: 'all' })[0].amountMinor, String(purchase.amountMinor));
  } finally { store.close(); }
});

test('Исправленная банковская строка требует сверки; прежние данные и исходник сохранены', async () => {
  const store = createStore(':memory:'); let current = parsed([purchase]);
  try {
    const importer = createImporter(store, directory(), { parser: async () => current });
    const first = await importer.upload(upload()); importer.commit(first.id);
    current = parsed([{ ...purchase, amountMinor: 99900 }]);
    await assert.rejects(importer.upload(upload()), /Банк изменил/);
    assert.equal(store.all()[0].amount_minor, purchase.amountMinor); assert.equal(store.all()[0].version, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM bank_sources').get().n, 1);
  } finally { store.close(); }
});

test('Ipak: неизвестное направление, конверсия и одинаковые строки сохранены; нулевая строка исключена', async () => {
  const dir = directory(), store = createStore(':memory:');
  const source = { source: 'ipak-history-pdf-v1', period: { from: '2024-01-01', to: '2024-01-31' }, pages: 1,
    rows: ['USD', 'USD', 'RUB', 'UZS'].map((currency, i) => ({ ...row(i + 1, 'Перевод: TEST PERSON', i === 3 ? 0 : 300), currency, postingTime: null, operation: i === 2 ? 'Конверсия' : 'Перевод', counterparty: 'TEST PERSON' })) };
  const importer = createImporter(store, dir, { parser: async () => source });
  try {
    const first = await importer.upload({ ...upload(), bank: 'ipak', cardSuffix: '1234' });
    assert.equal(first.summary.total, 4); assert.equal(first.summary.review, 3); assert.equal(first.summary.ignored, 1);
    assert.equal(first.summary.recorded, 0); assert.equal(first.source, 'Ipak Yuli');
    importer.commit(first.id); assert.equal(store.all(false).length, 4);
    assert.equal(new Set(store.all(false).map(e => e.id)).size, 4);
    assert.equal(store.all(false)[0].card_suffix, '1234');
    assert.deepEqual(aggregate(store.all(false), { metric: 'expense', group: '' }, { period: 'all' }), []);
    const event = store.all(false).find(e => e.state === 'review'); store.edit(event.id, { expectedVersion: 1, event: { purpose: 'Проверить свои счета' } });
    const repeat = await importer.upload({ ...upload(), filename: 'new-name.pdf', bank: 'ipak' });
    assert.equal(repeat.summary.existing, 4); assert.equal(importer.commit(repeat.id).inserted, 0);
    assert.equal(store.get(event.id).purpose, 'Проверить свои счета');
    assert.equal(hash(readFileSync(path.join(dir, 'imports', first.id, 'source.pdf'))), first.sha256);
  } finally { store.close(); }
});

test('HTTP: импорт требует входа; PDF проходит предпросмотр и атомарное сохранение', async () => {
  const app = createFinanceServer({ directory: directory(), importParser: async () => parsed([purchase]) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  try {
    const unauthorised = await fetch(base + '/api/imports/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(upload()) }); assert.equal(unauthorised.status, 401);
    const welcome = await fetch(base + '/'), cookie = welcome.headers.get('set-cookie').split(';')[0];
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const response = await fetch(base + '/api/imports/preview', { method: 'POST', headers, body: JSON.stringify(upload()) }); assert.equal(response.status, 201);
    const preview = await response.json(); assert.equal(app.store.all().length, 0);
    const result = await fetch(base + '/api/imports/' + preview.id + '/commit', { method: 'POST', headers, body: '{}' }); assert.equal(result.status, 200); assert.equal((await result.json()).inserted, 1);
    const invalid = await fetch(base + '/api/imports/preview', { method: 'POST', headers, body: JSON.stringify({ filename: 'file.pdf', data: Buffer.from('not-a-pdf').toString('base64') }) }); assert.equal(invalid.status, 400);
  } finally { await app.close(); }
});

test('Payme: XLSX сохраняет категории и отмены; пересечения, другой ZIP и изменённый чек не удваивают расходы', async () => {
  const store = createStore(':memory:'), dir = directory();
  const paymeRow = (n, suffix, category = 'продукты', paid = true, amount = 6647316) => {
    const cells = ['02-01-2026', '12:34:56', 'Списание', 'TEST SHOP ' + n, 'TEST COMPANY', amount / 100, category, '', '', '123456******' + suffix, 'TEST CARD', '', 'Payme', paid ? 'Оплачен' : 'Отменен', 'TEST POINT', 'TEST TERMINAL'];
    return { documentDate: '2026-01-02', documentNumber: String(n), postingDate: '2026-01-02', postingTime: '12:34:56', amountMinor: amount, currency: 'UZS', details: 'Списание: TEST SHOP ' + n, operation: 'Списание', merchant: 'TEST SHOP ' + n, category, cardSuffix: suffix, paid,
      identity: ['2026-01-02', '12:34:56', 'Списание', 'TEST SHOP ' + n, 'TEST COMPANY', amount, '', '123456******' + suffix, 'Payme', paid ? 'Оплачен' : 'Отменен', 'TEST POINT', 'TEST TERMINAL'], occurrence: 1, fragments: [{ sheet: 'Filtered_Cheques', row: n + 1, cells, amountExcel: String(amount / 100) }] };
  };
  let current = { source: 'payme-xlsx-v1', period: { from: '2026-01-01', to: '2026-12-31' }, sheets: 1, currency: 'UZS', rows: [paymeRow(1, '1234'), paymeRow(2, '1234', 'перевод'), paymeRow(3, '9999'), paymeRow(4, '1234', 'продукты', false)] };
  const input = { filename: '20260101_20261231.xlsx', data: Buffer.from([0x50, 0x4b, 3, 4, 0]).toString('base64'), bank: 'payme', ownCards: ['1234'] };
  const importer = createImporter(store, dir, { parser: async () => current });
  try {
    const first = await importer.upload(input); assert.equal(first.summary.recorded, 1); assert.equal(first.summary.review, 2); assert.equal(first.summary.ignored, 1);
    assert.equal(hash(readFileSync(path.join(dir, 'imports', first.id, 'source.xlsx'))), first.sha256);
    importer.commit(first.id); const expense = store.all(false).find(e => e.state === 'recorded'); assert.equal(expense.category, 'продукты');
    store.edit(expense.id, { expectedVersion: 1, event: { category: 'Моя категория', merchant: 'Мой магазин' } });
    current = { ...current, rows: current.rows.map(r => ({ ...r, documentNumber: String(Number(r.documentNumber) + 20), fragments: [{ ...r.fragments[0], row: r.fragments[0].row + 20 }] })) };
    const repeat = await importer.upload({ ...input, filename: 'another.xlsx', data: Buffer.from([0x50, 0x4b, 3, 4, 9]).toString('base64') });
    assert.equal(repeat.summary.existing, 4); assert.equal(importer.commit(repeat.id).inserted, 0); assert.equal(store.get(expense.id).category, 'Моя категория');
    current = { ...current, rows: [paymeRow(1, '1234', 'продукты', true, 77700)] };
    const changed = await importer.upload(input); assert.equal(changed.summary.duplicates, 1); importer.commit(changed.id);
    current = { ...current, rows: [paymeRow(1, '1234', 'продукты', false)] };
    const cancellation = await importer.upload(input); assert.equal(cancellation.summary.review, 1); assert.equal(cancellation.summary.ignored, 0);
    assert.match(cancellation.rows[0].reason, /прежняя операция сохранена/);
    importer.commit(cancellation.id); assert.equal(store.get(expense.id).state, 'recorded');
    assert.equal(aggregate(store.all(false), { metric: 'expense', group: '' }, { period: 'all' })[0].amountMinor, String(expense.amount_minor));
    await assert.rejects(importer.upload({ ...input, ownCards: ['1234567890123456'] }), /четыре/);
    await assert.rejects(importer.upload({ ...input, bank: 'uzum' }), /формат/);
  } finally { store.close(); }
});

test('PDF через Поделиться: подключённый телефон готовит выписку, браузер проверяет и сохраняет её', async () => {
  const dir = directory(), app = createFinanceServer({ directory: dir, importParser: async () => parsed([purchase]) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  try {
    const welcome = await fetch(base + '/');
    const ownerHeaders = { 'Content-Type': 'application/json', Cookie: welcome.headers.get('set-cookie').split(';')[0] };
    const code = (await (await fetch(base + '/api/pairing', { method: 'POST', headers: ownerHeaders, body: '{}' })).json()).code;
    const paired = await (await fetch(base + '/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, label: 'PDF test phone' }) })).json();
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + paired.token };
    const route = base + '/api/mobile/imports/preview';
    assert.equal((await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(upload()) })).status, 401);
    assert.equal((await fetch(route, { method: 'POST', headers: ownerHeaders, body: JSON.stringify(upload()) })).status, 403);
    const response = await fetch(route, { method: 'POST', headers, body: JSON.stringify(upload()) });
    assert.equal(response.status, 201); const preview = await response.json();
    assert.equal(preview.sha256, hash(Buffer.from(upload().data, 'base64')));
    assert.equal(app.store.all().length, 0);
    const receipt = await fetch(base + '/api/mobile/imports/' + preview.id, { headers });
    assert.equal(receipt.status, 200); assert.equal((await receipt.json()).committed, false);
    assert.equal((await fetch(base + '/api/imports/' + preview.id + '/commit', { method: 'POST', headers, body: '{}' })).status, 403);
    const ticket = await (await fetch(base + '/api/mobile/browser-session', { method: 'POST', headers, body: '{}' })).json();
    const opened = await fetch(base + ticket.path + '&import=' + preview.id, { redirect: 'manual' });
    assert.equal(opened.headers.get('location'), '/?import=' + preview.id);
    const browser = { 'Content-Type': 'application/json', Cookie: opened.headers.get('set-cookie').split(';')[0] };
    const shown = await (await fetch(base + '/api/imports/' + preview.id, { headers: browser })).json();
    assert.equal(shown.summary.total, 1);
    const committed = await fetch(base + '/api/imports/' + preview.id + '/commit', { method: 'POST', headers: browser, body: '{}' });
    assert.equal((await committed.json()).inserted, 1);
    assert.equal((await (await fetch(base + '/api/mobile/imports/' + preview.id, { headers })).json()).committed, true);
    const repeated = await (await fetch(route, { method: 'POST', headers, body: JSON.stringify(upload()) })).json();
    assert.equal(repeated.summary.existing, 1); assert.equal(app.store.all().length, 1);
    const nextTicket = await (await fetch(base + '/api/mobile/browser-session', { method: 'POST', headers, body: '{}' })).json();
    const invalid = await fetch(base + nextTicket.path + '&import=https://other.example', { redirect: 'manual' });
    assert.equal(invalid.headers.get('location'), '/');
    await fetch(base + '/api/device/revoke', { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ id: paired.deviceId }) });
    assert.equal((await fetch(route, { method: 'POST', headers, body: JSON.stringify(upload()) })).status, 401);
    assert.equal((await fetch(base + '/api/mobile/imports/' + preview.id, { headers })).status, 401);
  } finally { await app.close(); }
});
