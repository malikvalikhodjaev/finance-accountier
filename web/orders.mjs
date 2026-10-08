import { hash, fail, validDate, today } from './store.mjs';
import { flowOf } from './flows.mjs';
import { cancelledOrder } from './public/order-summary.mjs';

export const services = { yandex_go: 'Яндекс Go', uzum_market: 'Uzum Market', uzum_tezkor: 'Uzum Tezkor', wildberries: 'Wildberries', paynet: 'Paynet', subscription: 'Подписки и сервисы' };
const merchantPatterns = {
  yandex_go: /yandex|яндекс/i, uzum_market: /uzum[\s_-]*market|узум[\s_-]*маркет/i,
  uzum_tezkor: /tezkor|тезкор/i, wildberries: /wildberries|вайлдбер|вилдбер/i,
  paynet: /paynet|пайнет/i, subscription: /openai|chatgpt|anthropic|claude|cursor|github|paddle/i
};
const uuid = digest => digest.slice(0, 8) + '-' + digest.slice(8, 12) + '-' + digest.slice(12, 16) + '-' + digest.slice(16, 20) + '-' + digest.slice(20, 32);
const text = (value, limit, name, required = false) => {
  if (value == null || value === '') { if (required) fail('Не указано: ' + name); return ''; }
  if (typeof value !== 'string' || value.length > limit) fail('Некорректное поле заказа: ' + name);
  return value;
};
const money = (value, name) => { if (value == null) return null; if (!Number.isSafeInteger(value) || value < 0 || value > 100000000000000) fail('Некорректная сумма: ' + name); return value; };

export function normaliseOrder(input, service, account) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Нужны сведения о заказе.');
  if (!services[service]) fail('Неизвестный сервис.');
  account = text(account, 120, 'аккаунт', true);
  const externalId = text(input.externalId, 200, 'номер заказа');
  const identity = externalId ? 'id:' + externalId : text(input.identity, 2000, 'признаки заказа', true);
  const date = input.date ? validDate(input.date) : null;
  if (date && date > today()) fail('Дата совершённого заказа не может быть в будущем.');
  const dateCertainty = input.dateCertainty || (date ? 'exact' : 'unknown');
  if (!['exact', 'inferred_year', 'unknown'].includes(dateCertainty) || (dateCertainty !== 'unknown' && !date)) fail('Проверь точность даты заказа.');
  const time = text(input.time, 8, 'время');
  if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) fail('Некорректное время заказа.');
  const currency = text(input.currency, 3, 'валюта');
  if (currency && !/^[A-Z]{3}$/.test(currency)) fail('Некорректная валюта заказа.');
  const amountMinor = money(input.amountMinor, 'итого');
  if (amountMinor !== null && !currency) fail('Для суммы заказа нужна валюта.');
  const cardSuffix = text(input.cardSuffix, 4, 'карта');
  if (cardSuffix && !/^\d{4}$/.test(cardSuffix)) fail('Карта: только последние четыре цифры.');
  const items = input.items || [];
  if (!Array.isArray(items) || items.length > 300) fail('Слишком много позиций заказа.');
  const details = input.details || {};
  if (!details || typeof details !== 'object' || Array.isArray(details) || Object.keys(details).length > 20) fail('Некорректная детализация заказа.');
  const detailFields = {};
  for (const [key, value] of Object.entries(details)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof value) && value !== null) fail('Некорректное поле детализации.');
    if (typeof value === 'string' && value.length > 2000 || typeof value === 'number' && !Number.isSafeInteger(value)) fail('Некорректное значение детализации.');
    detailFields[key] = value;
  }
  for (const key of ['paidMinor', 'refundMinor', 'deliveryMinor', 'discountMinor']) if (details[key] != null) money(details[key], key);
  const sourceKey = hash(JSON.stringify([service, account, identity]));
  return { id: uuid(sourceKey), sourceKey, service, account, identity, externalId, title: text(input.title, 500, 'название', true), date, dateCertainty, dateLabel: text(input.dateLabel, 120, 'дата в источнике'), time: time || null,
    amountMinor, currency: currency || null, status: text(input.status, 160, 'статус'), paymentMethod: text(input.paymentMethod, 160, 'способ оплаты'), cardSuffix: cardSuffix || null,
    items: items.map(item => ({ name: text(item?.name, 500, 'позиция заказа', true), quantity: text(item.quantity == null ? '' : String(item.quantity), 40, 'количество'), amountMinor: money(item.amountMinor, 'позиция') })),
    details: detailFields, rawText: text(input.rawText, 40000, 'исходная запись', true) };
}

export function candidatePayments(order, events, relation = 'payment') {
  if (relation === 'payment' && cancelledOrder(order)) return [];
  if (order.dateCertainty !== 'exact' || !order.date || !order.currency || /наличн|naqd|cash/i.test(order.paymentMethod)) return [];
  const amount = relation === 'refund' ? order.details.refundMinor : order.amountMinor;
  if (!(amount > 0) || !Number.isSafeInteger(amount)) return [];
  const when = Date.parse(order.date + 'T00:00:00Z');
  return events.filter(event => {
    if (['ignored', 'duplicate'].includes(event.state) || event.amount_minor !== amount || event.currency !== order.currency || !event.date) return false;
    if (flowOf(event) !== (relation === 'refund' ? 'incoming' : 'outgoing')) return false;
    if (order.cardSuffix && event.card_suffix && order.cardSuffix !== event.card_suffix) return false;
    if (Math.abs(Date.parse(event.date + 'T00:00:00Z') - when) > 3 * 86400000) return false;
    return merchantPatterns[order.service].test([event.merchant, event.description, event.raw_fragment].join(' '));
  }).map(event => ({ ...event, relation, reasons: ['Совпали сумма и валюта', 'Название сервиса есть в банковской записи', ...(order.cardSuffix && event.card_suffix ? ['Совпала карта'] : []), event.date === order.date ? 'Совпала дата' : 'Банковская дата отличается; возможна дата проводки'], exactDay: event.date === order.date })).sort((a, b) => Number(b.exactDay) - Number(a.exactDay)).slice(0, 30);
}

export function createOrders(store) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS service_batches(id TEXT PRIMARY KEY,digest TEXT UNIQUE NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS service_orders(id TEXT PRIMARY KEY,source_key TEXT UNIQUE NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS order_observations(order_id TEXT NOT NULL REFERENCES service_orders(id),batch_id TEXT NOT NULL REFERENCES service_batches(id),data TEXT NOT NULL,PRIMARY KEY(order_id,batch_id));
    CREATE TABLE IF NOT EXISTS order_links(order_id TEXT NOT NULL REFERENCES service_orders(id),event_id TEXT NOT NULL REFERENCES events(id),relation TEXT NOT NULL,order_version INTEGER NOT NULL,event_version INTEGER NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(order_id,event_id,relation));
    CREATE TABLE IF NOT EXISTS order_link_history(id INTEGER PRIMARY KEY,order_id TEXT NOT NULL,event_id TEXT NOT NULL,relation TEXT NOT NULL,active INTEGER NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL);`);
  const get = id => {
    const row = db.prepare('SELECT * FROM service_orders WHERE id=?').get(id);
    if (!row) fail('Заказ не найден.', 404);
    return { ...JSON.parse(row.data), version: row.version, updatedAt: row.updated_at };
  };
  const batches = () => db.prepare('SELECT * FROM service_batches ORDER BY created_at DESC').all().map(row => ({ id: row.id, ...JSON.parse(row.data), createdAt: row.created_at }));
  const links = id => db.prepare('SELECT * FROM order_links WHERE order_id=? AND active=1').all(id).map(link => ({ ...link, event: store.get(link.event_id), needsReview: link.order_version !== get(id).version || link.event_version !== store.get(link.event_id).version }));
  function all({ service = '', search = '', from = '', to = '' } = {}) {
    if (from) validDate(from); if (to) validDate(to);
    const query = String(search).toLocaleLowerCase('ru');
    return db.prepare('SELECT * FROM service_orders ORDER BY updated_at DESC').all().map(row => ({ ...JSON.parse(row.data), version: row.version, updatedAt: row.updated_at, links: links(row.id).map(link => ({ eventId: link.event_id, relation: link.relation, needsReview: link.needsReview })) })).filter(row =>
      (!service || row.service === service) && (!from || row.date && row.date >= from) && (!to || !row.date || row.date <= to) && (!query || [row.title, row.externalId, row.rawText, ...row.items.map(item => item.name)].join(' ').toLocaleLowerCase('ru').includes(query))
    ).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''));
  }
  function validatePacket(packet) {
    if (packet?.schema !== 'rhythm-service-orders-v1' || !services[packet.service] || !Array.isArray(packet.orders) || packet.orders.length > 10000) fail('Неподдерживаемый пакет заказов.');
    const account = text(packet.account, 120, 'аккаунт', true), note = text(packet.coverageNote, 2000, 'границы истории', true);
    if (Number.isNaN(Date.parse(packet.capturedAt))) fail('Не указано время получения источника.');
    const rows = packet.orders.map(input => normaliseOrder(input, packet.service, account));
    if (new Set(rows.map(row => row.id)).size !== rows.length) fail('В пакете повторились признаки заказа. Проверь исходник, не удаляя записи.');
    const artifacts = packet.artifacts || [];
    if (!Array.isArray(artifacts) || artifacts.length > 100) fail('Некорректные исходные файлы заказов.');
    for (const artifact of artifacts) {
      if (!artifact || typeof artifact.name !== 'string' || artifact.name.length > 200 || !/^[a-f0-9]{64}\.(?:png|pdf|xml|html|json|txt)$/.test(artifact.file || '') || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '') || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 20 * 1024 * 1024) fail('Не проверена целостность исходного файла заказа.');
    }
    return { rows, metadata: { service: packet.service, account, capturedAt: packet.capturedAt, coverageNote: note, count: rows.length, artifacts } };
  }
  function preview(packet) {
    const { rows, metadata } = validatePacket(packet), events = store.all(false);
    return { ...metadata, rows: rows.map(row => {
      const known = db.prepare('SELECT data,version FROM service_orders WHERE id=?').get(row.id);
      return { ...row, importStatus: !known ? 'new' : known.data === JSON.stringify(row) ? 'existing' : 'changed', candidates: candidatePayments(row, events).length };
    }) };
  }
  function commit(packet, digest) { return store.transaction(() => {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('Не проверена целостность источника.');
    const knownBatch = db.prepare('SELECT id FROM service_batches WHERE digest=?').get(digest);
    if (knownBatch) return { id: knownBatch.id, inserted: 0, updated: 0, existing: packet.orders.length, repeated: true };
    const { rows, metadata } = validatePacket(packet), batchId = uuid(digest), at = new Date().toISOString();
    db.prepare('INSERT INTO service_batches VALUES(?,?,?,?)').run(batchId, digest, JSON.stringify(metadata), at);
    let inserted = 0, updated = 0, existing = 0;
    for (const row of rows) {
      const previous = db.prepare('SELECT data,version FROM service_orders WHERE id=?').get(row.id), json = JSON.stringify(row);
      if (!previous) { db.prepare('INSERT INTO service_orders VALUES(?,?,?,?,?)').run(row.id, row.sourceKey, json, 1, at); inserted++; }
      else if (previous.data !== json) { db.prepare('UPDATE service_orders SET data=?,version=?,updated_at=? WHERE id=?').run(json, previous.version + 1, at, row.id); updated++; }
      else existing++;
      db.prepare('INSERT INTO order_observations VALUES(?,?,?)').run(row.id, batchId, json);
    }
    return { id: batchId, inserted, updated, existing, repeated: false };
  }); }
  function detail(id) {
    const row = get(id);
    return { row, links: links(id), candidates: candidatePayments(row, store.all(false)), refunds: candidatePayments(row, store.all(false), 'refund'), observations: db.prepare('SELECT * FROM order_observations WHERE order_id=?').all(id).map(observation => ({ batchId: observation.batch_id, order: JSON.parse(observation.data), source: batches().find(batch => batch.id === observation.batch_id) })) };
  }
  function link(id, input, actor = 'web') { return store.transaction(() => {
    const order = get(id), event = store.get(input.eventId);
    if (input.expectedOrderVersion !== order.version || input.expectedEventVersion !== event.version) fail('Заказ или банковская запись изменились. Перечитай их перед связыванием.', 409);
    if (!['payment', 'refund'].includes(input.relation) || typeof input.active !== 'boolean') fail('Некорректная связь заказа.');
    db.prepare('INSERT INTO order_links VALUES(?,?,?,?,?,?) ON CONFLICT(order_id,event_id,relation) DO UPDATE SET order_version=excluded.order_version,event_version=excluded.event_version,active=excluded.active').run(id, event.id, input.relation, order.version, event.version, Number(input.active));
    db.prepare('INSERT INTO order_link_history(order_id,event_id,relation,active,actor,at) VALUES(?,?,?,?,?,?)').run(id, event.id, input.relation, Number(input.active), actor, new Date().toISOString());
    return detail(id);
  }); }
  function forEvent(id) { return db.prepare('SELECT order_id,relation,order_version,event_version FROM order_links WHERE event_id=? AND active=1').all(id).map(link => ({ ...get(link.order_id), relation: link.relation, needsReview: link.order_version !== get(link.order_id).version || link.event_version !== store.get(id).version })); }
  function backup() { return { batches: batches(), orders: all(), observations: db.prepare('SELECT * FROM order_observations').all(), links: db.prepare('SELECT * FROM order_links').all(), linkHistory: db.prepare('SELECT * FROM order_link_history').all() }; }
  return { get, all, batches, preview, commit, detail, link, forEvent, backup };
}
