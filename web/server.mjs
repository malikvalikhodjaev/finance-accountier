import http from 'node:http';
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, hash, fail, selectRows, aggregate, editableKeys, normaliseEvent } from './store.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
const token = () => randomBytes(32).toString('base64url');
const privateIP = ip => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip);
export function createFinanceServer({ directory = path.join(root, '.web'), allowLocalLogin = true, advertisedHost = null, port = 8788 } = {}) {
  mkdirSync(directory, { recursive: true });
  const store = createStore(path.join(directory, 'money.sqlite'));
  const credentialsPath = path.join(directory, 'auth.json');
  if (!existsSync(credentialsPath)) {
    const password = token(), salt = randomBytes(16).toString('hex');
    writeFileSync(credentialsPath, JSON.stringify({ salt, hash: scryptSync(password, salt, 32).toString('hex') }), { flag: 'wx' });
    writeFileSync(path.join(directory, 'admin-password.txt'), password + '\n', { flag: 'wx' });
  }
  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  if (!credentials.serverId) { credentials.serverId = token(); writeFileSync(credentialsPath, JSON.stringify(credentials)); }
  const addresses = [...new Set(Object.values(networkInterfaces()).flat().filter(item => item.family === 'IPv4' && !item.internal && privateIP(item.address)).map(item => item.address))];
  const host = advertisedHost || addresses[0] || '127.0.0.1';
  const allowedHosts = new Set(['127.0.0.1', 'localhost', ...addresses, ...(advertisedHost ? [advertisedHost] : [])]);
  const attempts = new Map();
  function rate(key, limit = 8) {
    const now = Date.now(), previous = attempts.get(key);
    const entry = previous && now - previous.at < 60000 ? previous : { at: now, count: 0 };
    entry.count++; attempts.set(key, entry);
    if (entry.count > limit) fail('Слишком много попыток. Подожди минуту.', 429);
    if (attempts.size > 1000) for (const [id, value] of attempts) if (now - value.at >= 60000) attempts.delete(id);
  }
  function session(res, deviceId = null) {
    const value = token(), expires = Date.now() + 7 * 86400000;
    store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(value), deviceId, expires);
    res.setHeader('Set-Cookie', 'rhythm_session=' + value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800');
  }
  function auth(req) {
    const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (bearer) {
      const device = store.db.prepare('SELECT * FROM devices WHERE token_hash=? AND revoked=0').get(hash(bearer));
      if (device) { store.db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(new Date().toISOString(), device.id); return { deviceId: device.id, mobile: true }; }
      return null;
    }
    const value = req.headers.cookie?.match(/(?:^|;\s*)rhythm_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
    if (!value) return null;
    const row = store.db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(hash(value), Date.now());
    if (!row || row.device_id && !store.db.prepare('SELECT 1 FROM devices WHERE id=? AND revoked=0').get(row.device_id)) return null;
    return { deviceId: row.device_id, mobile: false };
  }
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) fail('Нужен JSON.');
    let size = 0, chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) fail('Слишком большой запрос.', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('Некорректный JSON.'); }
  }
  function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://' + req.headers.host);
      if (!allowedHosts.has(url.hostname)) fail('Этот адрес не разрешён.', 403);
      const identity = auth(req);
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.headers.origin && req.headers.origin !== url.origin) fail('Запрос пришёл с другого сайта.', 403);
        if (req.headers['sec-fetch-site'] === 'cross-site') fail('Запрос пришёл с другого сайта.', 403);
      }
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { service: 'rhythm-money-web', version: 1 });
      if (req.method === 'POST' && url.pathname === '/api/login') {
        rate('login:' + req.socket.remoteAddress); const input = await body(req);
        if (typeof input.password !== 'string' || input.password.length > 200 || !timingSafeEqual(scryptSync(input.password, credentials.salt, 32), Buffer.from(credentials.hash, 'hex'))) fail('Неверный пароль.', 401);
        session(res); return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/pair') {
        rate('pair:' + req.socket.remoteAddress, 5); rate('pair-global', 20); const input = await body(req);
        if (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code) || typeof input.label !== 'string' || input.label.length > 100) fail('Неверный код подключения.', 401);
        const paired = store.transaction(() => {
          const row = store.db.prepare('SELECT * FROM pairing WHERE hash=? AND expires>?').get(hash(input.code), Date.now()); if (!row) fail('Код не найден или истёк.', 401);
          const id = token(), secret = token(); store.db.prepare('DELETE FROM pairing WHERE hash=?').run(row.hash);
          store.db.prepare('INSERT INTO devices(id,label,token_hash,created_at) VALUES(?,?,?,?)').run(id, input.label || 'Android', hash(secret), new Date().toISOString());
          return { deviceId: id, token: secret, serverId: credentials.serverId, url: 'http://' + host + ':' + port };
        });
        return json(res, 201, paired);
      }
      if (req.method === 'GET' && url.pathname === '/mobile-login') {
        const ticket = url.searchParams.get('ticket') || '';
        if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) fail('Ссылка подключения недействительна.', 401);
        const row = store.db.prepare('SELECT * FROM tickets WHERE hash=? AND expires>?').get(hash(ticket), Date.now());
        if (!row || !store.db.prepare('SELECT 1 FROM devices WHERE id=? AND revoked=0').get(row.device_id)) fail('Ссылка подключения истекла.', 401);
        store.db.prepare('DELETE FROM tickets WHERE hash=?').run(row.hash); session(res, row.device_id); res.writeHead(303, { Location: url.searchParams.get('tab') === 'dashboard' ? '/?tab=dashboard' : '/' }); return res.end();
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && assets[url.pathname]) {
        const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if (url.pathname === '/' && !identity && allowLocalLogin && loopback && ['127.0.0.1', 'localhost'].includes(url.hostname)) session(res);
        const [name, type] = assets[url.pathname]; res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); return res.end(req.method === 'HEAD' ? undefined : readFileSync(path.join(root, 'web/public', name)));
      }
      if (!identity) fail('Нужно подключить телефон или войти.', 401);
      if (req.method === 'POST' && url.pathname === '/api/mobile/browser-session') {
        if (!identity.mobile) fail('Нужен подключённый телефон.', 403);
        const value = token(); store.db.prepare('INSERT INTO tickets VALUES(?,?,?)').run(hash(value), identity.deviceId, Date.now() + 60000); return json(res, 200, { path: '/mobile-login?ticket=' + value });
      }
      if (req.method === 'POST' && url.pathname === '/api/sync') {
        if (!identity.mobile) fail('Нужен подключённый телефон.', 403);
        return json(res, 200, store.sync(await body(req), identity.deviceId));
      }
      if (identity.mobile) fail('Открой таблицы внутри приложения.', 403);
      if (req.method === 'POST' && url.pathname === '/api/logout') { const value = req.headers.cookie?.match(/rhythm_session=([A-Za-z0-9_-]{43})/)?.[1]; if (value) store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(value)); res.setHeader('Set-Cookie', 'rhythm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
      if (req.method === 'GET' && url.pathname === '/api/meta') {
        const rows = store.all(); return json(res, 200, { fields: store.settings('field'), views: store.settings('view'), dashboards: store.settings('dashboard'), currencies: [...new Set(rows.map(row => row.currency).filter(Boolean))].sort(), categories: [...new Set(rows.map(row => row.category).filter(Boolean))].sort(), devices: store.db.prepare('SELECT id,label,created_at,last_seen,revoked FROM devices').all(), count: rows.length, conflicts: store.db.prepare('SELECT COUNT(*) count FROM conflicts WHERE resolved=0').get().count, url: 'http://' + host + ':' + port });
      }
      if (req.method === 'POST' && url.pathname === '/api/pairing') {
        const code = String(randomInt(100000, 1000000)); store.db.prepare('DELETE FROM pairing').run(); store.db.prepare('INSERT INTO pairing VALUES(?,?)').run(hash(code), Date.now() + 300000); return json(res, 201, { code, expiresAt: Date.now() + 300000, url: 'http://' + host + ':' + port });
      }
      if (req.method === 'POST' && url.pathname === '/api/device/revoke') {
        const input = await body(req); store.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(input.id); store.db.prepare('DELETE FROM sessions WHERE device_id=?').run(input.id); return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const rows = selectRows(store.all(), Object.fromEntries(url.searchParams)); const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0), limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100)); return json(res, 200, { rows: rows.slice(offset, offset + limit), total: rows.length });
      }
      if (req.method === 'POST' && url.pathname === '/api/events') return json(res, 201, store.manual(await body(req)));
      if (/^\/api\/events\/[a-f0-9-]{36}$/.test(url.pathname)) {
        const id = url.pathname.split('/').at(-1);
        if (req.method === 'GET') return json(res, 200, { row: store.get(id), history: store.db.prepare('SELECT version,actor,at,data FROM history WHERE event_id=? ORDER BY version DESC').all(id), sourceHistory: store.db.prepare('SELECT changed_at,previous_json FROM source_revisions WHERE event_id=? ORDER BY changed_at DESC').all(id) });
        if (req.method === 'PATCH') return json(res, 200, store.edit(id, await body(req), identity.deviceId || 'web'));
      }
      if (req.method === 'POST' && /^\/api\/(fields|views|dashboards)$/.test(url.pathname)) return json(res, 200, store.setting({ fields: 'field', views: 'view', dashboards: 'dashboard' }[url.pathname.split('/').at(-1)], await body(req)));
      if (req.method === 'GET' && url.pathname === '/api/dashboard') {
        const board = store.settings('dashboard').find(item => item.id === url.searchParams.get('id')) || store.settings('dashboard')[0], rows = store.all(), filters = Object.fromEntries(url.searchParams);
        return json(res, 200, { board, widgets: board.widgets.map(widget => ({ ...widget, data: aggregate(rows, { ...widget, viewFilters: widget.viewId ? store.settings('view').find(view => view.id === widget.viewId)?.filters : null }, filters) })) });
      }
      if (req.method === 'GET' && url.pathname === '/api/conflicts') return json(res, 200, { conflicts: store.db.prepare('SELECT * FROM conflicts WHERE resolved=0 ORDER BY created_at DESC').all().map(row => ({ ...row, incoming: JSON.parse(row.incoming), fields: JSON.parse(row.fields), current: store.get(row.event_id) })) });
      if (req.method === 'POST' && url.pathname === '/api/conflicts/resolve') {
        const input = await body(req); const conflict = store.db.prepare('SELECT * FROM conflicts WHERE id=? AND resolved=0').get(input.id); if (!conflict) fail('Конфликт уже разобран.', 409);
        if (!['server', 'phone'].includes(input.choice)) fail('Выбери вариант.'); const current = store.get(conflict.event_id); if (current.version !== input.expectedVersion) fail('Операция изменилась. Перечитай варианты.', 409);
        const resolved = store.transaction(() => { let row = current; if (input.choice === 'phone') { const incoming = JSON.parse(conflict.incoming), event = normaliseEvent(current); for (const key of JSON.parse(conflict.fields)) event[key] = incoming[key]; row = store.save(event, 'conflict:phone'); } store.db.prepare('UPDATE conflicts SET resolved=1 WHERE id=?').run(conflict.id); return { row }; });
        return json(res, 200, resolved);
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        const rows = selectRows(store.all(), Object.fromEntries(url.searchParams)), fields = store.settings('field').filter(field => field.active), columns = ['id', 'date', 'time', 'merchant', 'amount', 'currency', 'kind', 'category', 'purpose', 'description', 'state', ...fields.map(field => field.id)];
        const cell = value => '"' + (/^\s*[=+\-@]/.test(String(value)) ? "'" : '') + String(value ?? '').replaceAll('"', '""') + '"';
        const csv = [columns.map(key => cell(fields.find(field => field.id === key)?.name || key)).join(','), ...rows.map(row => columns.map(key => cell(key === 'amount' ? row.amount_minor === null ? '' : (BigInt(row.amount_minor) / 100n) + '.' + String(BigInt(row.amount_minor) % 100n).padStart(2, '0') : key.startsWith('f_') ? row.custom[key] ?? '' : row[key] ?? '')).join(','))].join('\r\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="rhythm-money.csv"' }); return res.end('\uFEFF' + csv);
      }
      if (req.method === 'GET' && url.pathname === '/api/backup') { res.setHeader('Content-Disposition', 'attachment; filename="rhythm-money-backup.json"'); return json(res, 200, { schema: 'rhythm-money-web-v1', exportedAt: new Date().toISOString(), events: store.all(), history: store.db.prepare('SELECT * FROM history').all(), sourceRevisions: store.db.prepare('SELECT * FROM source_revisions').all(), fields: store.settings('field'), views: store.settings('view'), dashboards: store.settings('dashboard') }); }
      fail('Страница не найдена.', 404);
    } catch (error) {
      if (!error.status && !(error instanceof SyntaxError)) console.error(error);
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Не удалось обработать запрос.', details: error.details || null }); else res.end();
    }
  }
  const server = http.createServer(handler); server.requestTimeout = 30000; server.headersTimeout = 10000;
  return { server, store, host, close: () => new Promise(resolve => server.close(() => { store.close(); resolve(); })) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.FINANCE_PORT || 8788);
  const app = createFinanceServer({ port, directory: process.env.FINANCE_DATA_DIR || path.join(root, '.web'), advertisedHost: process.env.FINANCE_HOST || null });
  app.server.listen(port, '0.0.0.0', () => { writeFileSync(path.join(root, '.web', 'server.json'), JSON.stringify({ port, url: 'http://' + app.host + ':' + port, pid: process.pid })); console.log('Ритм · деньги: http://127.0.0.1:' + port + '\nНа телефоне: http://' + app.host + ':' + port); });
  app.server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Порт занят; проверь уже запущенный финансовый сервер.' : error.message); app.store.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
