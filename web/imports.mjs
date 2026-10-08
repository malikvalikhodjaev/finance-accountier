import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, normaliseEvent, fail } from './store.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const execute = promisify(execFile);
function ipakEvents(parsed, importedAt, filename) {
  if (!/^[a-f0-9]{64}$/.test(parsed.fileSha256 || '') || !Array.isArray(parsed.rows) || !parsed.rows.length || parsed.rows.length > 10000) fail('Неподдерживаемая история Ipak Yuli.');
  const identifiers = new Set();
  return parsed.rows.map(row => {
    if (!/^[1-9]\d*$/.test(row.documentNumber) || !['Конверсия', 'Перевод'].includes(row.operation) || !/^[A-Z]{3}$/.test(row.currency)) fail('Неподдерживаемая строка истории Ipak Yuli.');
    const sourceKey = hash('ipak:file:' + parsed.fileSha256 + ':' + row.documentNumber);
    if (identifiers.has(sourceKey)) fail('Повтор номера строки в истории.'); identifiers.add(sourceKey);
    const raw = JSON.stringify(row.fragments);
    const zero = row.amountMinor === 0;
    const reason = zero ? 'Нулевая служебная операция сохранена и исключена из итогов.' : 'В PDF нет направления движения, времени и ID операции. Уточни: расход, доход или свои деньги. Совпадения с другими выгрузками требуют сверки.';
    const id = sourceKey.slice(0, 8) + '-' + sourceKey.slice(8, 12) + '-' + sourceKey.slice(12, 16) + '-' + sourceKey.slice(16, 20) + '-' + sourceKey.slice(20, 32);
    const event = normaliseEvent({ id, fingerprint: 'bank:ipak:' + sourceKey, signature: null, source_type: 'bank_export', source_name: 'Ipak Yuli · история', source_ref: 'ipak:file:' + parsed.fileSha256,
      received_at: importedAt, event_millis: Date.parse(row.postingDate + 'T00:00:00+05:00'), raw_title: filename, raw_text: raw, raw_fragment: raw,
      state: zero ? 'ignored' : 'review', amount_minor: row.amountMinor, currency: row.currency, kind: 'unknown', date: row.postingDate, time: null,
      merchant: row.counterparty, card_suffix: parsed.cardSuffix || null, balance_minor: null, category: row.operation === 'Конверсия' ? 'Обмен валют' : 'Переводы',
      description: row.details.slice(0, 500), review_reason: reason, purpose: '', bank_operation: row.operation });
    return { sourceKey, row, event };
  });
}

export function statementEvents(parsed, importedAt, filename) {
  if (parsed.source === 'payme-xlsx-v1') return paymeEvents(parsed, importedAt, filename);
  if (parsed.source === 'ipak-history-pdf-v1') return ipakEvents(parsed, importedAt, filename);
  if (parsed.source !== 'uzum-account-pdf-v1' || !/^\d{20}$/.test(parsed.account) || !/^[A-Z]{3}$/.test(parsed.currency) || !Array.isArray(parsed.rows) || !parsed.rows.length || parsed.rows.length > 10000) fail('Неподдерживаемая выписка.');
  const accountHash = hash(parsed.account), identifiers = new Set();
  return parsed.rows.map(row => {
    const sourceKey = hash('uzum:' + parsed.account + ':' + row.documentDate + ':' + row.documentNumber);
    if (identifiers.has(sourceKey)) fail('Повтор номера документа в выписке.'); identifiers.add(sourceKey);
    const raw = JSON.stringify(row.fragments), details = row.details;
    let kind = 'unknown', state = 'review', reason = 'Нужно определить тип операции.', category = '', purpose = '', merchant = 'Uzum Bank';
    if (/^Оплата (?:с карты|по карте)/i.test(details)) { kind = 'expense'; state = 'recorded'; reason = ''; merchant = /YANDEXGO/i.test(details) ? 'Яндекс Go' : 'Магазин · MID ' + (details.match(/\bMID\s+(\w+)/)?.[1] || 'не указан'); }
    else if (/^Зачисление Кешбека/i.test(details)) { kind = 'income'; state = 'recorded'; reason = ''; category = 'Кешбэк'; purpose = 'Кешбэк'; }
    else if (/^Закрытие\/Списание со вклада на ПК/i.test(details)) { kind = 'transfer'; category = 'Свои деньги'; reason = 'Похоже на перевод со вклада на карту. Подтверди принадлежность обоих счетов.'; }
    else if (/возврат/i.test(details)) { category = 'Возврат покупки'; reason = 'Возврат нужно связать с исходной покупкой; пока он исключён из итогов.'; }
    else if (/P2P/i.test(details)) { category = 'Переводы'; reason = 'Уточни: это перевод между своими счетами или расчёт с другим человеком.'; }
    const uuid = sourceKey.slice(0, 8) + '-' + sourceKey.slice(8, 12) + '-' + sourceKey.slice(12, 16) + '-' + sourceKey.slice(16, 20) + '-' + sourceKey.slice(20, 32);
    const event = normaliseEvent({ id: uuid, fingerprint: 'bank:uzum:' + sourceKey, signature: null, source_type: 'bank_export', source_name: 'Uzum Bank · выписка', source_ref: 'uzum:account:' + accountHash,
      received_at: importedAt, event_millis: Date.parse(row.postingDate + 'T' + row.postingTime + '+05:00'), raw_title: filename, raw_text: raw, raw_fragment: raw,
      state, amount_minor: row.amountMinor, currency: parsed.currency, kind, date: row.postingDate, time: row.postingTime,
      merchant, card_suffix: details.match(/\d{6}\*{6}(\d{4})/)?.[1] || null, balance_minor: null, category, description: details.slice(0, 500), review_reason: reason, purpose,
      bank_operation: details.split(/\d{6}\*|\bMID/)[0].trim().slice(0, 120) });
    return { sourceKey, row, event };
  });
}

function paymeEvents(parsed, importedAt, filename) {
  if (!Array.isArray(parsed.rows) || !parsed.rows.length || parsed.rows.length > 10000) fail('Неподдерживаемый Excel Payme.');
  const ownCards = new Set(parsed.ownCards || []), identifiers = new Set(), anchors = new Set();
  return parsed.rows.map(row => {
    if (!Array.isArray(row.identity) || !Number.isInteger(row.occurrence) || row.occurrence < 1) fail('Не распознана строка Payme.');
    const sourceKey = hash('payme:' + JSON.stringify(row.identity) + ':' + row.occurrence);
    const matchKey = row.postingDate && row.postingTime ? hash('payme:match:' + JSON.stringify([row.identity[0], row.identity[1], row.identity[2], row.identity[3], row.identity[7]])) : null;
    if (identifiers.has(sourceKey)) fail('Повтор идентификатора строки Payme.'); identifiers.add(sourceKey);
    let state = 'review', kind = 'unknown', reason = 'Уточни назначение поступления: доход, возврат или перевод своих денег.';
    if (!row.paid) { state = 'ignored'; reason = 'Чек отменён в Payme. Сохранён и исключён из итогов.'; }
    else if (row.category.toLowerCase() === 'перевод') reason = 'Перевод: уточни принадлежность второго счёта и назначение. Пока исключён из итогов.';
    else if (row.operation === 'Списание') { kind = 'expense'; state = 'recorded'; reason = ''; }
    if (row.paid && (!row.cardSuffix || !ownCards.has(row.cardSuffix))) { state = 'review'; reason = row.cardSuffix ? 'Подтверди принадлежность карты ' + row.cardSuffix + ' перед учётом этой операции.' : 'Номер карты полностью скрыт в выгрузке. Уточни карту и назначение перед учётом.'; }
    if (row.paid && row.occurrence > 1) { state = 'duplicate'; reason = 'Несколько одинаковых строк без ID чека. Проверь, была ли это отдельная оплата.'; }
    if (row.paid && matchKey && anchors.has(matchKey)) { state = 'duplicate'; reason = 'Строки с одинаковыми временем, картой и поставщиком без ID чека. Уточни, отдельные ли это оплаты или изменение чека.'; }
    if (matchKey) anchors.add(matchKey);
    const id = sourceKey.slice(0, 8) + '-' + sourceKey.slice(8, 12) + '-' + sourceKey.slice(12, 16) + '-' + sourceKey.slice(16, 20) + '-' + sourceKey.slice(20, 32), raw = JSON.stringify(row.fragments);
    const event = normaliseEvent({ id, fingerprint: 'bank:payme:' + sourceKey, signature: null, source_type: 'bank_export', source_name: 'Payme · Excel', source_ref: 'payme:card:' + hash(String(row.identity[7])),
      received_at: importedAt, event_millis: row.postingDate ? Date.parse(row.postingDate + 'T' + (row.postingTime || '00:00:00') + '+05:00') : 0,
      raw_title: filename, raw_text: raw, raw_fragment: raw, state, amount_minor: row.amountMinor, currency: 'UZS', kind, date: row.postingDate, time: row.postingTime,
      merchant: row.merchant, card_suffix: row.cardSuffix, balance_minor: null, category: row.category, description: row.details.slice(0, 500), review_reason: reason, purpose: '', bank_operation: row.operation });
    return { sourceKey, row, event, matchKey };
  });
}

export function createImporter(store, directory, { parser = null } = {}) {
  const folder = path.join(directory, 'imports'); mkdirSync(folder, { recursive: true });
  store.db.exec(`CREATE TABLE IF NOT EXISTS bank_imports(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL,committed_at TEXT);
    CREATE TABLE IF NOT EXISTS bank_sources(source_key TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),row_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bank_import_rows(import_id TEXT NOT NULL REFERENCES bank_imports(id),source_key TEXT NOT NULL,event_id TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(import_id,source_key));
    CREATE TABLE IF NOT EXISTS bank_match_keys(match_key TEXT NOT NULL,source_key TEXT NOT NULL REFERENCES bank_sources(source_key),PRIMARY KEY(match_key,source_key));`);
  let busy = false;
  function getPrepared(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) fail('Некорректный импорт.');
    const record = store.db.prepare('SELECT * FROM bank_imports WHERE id=?').get(id);
    if (!record) fail('Импорт не найден.', 404);
    return { record, metadata: JSON.parse(record.metadata), items: JSON.parse(readFileSync(path.join(folder, id, 'parsed.json'), 'utf8')) };
  }
  function classify(item, existing) {
    const known = store.db.prepare('SELECT * FROM bank_sources WHERE source_key=?').get(item.sourceKey);
    const rowHash = hash(JSON.stringify(item.event.fingerprint.startsWith('bank:payme:') ? item.row.fragments[0].cells : [item.row.documentDate, item.row.documentNumber, item.row.postingDate, item.row.postingTime, item.row.amountMinor, item.row.details]));
    if (known) {
      if (known.row_hash !== rowHash) fail('Банк изменил уже импортированную строку. Нужна сверка исходников; прежняя запись сохранена.', 409);
      return { ...item, rowHash, eventId: known.event_id, status: 'existing' };
    }
    if (existing.some(event => event.fingerprint === item.event.fingerprint)) fail('Запись уже существует без связи с архивом выписки. Нужна сверка; существующая операция сохранена.', 409);
    if (item.matchKey && item.row.paid && store.db.prepare('SELECT 1 FROM bank_match_keys WHERE match_key=? LIMIT 1').get(item.matchKey)) return { ...item, rowHash, status: 'new', event: { ...item.event, state: 'duplicate', review_reason: 'В Payme уже есть строка с этим временем, картой и поставщиком. Сумма или статус изменились либо это другая оплата. Сверь исходные чеки; прежняя операция сохранена.' } };
    if (!item.event.time || item.event.kind === 'unknown' || item.event.state === 'ignored') return { ...item, rowHash, status: 'new' };
    const at = Date.parse((item.row.authorizationDate || item.event.date) + 'T' + (item.row.authorizationTime || item.event.time) + '+05:00');
    const possible = existing.filter(event => event.source_type !== 'bank_export' && !['ignored', 'duplicate'].includes(event.state) && event.amount_minor === item.event.amount_minor && event.currency === item.event.currency && event.card_suffix && event.card_suffix === item.event.card_suffix && Math.abs(Date.parse(event.date + 'T' + (event.time || '00:00') + '+05:00') - at) <= 120000);
    if (possible.length) return { ...item, rowHash, status: 'new', event: { ...item.event, state: 'duplicate', review_reason: 'Возможный повтор ранее полученной операции: ' + possible.map(row => row.id).slice(0, 3).join(', ') } };
    return { ...item, rowHash, status: 'new' };
  }
  function preview(id) {
    const prepared = getPrepared(id), existing = store.all(false), items = prepared.items.map(item => classify(item, existing));
    const summary = { total: items.length, existing: 0, recorded: 0, review: 0, duplicates: 0, ignored: 0 };
    for (const item of items) { if (item.status === 'existing') summary.existing++; else if (item.event.state === 'recorded') summary.recorded++; else if (item.event.state === 'duplicate') summary.duplicates++; else if (item.event.state === 'ignored') summary.ignored++; else summary.review++; }
    return { id, ...prepared.metadata, committed: !!prepared.record.committed_at, summary, rows: items.map(item => ({ id: item.event.id, date: item.event.date, time: item.event.time, merchant: item.event.merchant, amountMinor: item.event.amount_minor, currency: item.event.currency, kind: item.event.kind, state: item.event.state, reason: item.event.review_reason, existing: item.status === 'existing' })) };
  }
  async function upload(input) {
    if (busy) fail('Предыдущая выписка ещё разбирается. Подожди завершения.', 409);
    if (typeof input.filename !== 'string' || input.filename.length > 200 || !/\.(?:pdf|xlsx)$/i.test(input.filename) || typeof input.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) fail('Выбери исходный PDF банка или Excel Payme.');
    const excel = /\.xlsx$/i.test(input.filename), bank = input.bank || (excel ? 'payme' : 'uzum');
    if (!['uzum', 'ipak', 'payme'].includes(bank) || (bank === 'payme') !== excel || (input.cardSuffix && !/^\d{4}$/.test(input.cardSuffix))) fail('Проверь формат файла, источник и последние четыре цифры карты.');
    const ownCards = input.ownCards || [];
    if (!Array.isArray(ownCards) || ownCards.length > 20 || ownCards.some(card => typeof card !== 'string' || !/^\d{4}$/.test(card))) fail('Свои карты: только последние четыре цифры, максимум 20 карт.');
    const bytes = Buffer.from(input.data, 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024 || (excel ? bytes.subarray(0, 4).toString('hex') !== '504b0304' : bytes.subarray(0, 5).toString() !== '%PDF-')) fail('Нужен исходный PDF или XLSX размером до 5 МБ.');
    busy = true;
    try {
      const id = randomUUID(), target = path.join(folder, id), at = new Date().toISOString(); mkdirSync(target);
      const file = path.join(target, excel ? 'source.xlsx' : 'source.pdf'); writeFileSync(file, bytes, { flag: 'wx' });
      let parsed;
      if (parser) parsed = await parser(file, bank);
      else {
        const config = path.join(root, '.tools/pdf-runtime.json');
        const python = process.env.FINANCE_PDF_PYTHON || (existsSync(config) ? JSON.parse(readFileSync(config, 'utf8')).python : 'python');
        let output;
        try { output = await execute(python, ['-X', 'utf8', path.join(root, 'web/parse_bank.py'), file, bank, path.basename(input.filename.replaceAll('\\', '/'))], { timeout: 90000, maxBuffer: 24 * 1024 * 1024, windowsHide: true }); }
        catch (error) { let message; try { message = JSON.parse(error.stdout).error; } catch { message = 'Не удалось разобрать PDF. Проверь Python с библиотекой pdfplumber или выбери меньший период.'; } fail(message); }
        parsed = JSON.parse(output.stdout);
      }
      parsed.fileSha256 = hash(bytes); parsed.cardSuffix = input.cardSuffix || null; parsed.ownCards = ownCards;
      const name = path.basename(input.filename.replaceAll('\\', '/')), items = statementEvents(parsed, at, name), ipak = parsed.source === 'ipak-history-pdf-v1';
      const metadata = { source: excel ? 'Payme' : ipak ? 'Ipak Yuli' : 'Uzum Bank', filename: name, sha256: hash(bytes), bytes: bytes.length, period: parsed.period, coverage: parsed.coverage || null, pages: parsed.pages || null, sheets: parsed.sheets || null, accountSuffix: parsed.account?.slice(-4) || null, cardSuffix: parsed.cardSuffix, currency: parsed.currency || null,
        note: excel ? 'Категории, магазины, даты и время сохранены из Payme. Суммы — UZS. Переводы, скрытые и неподтверждённые карты требуют проверки; отменённые чеки исключены. В Excel нет ID чека: повторные выгрузки сверяются по неизменившимся данным строки, исправленные суммы и статусы требуют отдельной сверки.' : ipak ? 'В этой истории нет номера карты, направления, времени и ID операции. Все ненулевые строки требуют проверки. Точный повтор файла не добавится снова; разные выгрузки нужно сверять отдельно. Валюты сохраняются раздельно.' : 'Даты в таблице — даты проведения банком. Свежие оплаты могут попасть в следующую выписку после обработки. Переводы и возвраты требуют проверки.' };
      writeFileSync(path.join(target, 'parsed.json'), JSON.stringify(items), { flag: 'wx' });
      writeFileSync(path.join(target, 'source.json'), JSON.stringify(metadata, null, 2), { flag: 'wx' });
      store.db.prepare('INSERT INTO bank_imports VALUES(?,?,?,?,NULL)').run(id, metadata.sha256, JSON.stringify(metadata), at);
      return preview(id);
    } finally { busy = false; }
  }
  function commit(id) { return store.transaction(() => {
    const prepared = getPrepared(id), existing = store.all(false); let inserted = 0, skipped = 0;
    if (prepared.record.committed_at) return { id, inserted: 0, skipped: prepared.items.length, repeated: true };
    for (const source of prepared.items) {
      const item = classify(source, existing); let eventId;
      if (item.status === 'existing') { skipped++; eventId = item.eventId; }
      else { const event = store.save(item.event, 'import:bank-export'); eventId = event.id; inserted++; store.db.prepare('INSERT INTO bank_sources VALUES(?,?,?)').run(item.sourceKey, event.id, item.rowHash); }
      if (item.matchKey) store.db.prepare('INSERT OR IGNORE INTO bank_match_keys VALUES(?,?)').run(item.matchKey, item.sourceKey);
      store.db.prepare('INSERT INTO bank_import_rows VALUES(?,?,?,?)').run(id, item.sourceKey, eventId, item.status);
    }
    store.db.prepare('UPDATE bank_imports SET committed_at=? WHERE id=?').run(new Date().toISOString(), id);
    return { id, inserted, skipped, repeated: false };
  }); }
  return { upload, preview, commit };
}
