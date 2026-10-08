'use strict';
const app = document.querySelector('#app'), dialog = document.querySelector('#dialog'), dialogForm = document.querySelector('#dialog-form'), content = document.querySelector('#dialog-content'), dialogError = document.querySelector('#dialog-error');
const names = { date: 'Дата', time: 'Время', merchant: 'Магазин / сервис', amount_minor: 'Сумма', currency: 'Валюта', kind: 'Тип', category: 'Категория', purpose: 'На что', state: 'Учёт', description: 'Описание', source_name: 'Источник', card_suffix: 'Карта', balance_minor: 'Остаток' };
const kinds = { expense: 'Расход', income: 'Доход', transfer: 'Свои деньги', unknown: 'Уточнить' }, statuses = { recorded: 'Учтено', review: 'Уточнить', duplicate: 'Возможный повтор', ignored: 'Исключено' };
const defaults = ['date', 'merchant', 'amount_minor', 'currency', 'kind', 'category', 'purpose', 'state'];
const state = { meta: null, tab: new URL(location.href).searchParams.get('tab') === 'dashboard' ? 'dashboard' : 'table', filters: { period: 'all' }, columns: [...defaults], viewId: '', boardId: 'main', rows: [], total: 0, offset: 0, generation: 0 };
let saveDialog, timer, tablePanel;
function el(tag, properties = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(properties)) {
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (['value', 'checked', 'disabled'].includes(key)) element[key] = value;
    else if (value !== false && value != null) element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return element;
}
const button = (text, action, quiet = false) => el('button', { type: 'button', text, class: quiet ? 'quiet' : '', onclick: () => Promise.resolve(action()).catch(error => message(error.message)) });
function message(text) { const box = document.querySelector('#message'); box.textContent = text; box.style.display = 'block'; clearTimeout(timer); timer = setTimeout(() => box.style.display = 'none', 7000); }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Не удалось выполнить запрос.'); error.status = response.status; error.details = data.details; throw error; }
  return data;
}
function money(value) {
  if (value === null || value === undefined || value === '') return '—';
  const minor = BigInt(value), integer = minor / 100n, cents = String(minor % 100n).padStart(2, '0');
  return new Intl.NumberFormat('ru-RU').format(integer) + ',' + cents;
}
function amountInput(value) { return value == null ? '' : String(BigInt(value) / 100n) + '.' + String(BigInt(value) % 100n).padStart(2, '0'); }
function minor(value) {
  const text = value.trim().replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) throw new Error('Сумма: число больше нуля, до двух знаков после запятой.');
  const [integer, fraction = ''] = text.split('.'), amount = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount <= 0n || amount > 100000000000000n) throw new Error('Проверь сумму.');
  return Number(amount);
}
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function select(options, value = '') { const control = el('select'); for (const [key, label] of options) control.append(el('option', { value: key, text: label })); control.value = value; return control; }
function field(label, control, full = false) { return el('label', { class: 'field' + (full ? ' full' : '') }, el('span', { text: label }), control); }
function modal(title, body, callback, saveLabel = 'Сохранить') {
  content.replaceChildren(el('h2', { text: title }), body); dialogError.textContent = ''; document.querySelector('#dialog-save').textContent = saveLabel; document.querySelector('#dialog-save').hidden = !callback; saveDialog = callback; dialog.showModal();
}
document.querySelector('#dialog-cancel').onclick = () => dialog.close();
dialogForm.onsubmit = async event => {
  event.preventDefault(); if (!saveDialog) return;
  const save = document.querySelector('#dialog-save'); save.disabled = true; dialogError.textContent = '';
  try { await saveDialog(); dialog.close(); } catch (error) { dialogError.textContent = error.message; }
  finally { save.disabled = false; }
};
async function loadMeta() { state.meta = await api('/api/meta'); }
function filterForm(onChange) {
  const form = el('div', { class: 'filters' });
  const period = select([['all', 'Вся история'], ['7', 'Последние 7 дней'], ['30', 'Последние 30 дней'], ['month', 'Этот месяц']], state.filters.period);
  const search = el('input', { type: 'search', value: state.filters.search || '', 'aria-label': 'Поиск в операциях' });
  const currency = select([['', 'Все валюты'], ...state.meta.currencies.map(code => [code, code])], state.filters.currency || '');
  const kind = select([['', 'Все типы'], ...Object.entries(kinds)], state.filters.kind || '');
  const status = select([['', 'Все состояния'], ...Object.entries(statuses)], state.filters.state || '');
  const from = el('input', { type: 'date', value: state.filters.from || '', 'aria-label': 'Начальная дата' }), to = el('input', { type: 'date', value: state.filters.to || '', 'aria-label': 'Конечная дата' });
  const category = select([['', 'Все категории'], ...state.meta.categories.map(value => [value, value])], state.filters.category || '');
  const controls = { period, currency, kind, state: status, from, to, category };
  for (const [key, control] of Object.entries(controls)) control.onchange = () => { state.filters[key] = control.value; if (key === 'period') { state.filters.from = ''; state.filters.to = ''; from.value = ''; to.value = ''; } state.viewId = ''; onChange(); };
  let debounce; search.oninput = () => { state.filters.search = search.value; state.viewId = ''; clearTimeout(debounce); debounce = setTimeout(onChange, 250); };
  for (const [label, control] of [['Период', period], ['Поиск', search], ['Валюта', currency], ['Тип', kind], ['Учёт', status], ['С даты', from], ['По дату', to], ['Категория', category]]) { const item = el('label', { class: control === search ? 'search' : '' }, label, control); form.append(item); }
  return form;
}
function query(filters = state.filters) { return new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value != null)); }
function name(key) { return names[key] || state.meta.fields.find(field => field.id === key)?.name || key; }
async function render() {
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === state.tab);
  app.replaceChildren(); state.generation++;
  if (state.tab === 'table') renderTable(); else renderDashboard();
}
function renderTable() {
  const view = select([['', 'Текущее представление'], ...state.meta.views.map(item => [item.id, item.name])], state.viewId);
  view.onchange = () => { const item = state.meta.views.find(v => v.id === view.value); if (!item) return; state.viewId = item.id; state.filters = { ...item.filters }; state.columns = [...item.columns]; render(); };
  const actions = el('div', { class: 'actions' }, button('Добавить операцию', () => editRow(null)), button('Своя колонка', addField, true), button('Колонки', chooseColumns, true), button('Сохранить вид', saveView, true), button('CSV', () => location.href = '/api/export?' + query(), true));
  app.append(el('div', { class: 'toolbar' }, el('div', { class: 'row' }, el('h1', { text: 'Операции' }), view), actions));
  if (state.meta.conflicts) app.append(button('Разобрать конфликты: ' + state.meta.conflicts, showConflicts, true));
  app.append(filterForm(() => loadRows(false))); tablePanel = el('section', { 'aria-label': 'Таблица операций' }); app.append(tablePanel); loadRows(false).catch(error => { tablePanel.replaceChildren(el('p', { text: error.message })); });
}
async function loadRows(append = false) {
  const generation = state.generation, requestId = state.rowsRequest = (state.rowsRequest || 0) + 1;
  if (!append) state.offset = 0;
  const params = query(); params.set('offset', String(state.offset));
  const data = await api('/api/events?' + params);
  if (generation !== state.generation || requestId !== state.rowsRequest || state.tab !== 'table') return;
  state.rows = append ? [...state.rows, ...data.rows] : data.rows; state.total = data.total; state.offset = state.rows.length;
  tablePanel.replaceChildren();
  tablePanel.append(el('div', { class: 'summary-line' }, el('span', { text: 'Записей: ' + state.total + ' · На экране: ' + state.rows.length }), el('span', { text: state.meta.devices.filter(device => !device.revoked).length ? 'Телефон подключён к общей базе' : 'Подключи телефон, чтобы операции появлялись автоматически' })));
  if (!state.rows.length) { tablePanel.append(el('div', { class: 'table-wrap empty' }, el('h2', { text: state.meta.count ? 'По этому фильтру операций нет' : 'Операции появятся здесь' }), el('p', { text: state.meta.count ? 'Измени период или фильтры.' : 'Подключи телефон через кнопку «Подключение». Можно также добавить наличную операцию вручную.' }))); return; }
  const visible = state.columns.filter(key => names[key] || state.meta.fields.some(field => field.id === key && field.active));
  const head = el('tr', {}, ...visible.map(key => el('th', { scope: 'col', text: name(key) })), el('th', { scope: 'col', text: 'Действие' }));
  const body = el('tbody');
  for (const row of state.rows) {
    const tr = el('tr');
    for (const key of visible) {
      let value = key.startsWith('f_') ? row.custom[key] : row[key];
      if (['amount_minor', 'balance_minor'].includes(key)) value = money(value);
      else if (key === 'kind') value = kinds[value] || '—';
      else if (key === 'state') value = el('span', { class: 'pill ' + row.state, text: statuses[row.state] });
      else if (typeof value === 'boolean') value = value ? 'Да' : 'Нет';
      tr.append(el('td', { class: ['amount_minor', 'balance_minor'].includes(key) ? 'amount' : ['merchant', 'purpose', 'description'].includes(key) ? 'text-cell' : '' }, value ?? '—'));
    }
    tr.append(el('td', {}, button('Открыть', () => editRow(row.id), true))); body.append(tr);
  }
  tablePanel.append(el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, head), body)));
  if (state.rows.length < state.total) tablePanel.append(button('Показать ещё', () => loadRows(true), true));
}
async function editRow(id) {
  const detail = id ? await api('/api/events/' + id) : null, row = detail?.row || { date: today(), amount_minor: null, currency: 'UZS', kind: 'expense', state: 'recorded', category: '', purpose: '', merchant: '', description: '', custom: {} };
  const form = el('div', { class: 'form-grid' }), controls = {};
  controls.amount = el('input', { value: amountInput(row.amount_minor), inputmode: 'decimal', required: row.state === 'recorded' });
  controls.currency = el('input', { value: row.currency || 'UZS', maxlength: '3', required: true });
  controls.date = el('input', { type: 'date', value: row.date || today(), required: true });
  controls.kind = select(Object.entries(kinds), row.kind || 'unknown'); controls.state = select(Object.entries(statuses), row.state);
  controls.state.onchange = () => controls.amount.required = controls.state.value === 'recorded';
  for (const key of ['merchant', 'category', 'purpose', 'description']) controls[key] = el(key === 'description' ? 'textarea' : 'input', { value: row[key] || '', maxlength: key === 'purpose' ? '240' : key === 'category' ? '120' : '500' });
  for (const [label, key] of [['Сумма', 'amount'], ['Валюта', 'currency'], ['Дата', 'date'], ['Тип', 'kind'], ['Учёт', 'state'], ['Магазин / сервис', 'merchant'], ['Категория', 'category'], ['На что', 'purpose'], ['Описание', 'description']]) form.append(field(label, controls[key], key === 'description'));
  const customControls = {};
  for (const item of state.meta.fields.filter(field => field.active)) {
    const value = row.custom?.[item.id];
    const control = item.type === 'select' ? select([['', 'Не указано'], ...item.options.map(value => [value, value]), ...(value && !item.options.includes(value) ? [[value, value + ' (из прежнего списка)']] : [])], value || '') : el('input', { type: item.type === 'checkbox' ? 'checkbox' : item.type === 'date' ? 'date' : item.type === 'number' ? 'number' : 'text', value: item.type === 'checkbox' ? 'yes' : value ?? '', checked: item.type === 'checkbox' && !!value, step: item.type === 'number' ? 'any' : null });
    customControls[item.id] = control; form.append(field(item.name, control));
  }
  const wrapper = el('div', {}, form);
  if (row.raw_text) wrapper.append(el('details', {}, el('summary', { text: 'Исходное банковское сообщение' }), el('pre', { text: row.raw_text })));
  if (detail?.history.length) wrapper.append(el('details', {}, el('summary', { text: 'История изменений: ' + detail.history.length }), ...detail.history.map(item => { const previous = JSON.parse(item.data); return el('p', { class: 'subtle', text: new Date(item.at).toLocaleString('ru-RU') + ' · ' + (item.actor === 'web' ? 'Веб' : 'Телефон / синхронизация') + ' · ' + money(previous.amount_minor) + ' ' + (previous.currency || '') + ' · ' + (previous.category || '') + ' · ' + (previous.purpose || '') }); })));
  modal(id ? 'Исправить операцию' : 'Добавить операцию', wrapper, async () => {
    const event = Object.fromEntries(['date', 'kind', 'state', 'merchant', 'category', 'purpose', 'description'].map(key => [key, controls[key].value.trim()]));
    event.amount_minor = controls.amount.value.trim() ? minor(controls.amount.value) : null; event.currency = controls.currency.value.trim().toUpperCase();
    const custom = { ...(row.custom || {}) };
    for (const item of state.meta.fields.filter(field => field.active)) { const control = customControls[item.id]; custom[item.id] = item.type === 'checkbox' ? control.checked : item.type === 'number' ? control.value === '' ? null : Number(control.value) : control.value || null; }
    try { await api('/api/events' + (id ? '/' + id : ''), { method: id ? 'PATCH' : 'POST', body: { event, custom, ...(id ? { expectedVersion: row.version } : {}) } }); }
    catch (error) {
      if (error.status === 409 && error.details) {
        wrapper.append(el('div', { class: 'conflict-card' }, el('p', { text: 'Текущая запись: ' + money(error.details.amount_minor) + ' ' + error.details.currency + ' · ' + (error.details.category || '') + ' · ' + (error.details.purpose || '') }), button('Перечитать запись', async () => { dialog.close(); await editRow(id); }, true)));
      }
      throw error;
    }
    await loadMeta(); render(); message('Операция сохранена');
  });
}
function chooseColumns() {
  const list = el('div'), controls = new Map();
  for (const key of [...Object.keys(names), ...state.meta.fields.map(field => field.id)]) {
    const custom = state.meta.fields.find(field => field.id === key), check = el('input', { type: 'checkbox', checked: state.columns.includes(key) && custom?.active !== false, disabled: custom?.active === false }); controls.set(key, check);
    const line = el('p', { class: 'row' }, el('label', {}, check, ' ' + name(key) + (custom?.active === false ? ' (скрыта)' : ''))); if (custom) line.append(button('Настроить', () => { dialog.close(); addField(custom); }, true)); list.append(line);
  }
  modal('Колонки таблицы', list, () => { const selected = [...controls].filter(([, check]) => check.checked).map(([key]) => key); if (!selected.length) throw new Error('Выбери хотя бы одну колонку.'); state.columns = selected; state.viewId = ''; render(); });
}
function addField(existing = null) {
  const label = el('input', { required: true, maxlength: '80', value: existing?.name || '' }), type = select([['text', 'Текст'], ['number', 'Число'], ['date', 'Дата'], ['select', 'Выбор из списка'], ['checkbox', 'Да / нет']], existing?.type || 'text'), choices = el('textarea', { 'aria-label': 'Варианты выбора, по одному на строку', value: existing?.options?.join('\n') || '' }), active = el('input', { type: 'checkbox', checked: existing?.active !== false }); type.disabled = !!existing;
  const choicesField = field('Варианты, по одному на строку', choices, true); choicesField.hidden = type.value !== 'select'; type.onchange = () => choicesField.hidden = type.value !== 'select';
  const body = el('div', { class: 'form-grid' }, field('Название', label), field('Тип', type), choicesField); if (existing) body.append(el('label', { class: 'field full' }, el('span', { text: 'Использовать колонку; при скрытии данные сохраняются' }), active));
  modal(existing ? 'Настроить колонку' : 'Новая колонка', body, async () => {
    const result = await api('/api/fields', { method: 'POST', body: { name: label.value, type: type.value, active: active.checked, ...(existing ? { id: existing.id, expectedVersion: existing.version } : {}), ...(type.value === 'select' ? { options: [...new Set(choices.value.split('\n').map(value => value.trim()).filter(Boolean))] } : {}) } });
    if (result.active && !state.columns.includes(result.id)) state.columns.push(result.id); state.viewId = ''; await loadMeta(); render(); message(existing ? 'Колонка сохранена' : 'Колонка добавлена');
  });
}
function saveView() {
  const current = state.meta.views.find(view => view.id === state.viewId), label = el('input', { required: true, value: current?.name || 'Мои операции', maxlength: '80' }), replace = el('input', { type: 'checkbox', checked: !!current && current.id !== 'all' });
  const body = el('div', {}, field('Название представления', label)); if (current) body.append(el('p', {}, el('label', {}, replace, ' Обновить выбранное представление')));
  modal('Сохранить фильтры и колонки', body, async () => { const view = await api('/api/views', { method: 'POST', body: { name: label.value, filters: state.filters, columns: state.columns, ...(replace.checked && current ? { id: current.id, expectedVersion: current.version } : {}) } }); state.viewId = view.id; await loadMeta(); render(); message('Представление сохранено'); });
}
function renderDashboard() {
  const board = state.meta.dashboards.find(board => board.id === state.boardId) || state.meta.dashboards[0]; state.boardId = board.id;
  const selectBoard = select(state.meta.dashboards.map(item => [item.id, item.name]), state.boardId); selectBoard.onchange = () => { state.boardId = selectBoard.value; render(); };
  app.append(el('div', { class: 'toolbar' }, el('div', { class: 'row' }, el('h1', { text: 'Дашборды' }), selectBoard), el('div', { class: 'actions' }, button('Добавить виджет', () => editWidget(null)), button('Новый дашборд', newBoard, true))));
  let results = el('div', { class: 'boards' });
  const load = async () => {
    const generation = state.generation, params = query(); params.set('id', state.boardId); const response = await api('/api/dashboard?' + params);
    if (generation !== state.generation || state.tab !== 'dashboard') return;
    results.replaceChildren();
    for (const widget of response.widgets) {
      const card = el('section', { class: 'widget' }, el('h2', {}, el('span', { text: widget.name }), button('Настроить', () => editWidget(widget.id), true)));
      if (!widget.data.length) card.append(el('p', { class: 'subtle', text: 'Нет учтённых операций за этот период.' }));
      for (const item of widget.data) {
        const block = el('div', { class: 'currency-block' }, el('div', { class: 'metric' }, widget.metric === 'count' ? String(item.count) : money(item.amountMinor), el('small', { text: widget.metric === 'count' ? ' операций · ' + item.currency : ' ' + item.currency })));
        if (widget.group) {
          const bars = el('div', { class: 'bars' }), max = Math.max(1, ...item.groups.map(group => widget.metric === 'count' ? group.count : Number(group.amountMinor)));
          for (const group of item.groups) bars.append(el('div', {}, el('div', { class: 'bar-label' }, el('span', { text: group.label }), el('strong', { text: widget.metric === 'count' ? group.count : money(group.amountMinor) })), el('progress', { max, value: widget.metric === 'count' ? group.count : Number(group.amountMinor), 'aria-label': group.label })));
          block.append(bars);
        }
        card.append(block);
      }
      results.append(card);
    }
    if (!response.widgets.length) results.append(el('div', { class: 'widget empty' }, el('h2', { text: 'Добавь первый виджет' }), el('p', { text: 'Выбери сумму или количество, разрез и валюту.' })));
  };
  app.append(filterForm(() => load().catch(error => message(error.message))), results); state.refreshBoard = load; load().catch(error => results.replaceChildren(el('p', { text: error.message })));
}
function newBoard() {
  const label = el('input', { value: 'Мой дашборд', required: true, maxlength: '80' });
  modal('Новый дашборд', field('Название', label), async () => { const result = await api('/api/dashboards', { method: 'POST', body: { name: label.value, widgets: [] } }); state.boardId = result.id; await loadMeta(); render(); });
}
function editWidget(id) {
  const board = state.meta.dashboards.find(board => board.id === state.boardId), widget = board.widgets.find(widget => widget.id === id) || { name: 'Мои расходы', metric: 'expense', group: 'category', currency: '', viewId: '' };
  const label = el('input', { value: widget.name, required: true, maxlength: '80' }), metric = select([['expense', 'Сумма расходов'], ['income', 'Сумма доходов'], ['transfer', 'Перемещения своих денег'], ['count', 'Количество операций']], widget.metric), group = select([['', 'Общий итог'], ['category', 'Категории'], ['merchant', 'Магазины / сервисы'], ['day', 'Дни'], ['month', 'Месяцы'], ...state.meta.fields.filter(field => field.active).map(field => [field.id, field.name])], widget.group), currency = select([['', 'Все валюты, отдельно'], ...[...new Set(['UZS', 'USD', ...state.meta.currencies])].map(code => [code, code])], widget.currency), view = select([['', 'Фильтры дашборда'], ...state.meta.views.map(view => [view.id, view.name])], widget.viewId || '');
  const form = el('div', { class: 'form-grid' }, field('Название', label, true), field('Показатель', metric), field('Разбивка', group), field('Валюта', currency), field('Источник / представление', view));
  if (id) form.append(button('Удалить виджет', async () => { await api('/api/dashboards', { method: 'POST', body: { ...board, expectedVersion: board.version, widgets: board.widgets.filter(widget => widget.id !== id) } }); dialog.close(); await loadMeta(); render(); }, true));
  modal(id ? 'Настроить виджет' : 'Добавить виджет', form, async () => { const updated = { id: id || 'widget-' + Date.now() + '-' + Math.random().toString(16).slice(2), name: label.value, metric: metric.value, group: group.value, currency: currency.value, viewId: view.value }; const widgets = id ? board.widgets.map(widget => widget.id === id ? updated : widget) : [...board.widgets, updated]; await api('/api/dashboards', { method: 'POST', body: { ...board, expectedVersion: board.version, widgets } }); await loadMeta(); render(); });
}
async function connection() {
  const box = el('div', {}, el('p', { text: 'На телефоне: Ритм · деньги → Подключить общую таблицу. Введи адрес и код ниже.' }), el('p', { class: 'connection-url', text: state.meta.url }));
  const codeBox = el('div'); box.append(button('Получить код подключения', async () => { const result = await api('/api/pairing', { method: 'POST', body: {} }); codeBox.replaceChildren(el('p', { class: 'connection-code', text: result.code }), el('p', { class: 'subtle', text: 'Код действует 5 минут, для одного подключения.' })); }, true), codeBox);
  for (const device of state.meta.devices.filter(device => !device.revoked)) box.append(el('div', { class: 'device' }, el('strong', { text: device.label }), el('p', { class: 'subtle', text: device.last_seen ? 'Последняя связь: ' + new Date(device.last_seen).toLocaleString('ru-RU') : 'Первая синхронизация ещё не выполнена' }), button('Отключить устройство', async () => { await api('/api/device/revoke', { method: 'POST', body: { id: device.id } }); await loadMeta(); dialog.close(); message('Устройство отключено'); }, true)));
  box.append(el('p', { class: 'subtle', text: 'Общая база доступна, пока компьютер включён и сервер запущен. Сбор на телефоне работает без компьютера.' }), el('div', { class: 'row' }, button('Скачать резервную копию', () => location.href = '/api/backup', true), button('Выйти', async () => { await api('/api/logout', { method: 'POST', body: {} }); dialog.close(); login(); }, true)));
  modal('Подключение и данные', box, null);
}
async function showConflicts() {
  const result = await api('/api/conflicts'), list = el('div');
  for (const conflict of result.conflicts) {
    const card = el('div', { class: 'conflict-card' }, el('h2', { text: conflict.current.merchant || 'Операция' }));
    for (const key of conflict.fields) card.append(el('p', {}, el('strong', { text: name(key) }), el('div', { class: 'conflict-values' }, el('span', { text: 'На ПК: ' + (key === 'amount_minor' ? money(conflict.current[key]) : conflict.current[key] ?? '—') }), el('span', { text: 'На телефоне: ' + (key === 'amount_minor' ? money(conflict.incoming[key]) : conflict.incoming[key] ?? '—') }))));
    const resolve = async choice => { await api('/api/conflicts/resolve', { method: 'POST', body: { id: conflict.id, choice, expectedVersion: conflict.current.version } }); card.remove(); await loadMeta(); render(); message('Вариант сохранён; телефон получит его при синхронизации'); };
    card.append(el('div', { class: 'row' }, button('Оставить вариант ПК', () => resolve('server'), true), button('Взять вариант телефона', () => resolve('phone')))); list.append(card);
  }
  if (!result.conflicts.length) list.append(el('p', { text: 'Конфликтов нет.' })); modal('Одновременные изменения', list, null);
}
function login() {
  const password = el('input', { type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Пароль' }), error = el('p', { role: 'alert' }), form = el('form', {}, field('Пароль', password), el('button', { type: 'submit', text: 'Войти' }), error);
  form.onsubmit = async event => { event.preventDefault(); try { await api('/api/login', { method: 'POST', body: { password: password.value } }); await loadMeta(); render(); } catch (problem) { error.textContent = problem.message; } };
  app.replaceChildren(el('section', { class: 'login' }, el('h1', { text: 'Войти в Ритм · деньги' }), el('p', { text: 'На основном компьютере открой 127.0.0.1:8788. Телефон подключается кодом из окна «Подключение».' }), form));
}
for (const item of document.querySelectorAll('[data-tab]')) item.onclick = () => { if (!state.meta) return; state.tab = item.dataset.tab; history.replaceState(null, '', state.tab === 'table' ? '/' : '/?tab=dashboard'); render(); };
document.querySelector('#connect').onclick = () => state.meta ? connection() : login();
async function start() { try { await loadMeta(); render(); } catch (error) { if (error.status === 401) login(); else app.replaceChildren(el('p', { text: 'Компьютер недоступен: ' + error.message }), button('Повторить', start)); } }
start();
setInterval(async () => { if (!state.meta || dialog.open || document.hidden) return; try { await loadMeta(); if (state.tab === 'table') await loadRows(false); else if (state.refreshBoard) await state.refreshBoard(); } catch (error) { if (error.status === 401) { state.meta = null; login(); } } }, 20000);
