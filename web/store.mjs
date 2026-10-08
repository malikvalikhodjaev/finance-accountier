import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const eventKeys = 'id fingerprint signature source_type source_name source_ref received_at event_millis raw_title raw_text raw_fragment state amount_minor currency kind date time merchant card_suffix balance_minor category description review_reason purpose bank_operation'.split(' ');
export const editableKeys = 'state amount_minor currency kind date time merchant category description review_reason purpose'.split(' ');
const immutableKeys = eventKeys.filter(key => !editableKeys.includes(key));
export const hash = value => createHash('sha256').update(value).digest('hex');
export function fail(message, status = 400, details = null) { const error = new Error(message); error.status = status; error.details = details; throw error; }
const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' });
export const today = () => localDay.format(new Date());
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail('Некорректная дата.');
  return value;
}
export function normaliseEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Нужна операция.');
  const row = Object.fromEntries(eventKeys.map(key => [key, input[key] ?? null]));
  if (!/^[a-f0-9-]{36}$/i.test(row.id ?? '') || typeof row.fingerprint !== 'string' || !row.fingerprint || row.fingerprint.length > 256) fail('Некорректный идентификатор операции.');
  for (const key of eventKeys) {
    const value = row[key];
    if (value === null) continue;
    if (['amount_minor', 'balance_minor', 'event_millis'].includes(key)) {
      if (!Number.isSafeInteger(value) || value < 0 || (key === 'amount_minor' && value > 100000000000000)) fail('Некорректное число: ' + key);
    } else if (typeof value !== 'string' || value.length > (key.startsWith('raw_') ? 40000 : 500)) fail('Некорректное поле: ' + key);
  }
  for (const key of ['source_type', 'source_name', 'source_ref', 'received_at', 'raw_title', 'raw_text', 'raw_fragment']) if (typeof row[key] !== 'string') fail('Нет исходного поля: ' + key);
  if (!['recorded', 'review', 'duplicate', 'ignored'].includes(row.state)) fail('Неизвестное состояние операции.');
  if (row.kind && !['expense', 'income', 'transfer', 'unknown'].includes(row.kind)) fail('Неизвестный тип операции.');
  if (row.date) { validDate(row.date); if (row.date > today()) fail('Операция не может быть в будущем.'); }
  if (row.currency && !/^[A-Z]{3}$/.test(row.currency)) fail('Валюта состоит из трёх латинских букв.');
  if (row.state === 'recorded' && (!(row.amount_minor > 0) || !row.currency || !row.date || !['expense', 'income', 'transfer'].includes(row.kind))) fail('Для учтённой операции нужны сумма, валюта, дата и тип.');
  if ((row.category?.length ?? 0) > 120 || (row.description?.length ?? 0) > 500 || (row.purpose?.length ?? 0) > 240) fail('Слишком длинная категория, описание или назначение.');
  row.purpose ??= ''; row.bank_operation ??= '';
  return row;
}
export function mergeEvents(base, current, incoming) {
  for (const key of immutableKeys) if (incoming[key] !== current[key]) fail('Исходное поле нельзя переписать: ' + key);
  const merged = { ...current }, conflicts = [];
  for (const key of editableKeys) if (incoming[key] !== base[key]) {
    if (current[key] !== base[key] && current[key] !== incoming[key]) conflicts.push(key);
    else merged[key] = incoming[key];
  }
  return { merged, conflicts };
}
export function dateRange(filters = {}) {
  const end = today();
  let start = '';
  if (filters.period === '7' || filters.period === '30') { const day = new Date(end + 'T00:00:00Z'); day.setUTCDate(day.getUTCDate() - Number(filters.period) + 1); start = day.toISOString().slice(0, 10); }
  else if (filters.period === 'month') start = end.slice(0, 7) + '-01';
  const from = filters.from ? validDate(filters.from) : start;
  const to = filters.to ? validDate(filters.to) : end;
  if (from && from > to) fail('Начальная дата позже конечной.');
  return { from, to };
}
export function selectRows(rows, filters = {}) {
  const { from, to } = dateRange(filters), search = String(filters.search || '').toLocaleLowerCase('ru');
  return rows.filter(row => {
    const day = row.date || row.received_at?.slice(0, 10) || '';
    if ((from && day < from) || day > to) return false;
    for (const key of ['kind', 'state', 'currency', 'category', 'merchant']) if (filters[key] && row[key] !== filters[key]) return false;
    if (filters.customField && filters.customValue !== undefined && String(row.custom?.[filters.customField] ?? '') !== String(filters.customValue)) return false;
    return !search || ['merchant', 'category', 'description', 'purpose', 'source_name', ...Object.keys(row.custom || {})].map(key => row.custom?.[key] ?? row[key] ?? '').join(' ').toLocaleLowerCase('ru').includes(search);
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '') || b.received_at.localeCompare(a.received_at));
}
export function aggregate(rows, widget, filters) {
  const selected = selectRows(rows, { ...filters, ...(widget.viewFilters || {}), ...(widget.currency ? { currency: widget.currency } : {}) }).filter(row => row.state === 'recorded' && (widget.metric === 'count' || row.kind === widget.metric));
  const currencies = new Map();
  for (const row of selected) {
    const code = row.currency, item = currencies.get(code) || { currency: code, total: 0n, count: 0, groups: new Map() };
    let label = widget.group === 'day' ? row.date : widget.group === 'month' ? row.date.slice(0, 7) : widget.group?.startsWith('f_') ? String(row.custom?.[widget.group] ?? 'Не указано') : widget.group ? row[widget.group] || 'Не указано' : 'Итого';
    const group = item.groups.get(label) || { label, amount: 0n, count: 0 };
    group.amount += BigInt(row.amount_minor); group.count++; item.total += BigInt(row.amount_minor); item.count++; item.groups.set(label, group); currencies.set(code, item);
  }
  return [...currencies.values()].map(item => ({ currency: item.currency, amountMinor: item.total.toString(), count: item.count, groups: [...item.groups.values()].sort((a, b) => ['day', 'month'].includes(widget.group) ? a.label.localeCompare(b.label) : widget.metric === 'count' ? b.count - a.count : a.amount === b.amount ? a.label.localeCompare(b.label) : a.amount > b.amount ? -1 : 1).map(group => ({ label: group.label, amountMinor: group.amount.toString(), count: group.count })) }));
}

export function createStore(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, seq INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS history(event_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(event_id,version));
    CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS extras(event_id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS source_revisions(digest TEXT PRIMARY KEY,event_id TEXT NOT NULL,changed_at TEXT NOT NULL,previous_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conflicts(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,device_id TEXT NOT NULL,client_revision INTEGER NOT NULL,incoming TEXT NOT NULL,fields TEXT NOT NULL,created_at TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,delivered INTEGER NOT NULL DEFAULT 0,UNIQUE(event_id,device_id,client_revision));
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,label TEXT NOT NULL,token_hash TEXT NOT NULL,created_at TEXT NOT NULL,last_seen TEXT,revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,device_id TEXT,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tickets(hash TEXT PRIMARY KEY,device_id TEXT,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pairing(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
    PRAGMA user_version=1;`);
  function transaction(callback) { db.exec('BEGIN IMMEDIATE'); try { const result = callback(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function get(id) { const row = db.prepare('SELECT * FROM events WHERE id=?').get(id); if (!row) fail('Операция не найдена.', 404); return { ...JSON.parse(row.data), version: row.version, seq: row.seq, custom: JSON.parse(db.prepare('SELECT data FROM extras WHERE event_id=?').get(id)?.data || '{}') }; }
  function save(event, actor, force = false) {
    event = normaliseEvent(event); const json = JSON.stringify(event), previous = db.prepare('SELECT * FROM events WHERE id=?').get(event.id);
    if (previous && previous.data === json && !force) return get(event.id);
    const version = (previous?.version || 0) + 1, now = new Date().toISOString();
    const seq = Number(db.prepare('INSERT INTO changes(event_id,version) VALUES(?,?)').run(event.id, version).lastInsertRowid);
    db.prepare('INSERT INTO events VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,seq=excluded.seq').run(event.id, event.fingerprint, json, version, seq);
    db.prepare('INSERT INTO history VALUES(?,?,?,?,?)').run(event.id, version, json, actor, now);
    return get(event.id);
  }
  function settings(kind) { return db.prepare('SELECT * FROM settings WHERE kind=? ORDER BY rowid').all(kind).map(row => ({ ...JSON.parse(row.data), id: row.id, version: row.version })); }
  function setting(kind, input) {
    if (!input || typeof input !== 'object') fail('Некорректные настройки.');
    const id = input.id || (kind === 'field' ? 'f_' : '') + randomUUID(), previous = db.prepare('SELECT * FROM settings WHERE kind=? AND id=?').get(kind, id);
    if (!/^(?:all|main|(?:f_)?[a-f0-9-]{36})$/.test(id)) fail('Некорректный идентификатор настроек.');
    if (previous && input.expectedVersion !== previous.version) fail('Настройки изменились в другой вкладке.', 409);
    const data = { ...input, id }; delete data.expectedVersion; delete data.version;
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 80) fail('Название: от 1 до 80 символов.');
    data.name = data.name.trim();
    if (kind === 'field') {
      if (!['text', 'number', 'date', 'select', 'checkbox'].includes(data.type)) fail('Неизвестный тип колонки.');
      if (previous && JSON.parse(previous.data).type !== data.type) fail('Тип существующей колонки сохраняется. Создай новую колонку нужного типа.');
      if (data.type === 'select' && (!Array.isArray(data.options) || !data.options.length || data.options.length > 50 || data.options.some(value => typeof value !== 'string' || !value.trim() || value.length > 80))) fail('Нужны варианты выбора, до 50 значений.');
      data.active = data.active !== false;
    }
    if (kind === 'view') { dateRange(data.filters || {}); if (!Array.isArray(data.columns) || data.columns.some(value => typeof value !== 'string')) fail('Некорректные колонки представления.'); }
    if (kind === 'dashboard') {
      if (!Array.isArray(data.widgets) || data.widgets.length > 30) fail('Дашборд содержит до 30 виджетов.');
      for (const widget of data.widgets) if (!widget.id || typeof widget.name !== 'string' || widget.name.length > 80 || !['expense', 'income', 'transfer', 'count'].includes(widget.metric) || !['', 'category', 'merchant', 'day', 'month', ...settings('field').map(field => field.id)].includes(widget.group) || (widget.currency && !/^[A-Z]{3}$/.test(widget.currency))) fail('Некорректный виджет.');
    }
    const version = (previous?.version || 0) + 1;
    db.prepare('INSERT INTO settings VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,version=excluded.version').run(kind, id, JSON.stringify(data), version);
    return { ...data, version };
  }
  function validateExtras(values, previous = {}) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) fail('Некорректные значения колонок.');
    const fields = settings('field'), result = {};
    for (const [id, value] of Object.entries(values)) {
      const field = fields.find(item => item.id === id); if (!field) fail('Колонка не найдена.');
      if (value === '' || value === null) { result[id] = null; continue; }
      if (field.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : field.type === 'checkbox' ? typeof value !== 'boolean' : typeof value !== 'string' || value.length > 1000) fail('Некорректное значение: ' + field.name);
      if (field.type === 'date') validDate(value);
      if (field.type === 'select' && !field.options.includes(value) && previous[id] !== value) fail('Выбери вариант: ' + field.name);
      result[id] = value;
    }
    return result;
  }
  function edit(id, input, actor = 'web') { return transaction(() => {
    const current = get(id); if (input.expectedVersion !== current.version) fail('Эта операция уже изменилась. Твой черновик сохранён в форме; перечитай текущую запись.', 409, current);
    for (const key of Object.keys(input.event || {})) if (!editableKeys.includes(key)) fail('Поле нельзя менять: ' + key);
    const event = normaliseEvent({ ...current, ...input.event });
    const custom = input.custom === undefined ? current.custom : validateExtras(input.custom, current.custom);
    const result = save(event, actor, JSON.stringify(custom) !== JSON.stringify(current.custom));
    db.prepare('INSERT INTO extras VALUES(?,?) ON CONFLICT(event_id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(custom));
    return { ...result, custom };
  }); }
  function manual(input) { return transaction(() => {
    const id = randomUUID(), now = new Date().toISOString();
    const event = normaliseEvent({ id, fingerprint: 'web:' + id, source_type: 'web', source_name: 'Веб-таблица', source_ref: 'web', received_at: now, event_millis: Date.now(), raw_title: '', raw_text: '', raw_fragment: '', ...Object.fromEntries(editableKeys.map(key => [key, input.event?.[key] ?? null])), state: input.event?.state || 'recorded' });
    const custom = validateExtras(input.custom || {}), result = save(event, 'web'); db.prepare('INSERT INTO extras VALUES(?,?)').run(id, JSON.stringify(custom)); return { ...result, custom };
  }); }
  function sync(input, deviceId) { return transaction(() => {
    if (!Array.isArray(input.changes) || input.changes.length > 100 || !Number.isSafeInteger(input.cursor) || input.cursor < 0) fail('Некорректный пакет синхронизации.');
    const acknowledgements = [], conflicts = [];
    if (!Array.isArray(input.resolvedIds || []) || (input.resolvedIds || []).length > 100) fail('Некорректные подтверждения разбора.');
    for (const id of input.resolvedIds || []) storeResolution(id);
    function storeResolution(id) { db.prepare('UPDATE conflicts SET delivered=1 WHERE id=? AND device_id=? AND resolved=1').run(id, deviceId); }
    for (const change of input.changes) {
      const incoming = normaliseEvent(change.event);
      if (!Number.isSafeInteger(change.clientRevision) || change.clientRevision < 1 || !Number.isSafeInteger(change.baseVersion) || change.baseVersion < 0) fail('Некорректная версия операции.');
      const currentRow = db.prepare('SELECT * FROM events WHERE id=?').get(incoming.id);
      let result;
      if (!currentRow) { if (change.baseVersion !== 0) fail('Не найдена прежняя версия операции.', 409); result = save(incoming, deviceId); }
      else {
        const current = normaliseEvent(get(incoming.id));
        for (const key of immutableKeys) if (incoming[key] !== current[key]) fail('Исходное поле нельзя переписать: ' + key);
        const old = db.prepare('SELECT data FROM history WHERE event_id=? AND version=?').get(incoming.id, change.baseVersion);
        const merged = JSON.stringify(current) === JSON.stringify(incoming) ? { merged: current, conflicts: [] } : old ? mergeEvents(JSON.parse(old.data), current, incoming) : { merged: current, conflicts: editableKeys.filter(key => incoming[key] !== current[key]) };
        if (merged.conflicts.length) {
          const partial = save(merged.merged, deviceId);
          db.prepare('UPDATE conflicts SET resolved=1,delivered=1 WHERE event_id=? AND device_id=? AND client_revision<?').run(incoming.id, deviceId, change.clientRevision);
          const id = randomUUID(); db.prepare('INSERT OR IGNORE INTO conflicts(id,event_id,device_id,client_revision,incoming,fields,created_at) VALUES(?,?,?,?,?,?,?)').run(id, incoming.id, deviceId, change.clientRevision, JSON.stringify(incoming), JSON.stringify(merged.conflicts), new Date().toISOString());
          conflicts.push({ id: incoming.id, clientRevision: change.clientRevision, event: normaliseEvent(partial), version: partial.version, fields: merged.conflicts }); continue;
        }
        result = save(merged.merged, deviceId);
      }
      for (const revision of change.revisions || []) {
        if (revision.event_id !== incoming.id || typeof revision.previous_json !== 'string' || revision.previous_json.length > 200000 || typeof revision.changed_at !== 'string' || revision.changed_at.length > 50) fail('Некорректная история операции.');
        db.prepare('INSERT OR IGNORE INTO source_revisions VALUES(?,?,?,?)').run(hash(JSON.stringify(revision)), incoming.id, revision.changed_at, revision.previous_json);
      }
      acknowledgements.push({ id: incoming.id, clientRevision: change.clientRevision, event: normaliseEvent(result), version: result.version });
      db.prepare('UPDATE conflicts SET resolved=1,delivered=1 WHERE event_id=? AND device_id=? AND client_revision<=?').run(incoming.id, deviceId, change.clientRevision);
    }
    const log = db.prepare('SELECT c.seq,c.version,h.data FROM changes c JOIN history h ON h.event_id=c.event_id AND h.version=c.version WHERE c.seq>? ORDER BY c.seq LIMIT 100').all(input.cursor);
    const changes = []; let bytes = 0;
    for (const change of log) {
      const item = { seq: change.seq, version: change.version, event: JSON.parse(change.data) }, size = Buffer.byteLength(JSON.stringify(item));
      if (changes.length && bytes + size > 1000000) break;
      changes.push(item); bytes += size;
    }
    const resolutions = db.prepare('SELECT * FROM conflicts WHERE device_id=? AND resolved=1 AND delivered=0 LIMIT 100').all(deviceId).map(conflict => { const row = get(conflict.event_id); return { resolutionId: conflict.id, id: conflict.event_id, clientRevision: conflict.client_revision, event: normaliseEvent(row), version: row.version }; });
    return { acknowledgements, conflicts, resolutions, changes, cursor: changes.at(-1)?.seq ?? input.cursor, hasMore: !!db.prepare('SELECT 1 FROM changes WHERE seq>? LIMIT 1').get(changes.at(-1)?.seq ?? input.cursor) };
  }); }
  function all(raw = true) {
    const data = raw ? 'e.data' : "json_remove(e.data,'$.raw_title','$.raw_text','$.raw_fragment')";
    return db.prepare('SELECT ' + data + " data,e.version,e.seq,COALESCE(x.data,'{}') custom FROM events e LEFT JOIN extras x ON x.event_id=e.id").all().map(row => ({ ...JSON.parse(row.data), version: row.version, seq: row.seq, custom: JSON.parse(row.custom) }));
  }
  if (!settings('view').length) setting('view', { id: 'all', name: 'Все операции', filters: { period: 'all' }, columns: ['date', 'merchant', 'amount_minor', 'currency', 'kind', 'category', 'purpose', 'state'] });
  if (!settings('dashboard').length) setting('dashboard', { id: 'main', name: 'Куда уходят деньги', widgets: [{ id: 'expense', name: 'Расходы', metric: 'expense', group: '', currency: '' }, { id: 'income', name: 'Доходы', metric: 'income', group: '', currency: '' }, { id: 'categories', name: 'По категориям', metric: 'expense', group: 'category', currency: '' }, { id: 'merchants', name: 'Магазины и сервисы', metric: 'expense', group: 'merchant', currency: '' }, { id: 'daily', name: 'По дням', metric: 'expense', group: 'day', currency: '' }] });
  return { db, transaction, get, all, save, sync, edit, manual, settings, setting, close: () => db.close() };
}
