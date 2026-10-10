'use strict';
const app = document.querySelector('#app'), dialog = document.querySelector('#dialog'), dialogForm = document.querySelector('#dialog-form'), content = document.querySelector('#dialog-content'), dialogError = document.querySelector('#dialog-error');
const names = { date: 'Дата', time: 'Время', merchant: 'Магазин / отправитель', amount_minor: 'Сумма', currency: 'Валюта', kind: 'Тип', flow: 'Движение', category: 'Категория', purpose: 'На что', state: 'Учёт', description: 'Описание', source_name: 'Источник', card_suffix: 'Карта', balance_minor: 'Остаток' };
const kinds = { expense: 'Расход', income: 'Доход', transfer: 'Свои деньги', unknown: 'Уточнить' }, statuses = { recorded: 'Учтено', review: 'Уточнить', duplicate: 'Возможный повтор', ignored: 'Исключено' };
const flows = { incoming: 'Поступление', outgoing: 'Списание', unknown: 'Не определено' };
const defaults = ['date', 'merchant', 'amount_minor', 'currency', 'kind', 'category', 'purpose', 'state'];
const initialTab = new URL(location.href).searchParams.get('tab');
const embedded = new URL(location.href).searchParams.get('embedded') === '1';
if (embedded) document.documentElement.classList.add('embedded-app');
function route(tab, board = '') {
  const params = new URLSearchParams({ tab });
  if (board) params.set('board', board);
  if (embedded) params.set('embedded', '1');
  history.replaceState(null, '', '/?' + params);
}
const state = { meta: null, tab: ['table', 'orders'].includes(initialTab) ? initialTab : 'dashboard', filters: { period: 'all' }, columns: [...defaults], viewId: '', boardId: new URL(location.href).searchParams.get('board') || 'economy', chartGroup: 'month', chartCurrency: '', rows: [], total: 0, offset: 0, generation: 0 };
let saveDialog, timer, tablePanel, dialogGeneration = 0;
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
  const signed = BigInt(value), minor = signed < 0n ? -signed : signed, integer = minor / 100n, cents = String(minor % 100n).padStart(2, '0');
  return (signed < 0n ? '−' : '') + new Intl.NumberFormat('ru-RU').format(integer) + ',' + cents;
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
  dialogGeneration++;
  content.replaceChildren(el('h2', { text: title }), body); dialogError.textContent = ''; document.querySelector('#dialog-save').textContent = saveLabel; document.querySelector('#dialog-save').hidden = !callback; saveDialog = callback; dialog.showModal();
}
document.querySelector('#dialog-cancel').onclick = () => dialog.close();
dialogForm.onsubmit = async event => {
  event.preventDefault(); if (!saveDialog) return;
  const save = document.querySelector('#dialog-save'); if (save.disabled) return; save.disabled = true; dialogError.textContent = '';
  try { await saveDialog(); dialog.close(); } catch (error) { dialogError.textContent = error.message; dialogError.scrollIntoView({ block: 'nearest' }); }
  finally { save.disabled = false; }
};
async function loadMeta() { state.meta = await api('/api/meta'); }
function filterForm(onChange) {
  const form = el('div', { class: 'filters' });
  const period = select([['all', 'Вся история'], ['7', 'Последние 7 дней'], ['30', 'Последние 30 дней'], ['month', 'Этот месяц'], ['custom', 'Выбранные даты']], state.filters.from || state.filters.to ? 'custom' : state.filters.period || 'all');
  const search = el('input', { type: 'search', value: state.filters.search || '', 'aria-label': 'Поиск в операциях' });
  const currency = select([['', 'Все валюты'], ...state.meta.currencies.map(code => [code, code])], state.filters.currency || '');
  const kind = select([['', 'Все типы'], ...Object.entries(kinds)], state.filters.kind || '');
  const flow = select([['', 'Все движения'], ...Object.entries(flows)], state.filters.flow || '');
  const status = select([['', 'Все состояния'], ...Object.entries(statuses)], state.filters.state || '');
  const from = el('input', { type: 'date', value: state.filters.from || '', 'aria-label': 'Начальная дата' }), to = el('input', { type: 'date', value: state.filters.to || '', 'aria-label': 'Конечная дата' });
  const category = select([['', 'Все категории'], ...state.meta.categories.map(value => [value, value])], state.filters.category || '');
  const controls = { period, currency, kind, flow, state: status, from, to, category };
  for (const [key, control] of Object.entries(controls)) control.onchange = () => {
    state.filters[key] = control.value;
    if (key === 'period') {
      if (control.value === 'custom') disclosure.open = true;
      else { state.filters.from = ''; state.filters.to = ''; from.value = ''; to.value = ''; }
    }
    if (key === 'from' || key === 'to') { state.filters.period = 'custom'; period.value = 'custom'; }
    state.viewId = ''; onChange();
  };
  let debounce; search.oninput = () => { state.filters.search = search.value; state.viewId = ''; clearTimeout(debounce); debounce = setTimeout(onChange, 250); };
  const extra = el('div', { class: 'filters-extra' }), disclosure = el('details', { class: 'extra-filters' }, el('summary', { text: 'Дополнительные фильтры' }), extra); disclosure.open = window.innerWidth > 700;
  for (const [label, control] of [['Период', period], ['Поиск', search], ['Валюта', currency], ['Движение', flow], ['Тип', kind], ['Учёт', status], ['С даты', from], ['По дату', to], ['Категория', category]]) { const item = el('label', { class: control === search ? 'search' : '' }, label, control); (control === period || control === search ? form : extra).append(item); }
  if (state.meta.fields.some(field => field.active)) {
    const custom = select([['', 'Без фильтра'], ...state.meta.fields.filter(field => field.active).map(field => [field.id, field.name])], state.filters.customField || ''), valueBox = el('label', {}, 'Значение колонки');
    const valueControl = () => {
      const selected = state.meta.fields.find(field => field.id === custom.value), value = state.filters.customValue ?? '';
      const control = selected?.type === 'select' ? select([['', 'Не указано'], ...selected.options.map(item => [item, item])], value) : selected?.type === 'checkbox' ? select([['', 'Не указано'], ['true', 'Да'], ['false', 'Нет']], value) : el('input', { value, type: selected?.type === 'date' ? 'date' : selected?.type === 'number' ? 'number' : 'text', step: selected?.type === 'number' ? 'any' : null });
      control.disabled = !selected;
      let debounce; control.oninput = () => { state.filters.customValue = selected?.type === 'number' && control.value !== '' ? String(Number(control.value)) : control.value; state.viewId = ''; clearTimeout(debounce); debounce = setTimeout(onChange, 250); };
      valueBox.replaceChildren('Значение колонки', control);
    };
    custom.onchange = () => { state.filters.customField = custom.value; state.filters.customValue = ''; state.viewId = ''; valueControl(); onChange(); }; valueControl();
    extra.append(el('label', {}, 'Своя колонка', custom), valueBox);
  }
  form.append(disclosure);
  return form;
}
function query(filters = state.filters) { return new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value != null)); }
function importStatement() {
  const file = el('input', { type: 'file', accept: 'application/pdf,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx', 'aria-label': 'Файл банковской выписки' });
  const bank = select([['uzum', 'Uzum Bank · выписка на английском'], ['ipak', 'Ipak Yuli · PDF истории'], ['payme', 'Payme · Excel']], 'uzum');
  const card = el('input', { maxlength: '120', 'aria-label': 'Последние четыре цифры своих карт', placeholder: 'Например: 2670, 6351' });
  const status = el('p', { class: 'subtle' });
  modal('Импорт выписки', el('div', {}, el('p', { text: 'Выбери исходный PDF банка или Excel Payme. Для Payme укажи свои карты через запятую: покупки по остальным картам останутся на проверке. Для Ipak можно указать одну карту, если история относится к ней.' }), field('Источник файла', bank), field('Свои карты: последние четыре цифры', card), file, status), null);
  const generation = dialogGeneration;
  file.onchange = async () => {
    const source = file.files[0]; if (!source) return;
    if (source.size > 5 * 1024 * 1024) { status.textContent = 'Выбери PDF или XLSX до 5 МБ или выгрузи меньший период.'; return; }
    file.disabled = true; status.textContent = 'Разбираю таблицу. Исходный файл сохраняется без изменений…';
    try {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Не удалось прочитать файл.')); reader.readAsDataURL(source); });
      const cards = card.value.trim() ? card.value.split(',').map(value => value.trim()) : [];
      const preview = await api('/api/imports/preview', { method: 'POST', body: { filename: source.name, data, bank: bank.value, cardSuffix: bank.value === 'ipak' ? card.value.trim() : '', ownCards: bank.value === 'payme' ? cards : [] } });
      if (!dialog.open || generation !== dialogGeneration) return;
      showStatementPreview(preview);
    } catch (error) { status.textContent = error.message; file.disabled = false; }
  };
}
function showStatementPreview(preview) {
  const info = el('div', {}, el('p', { text: preview.source + ' · ' + preview.filename + ' · ' + (preview.sheets ? preview.sheets + ' лист' : preview.pages + ' стр.') + ' · ' + preview.period.from + ' — ' + preview.period.to }), el('p', { text: 'Всего: ' + preview.summary.total + '. Новых учтённых: ' + preview.summary.recorded + '. На проверку: ' + preview.summary.review + '. Возможных повторов: ' + preview.summary.duplicates + '. Исключено: ' + (preview.summary.ignored || 0) + '. Уже в базе: ' + preview.summary.existing + '.' }), el('p', { class: 'subtle', text: preview.note }));
  const body = el('tbody'), table = el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Дата', 'Магазин / сервис', 'Сумма', 'Учёт'].map(text => el('th', { text })))), body));
  let offset = 0;
  const more = button('Показать ещё строки', () => addRows(), true);
  function addRows() {
    for (const row of preview.rows.slice(offset, offset + 50)) body.append(el('tr', {}, el('td', { text: row.date }), el('td', { class: 'text-cell', text: row.merchant }), el('td', { class: 'amount', text: money(row.amountMinor) + ' ' + row.currency }), el('td', { class: 'text-cell', text: row.existing ? 'Уже в базе' : (statuses[row.state] || row.state) + (row.reason ? ' · ' + row.reason : '') })));
    offset += 50; more.hidden = offset >= preview.rows.length;
  }
  addRows(); info.append(table, more);
  info.insertBefore(el('div', { class: 'row' }, button('Добавить операции', () => dialogForm.requestSubmit()), button('Закрыть проверку', () => dialog.close(), true)), table);
  modal('Проверка выписки', info, async () => { const result = await api('/api/imports/' + preview.id + '/commit', { method: 'POST', body: {} }); await loadMeta(); await render(); message('Добавлено: ' + result.inserted + '. Уже были в базе: ' + result.skipped + '.'); }, 'Добавить в общую базу');
}
async function resumeStatementImport() {
  const address = new URL(location.href), id = address.searchParams.get('import');
  if (!/^[a-f0-9-]{36}$/.test(id || '')) return;
  address.searchParams.delete('import'); history.replaceState(null, '', address.pathname + address.search);
  const loading = el('p', { text: 'Открываю полученную выписку…' }); modal('Проверка выписки', loading, null);
  const generation = dialogGeneration;
  try { const preview = await api('/api/imports/' + id); if (dialog.open && generation === dialogGeneration) showStatementPreview(preview); }
  catch (error) { if (dialog.open && generation === dialogGeneration) loading.textContent = 'Не удалось открыть выписку: ' + error.message + ' Вернись в «Полученные выписки» и повтори проверку.'; }
}
function name(key) { return names[key] || state.meta.fields.find(field => field.id === key)?.name || key; }
async function render() {
  route(state.tab, state.tab === 'dashboard' ? state.boardId : '');
  document.title = (state.tab === 'table' ? 'Таблицы' : state.tab === 'orders' ? 'Заказы' : 'Дашборды') + ' · My Personal Throughput Accounting';
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === state.tab);
  app.replaceChildren(); state.generation++;
  if (state.tab === 'table') renderTable(); else if (state.tab === 'orders') renderOrders().catch(error => message(error.message)); else renderDashboard();
}
function renderTable() {
  const view = select([['', 'Текущее представление'], ...state.meta.views.map(item => [item.id, item.name])], state.viewId);
  view.onchange = () => { const item = state.meta.views.find(v => v.id === view.value); if (!item) return; state.viewId = item.id; state.filters = { ...item.filters }; state.columns = [...item.columns]; render(); };
  const actions = el('div', { class: 'actions' }, button('Добавить операцию', () => editRow(null)), button('Своя колонка', addField, true), button('Колонки', chooseColumns, true), button('Сохранить вид', saveView, true), button('CSV', () => location.href = '/api/export?' + query(), true), button('Импорт выписки', importStatement, true));
  const tools = button('Настроить таблицу', () => { const open = actions.classList.toggle('expanded'); tools.setAttribute('aria-expanded', String(open)); }, true); tools.classList.add('mobile-tools'); tools.setAttribute('aria-expanded', 'false'); actions.append(tools);
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
      else if (key === 'flow') value = flows[value] || 'Не определено';
      else if (key === 'state') value = el('span', { class: 'pill ' + row.state, text: statuses[row.state] });
      else if (typeof value === 'boolean') value = value ? 'Да' : 'Нет';
      tr.append(el('td', { class: ['amount_minor', 'balance_minor'].includes(key) ? 'amount' : ['merchant', 'purpose', 'description'].includes(key) ? 'text-cell' : '' }, value ?? '—'));
    }
    tr.append(el('td', {}, button('Открыть', () => editRow(row.id), true))); body.append(tr);
  }
  tablePanel.append(el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, head), body)));
  if (state.rows.length < state.total) tablePanel.append(button('Показать ещё', () => loadRows(true), true));
}
async function editRow(id, preset = {}) {
  const detail = id ? await api('/api/events/' + id) : null, row = detail?.row || { date: today(), amount_minor: null, currency: 'UZS', kind: 'expense', state: 'recorded', category: '', purpose: '', merchant: '', description: '', custom: {}, ...preset };
  const incomeEntry = !id && preset.kind === 'income';
  const incomeChoices = ['Зарплата', 'Проекты и клиенты', 'Бизнес', 'Подработка'];
  const incomeType = incomeEntry ? select([['', 'Выбери тип поступления'], ...incomeChoices.map(value => [value, value]), ['other', 'Другое']], incomeChoices.includes(row.merchant) ? row.merchant : row.merchant ? 'other' : '') : null;
  const otherIncome = incomeEntry ? el('input', { 'aria-label': 'Другой источник поступления', maxlength: '120', value: incomeChoices.includes(row.merchant) ? '' : row.merchant || '' }) : null;
  const otherField = incomeEntry ? field('Какой источник поступления?', otherIncome, true) : null;
  const form = el('div', { class: 'form-grid' }), controls = {};
  controls.amount = el('input', { value: amountInput(row.amount_minor), inputmode: 'decimal', required: row.state === 'recorded' });
  controls.currency = el('input', { value: row.currency || 'UZS', maxlength: '3', required: true });
  controls.date = el('input', { type: 'date', value: row.date || today(), required: true });
  controls.kind = select(Object.entries(kinds), row.kind || 'unknown'); controls.state = select(Object.entries(statuses), row.state);
  controls.state.onchange = () => controls.amount.required = controls.state.value === 'recorded';
  for (const key of ['merchant', 'category', 'purpose', 'description']) controls[key] = el(key === 'description' ? 'textarea' : 'input', { value: row[key] || '', maxlength: key === 'purpose' ? '240' : key === 'category' ? '120' : '500' });
  for (const [label, key] of [['Сумма', 'amount'], ['Валюта', 'currency'], ['Дата', 'date'], ['Тип', 'kind'], ['Учёт', 'state'], ['Магазин / отправитель', 'merchant'], ['Категория', 'category'], ['На что', 'purpose'], ['Описание', 'description']]) {
    if (incomeEntry && key === 'date') {
      controls.date.setAttribute('aria-label', 'Дата поступления'); controls.date.max = today();
      form.append(el('div', { class: 'field' }, el('span', { text: 'Дата поступления' }), el('div', { class: 'income-date-row' }, controls.date, button('Сегодня', () => { controls.date.value = today(); controls.date.dispatchEvent(new Event('change')); }, true))));
    } else {
      const item = field(label, controls[key], key === 'description');
      if (incomeEntry && key === 'merchant') item.hidden = true;
      form.append(item);
    }
  }
  if (incomeEntry) {
    incomeType.setAttribute('aria-label', 'Тип поступления');
    const updateIncome = () => { const visible = controls.kind.value === 'income'; incomeType.closest('.field').hidden = !visible; otherField.hidden = !visible || incomeType.value !== 'other'; controls.merchant.closest('.field').hidden = visible; };
    form.append(field('Тип поступления', incomeType, true), otherField);
    incomeType.onchange = updateIncome; controls.kind.onchange = updateIncome; updateIncome();
  }
  const customControls = {};
  for (const item of state.meta.fields.filter(field => field.active)) {
    const value = row.custom?.[item.id];
    const control = item.type === 'select' ? select([['', 'Не указано'], ...item.options.map(value => [value, value]), ...(value && !item.options.includes(value) ? [[value, value + ' (из прежнего списка)']] : [])], value || '') : el('input', { type: item.type === 'checkbox' ? 'checkbox' : item.type === 'date' ? 'date' : item.type === 'number' ? 'number' : 'text', value: item.type === 'checkbox' ? 'yes' : value ?? '', checked: item.type === 'checkbox' && !!value, step: item.type === 'number' ? 'any' : null });
    customControls[item.id] = control;
    if (!(incomeEntry && item.builtin === 'economy-source')) form.append(field(item.name, control));
  }
  const wrapper = el('div', {}, form);
  if (detail?.orders?.length) wrapper.append(el('details', {}, el('summary', { text: 'Детали из заказов: ' + detail.orders.length }), ...detail.orders.map(order => button(order.title + (order.needsReview ? ' · связь требует проверки' : ''), () => { dialog.close(); return showOrder(order.id); }, true))));
  if (row.raw_text) wrapper.append(el('details', {}, el('summary', { text: 'Исходное банковское сообщение' }), el('pre', { text: row.raw_text })));
  if (detail?.history.length) wrapper.append(el('details', {}, el('summary', { text: 'История изменений: ' + detail.history.length }), ...detail.history.map(item => { const previous = JSON.parse(item.data); return el('p', { class: 'subtle', text: new Date(item.at).toLocaleString('ru-RU') + ' · ' + (item.actor === 'web' ? 'Веб' : 'Телефон / синхронизация') + ' · ' + money(previous.amount_minor) + ' ' + (previous.currency || '') + ' · ' + (previous.category || '') + ' · ' + (previous.purpose || '') }); })));
  modal(id ? 'Исправить операцию' : incomeEntry ? 'Добавить поступление' : 'Добавить операцию', wrapper, async () => {
    const event = Object.fromEntries(['date', 'kind', 'state', 'merchant', 'category', 'purpose', 'description'].map(key => [key, controls[key].value.trim()]));
    event.amount_minor = controls.amount.value.trim() ? minor(controls.amount.value) : null; event.currency = controls.currency.value.trim().toUpperCase();
    if (incomeEntry && event.kind === 'income') {
      if (!incomeType.value) throw new Error('Выбери тип поступления.');
      event.merchant = incomeType.value === 'other' ? otherIncome.value.trim() : incomeType.value;
      if (!event.merchant) throw new Error('Укажи источник поступления для «Другое».');
      if (event.date > today()) throw new Error('Дата поступления не может быть в будущем.');
      event.time = null;
      const sourceField = state.meta.fields.find(item => item.active && item.builtin === 'economy-source');
      if (sourceField) customControls[sourceField.id].value = event.merchant;
    }
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
  const balancesPanel = el('section', { class: 'widget balances-panel', 'aria-label': 'Баланс счетов' }), balancesGeneration = state.generation;
  app.append(balancesPanel); state.refreshBalances = null;
  import('/balances-ui.mjs').then(module => { if (balancesGeneration === state.generation && state.tab === 'dashboard') return module.renderBalances(balancesPanel, { el, button, money, field, select, api, modal, message }); }).then(refresh => { if (balancesGeneration === state.generation) state.refreshBalances = refresh; }).catch(error => balancesPanel.replaceChildren(el('p', { text: 'Не удалось загрузить балансы: ' + error.message })));
  if (['economy', 'assets'].includes(state.boardId)) {
    const choose = select([['economy', 'Моя экономика'], ['assets', 'Активы'], ...state.meta.dashboards.map(item => [item.id, item.name])], state.boardId); choose.setAttribute('aria-label', 'Выбор дашборда');
    choose.onchange = () => { state.boardId = choose.value; history.replaceState(null, '', '/?tab=dashboard&board=' + encodeURIComponent(state.boardId)); render(); };
    const panel = el('div'), generation = state.generation;
    app.append(el('div', { class: 'toolbar' }, el('div', { class: 'row' }, el('h1', { text: state.boardId === 'economy' ? 'Моя экономика' : 'Активы' }), choose)), panel);
    const selectedBoard = state.boardId;
    import(selectedBoard === 'economy' ? '/economy-ui.mjs' : '/assets-ui.mjs').then(module => { if (generation === state.generation && state.tab === 'dashboard') return (selectedBoard === 'economy' ? module.renderEconomy : module.renderAssets)(panel, { el, button, money, field, select, api, modal, editRow, state, render, message }); }).catch(error => message(error.message));
    return;
  }
  const board = state.meta.dashboards.find(board => board.id === state.boardId) || state.meta.dashboards[0]; state.boardId = board.id;
  const selectBoard = select([['economy', 'Моя экономика'], ['assets', 'Активы'], ...state.meta.dashboards.map(item => [item.id, item.name])], state.boardId); selectBoard.setAttribute('aria-label', 'Выбор дашборда'); selectBoard.onchange = () => { state.boardId = selectBoard.value; history.replaceState(null, '', '/?tab=dashboard&board=' + encodeURIComponent(state.boardId)); render(); };
  app.append(el('div', { class: 'toolbar' }, el('div', { class: 'row' }, el('h1', { text: 'Дашборды' }), selectBoard), el('div', { class: 'actions' }, button('Добавить доход', () => editRow(null, { kind: 'income', category: 'Доход' }), true), button('Добавить виджет', () => editWidget(null)), button('Новый дашборд', newBoard, true))));
  let results = el('div', { class: 'boards' }), chart = el('section', { class: 'cashflow widget', 'aria-label': 'График доходов и расходов' }), request = 0;
  const group = select([['day', 'По дням'], ['week', 'По неделям'], ['month', 'По месяцам']], state.chartGroup); group.setAttribute('aria-label', 'Разбивка графика');
  group.onchange = () => { state.chartGroup = group.value; load().catch(error => message(error.message)); };
  const load = async () => {
    const generation = state.generation, currentRequest = ++request, params = query(); params.set('id', state.boardId); params.set('group', state.chartGroup);
    const [response, series] = await Promise.all([api('/api/dashboard?' + params), api('/api/cashflow?' + params)]);
    if (generation !== state.generation || currentRequest !== request || state.tab !== 'dashboard') return;
    drawCashflow(chart, series, group);
    results.replaceChildren();
    for (const widget of response.widgets) {
      const card = el('section', { class: 'widget' }, el('h2', {}, el('span', { text: widget.name }), button('Настроить', () => editWidget(widget.id), true)));
      if (widget.metric === 'incoming') card.append(el('p', { class: 'subtle', text: 'Пополнения, возвраты и переводы на свои карты. Назначение поступлений можно уточнить отдельно.' }), button('Посмотреть поступления', () => { state.filters = { ...state.filters, flow: 'incoming' }; state.tab = 'table'; if (!state.columns.includes('flow')) state.columns.push('flow'); history.replaceState(null, '', '/?tab=table'); render(); }, true));
      if (!widget.data.length) card.append(el('p', { class: 'subtle', text: widget.metric === 'incoming' ? 'За этот период поступления с известной суммой не найдены в загруженных данных.' : 'Нет учтённых операций за этот период.' }));
      for (const item of widget.data) {
        const block = el('div', { class: 'currency-block' }, el('div', { class: 'metric' }, widget.metric === 'count' ? String(item.count) : money(item.amountMinor), el('small', { text: widget.metric === 'count' ? ' операций · ' + item.currency : ' ' + item.currency })));
        if (widget.metric === 'incoming') block.append(el('p', { class: 'subtle', text: item.count + ' поступлений · назначение нужно уточнить у ' + item.reviewCount }));
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
  app.append(filterForm(() => load().catch(error => message(error.message))), chart, results); state.refreshBoard = load; load().catch(error => chart.replaceChildren(el('p', { text: error.message })));
}
function svgEl(tag, attributes = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function drawCashflow(panel, series, group) {
  const preferredCurrency = state.chartCurrency || state.filters.currency || (series.currencies.some(item => item.currency === 'UZS') ? 'UZS' : series.currencies[0]?.currency || '');
  const currency = select(series.currencies.map(item => [item.currency, item.currency]), preferredCurrency); currency.setAttribute('aria-label', 'Валюта графика');
  if (!series.currencies.some(item => item.currency === currency.value)) currency.value = series.currencies[0]?.currency || '';
  state.chartCurrency = currency.value; currency.onchange = () => { state.chartCurrency = currency.value; drawCashflow(panel, series, group); };
  panel.replaceChildren(el('div', { class: 'chart-heading' }, el('div', {}, el('h2', { text: 'Доходы и расходы во времени' }), el('p', { class: 'subtle', text: 'По загруженным операциям. Доходы и расходы включают только учтённые записи. Валюты считаются отдельно.' })), el('div', { class: 'row' }, group, currency)));
  if (series.adjusted) panel.append(el('p', { class: 'subtle', text: 'Для длинной истории показаны месяцы. Выбери меньший период, чтобы увидеть дни или недели.' }));
  const item = series.currencies.find(item => item.currency === currency.value);
  if (!item?.points.length) { panel.append(el('p', { text: 'За этот период нет загруженных операций с датой и валютой.' })); return; }
  const metrics = [['income', 'Подтверждённые доходы', '#333336'], ['expense', 'Расходы', '#8a8a91'], ['incoming', 'Все поступления на карты', '#c1c1c8']], enabled = { income: state.chartIncome !== false, expense: state.chartExpense !== false, incoming: state.chartIncoming === true };
  const summary = el('div', { class: 'chart-totals' }), legend = el('div', { class: 'chart-legend' });
  for (const [key, name, color] of metrics) {
    summary.append(el('div', { class: 'chart-total ' + key }, el('span', { text: name }), el('strong', { text: money(item.totals[key + 'Minor']) + ' ' + item.currency }), el('small', { text: item.totals[key + 'Count'] + ' операций' })));
    const check = el('input', { type: 'checkbox', checked: enabled[key] }); check.onchange = () => { enabled[key] = check.checked; state['chart' + key[0].toUpperCase() + key.slice(1)] = check.checked; paint(); };
    legend.append(el('label', { class: key }, check, name));
  }
  const warning = el('p', { class: 'subtle', text: 'Все поступления включают возвраты и переводы на свои карты. Они могут повторяться в разных источниках. На уточнении: ' + item.totals.reviewCount + ' записей. Пустые интервалы означают отсутствие загруженных записей; это не доказывает отсутствие трат.' });
  const graph = el('div', { class: 'chart-scroll' }), details = el('div', { class: 'chart-period', role: 'status' });
  const previousPeriod = item.points.findIndex(point => point.from === state.chartPeriod), period = select(item.points.map((point, index) => [String(index), point.label]), String(previousPeriod >= 0 ? previousPeriod : item.points.length - 1)); period.setAttribute('aria-label', 'Период графика');
  const show = index => {
    const point = item.points[index]; period.value = String(index); state.chartPeriod = point.from;
    details.replaceChildren(el('strong', { text: point.from + ' — ' + point.to }), el('div', { class: 'row' }, ...metrics.map(([key, name]) => el('span', { class: key, text: name + ': ' + money(point[key + 'Minor']) + ' ' + item.currency }))), el('span', { class: 'subtle', text: 'Загружено: ' + point.loadedCount + ' · На уточнении: ' + point.reviewCount }), button('Операции периода', () => {
      state.filters = { ...state.filters, period: 'all', from: point.from, to: point.to, currency: item.currency }; state.tab = 'table'; history.replaceState(null, '', '/?tab=table'); render();
    }, true));
  };
  period.onchange = () => show(Number(period.value));
  function paint() {
    const visible = metrics.filter(([key]) => enabled[key]);
    let max = 1n; for (const point of item.points) for (const [key] of visible) if (BigInt(point[key + 'Minor']) > max) max = BigInt(point[key + 'Minor']);
    const height = value => Number(BigInt(value) * 23000n / max) / 100, svg = svgEl('svg', { viewBox: '0 0 940 320', role: 'group', 'aria-label': 'Доходы и расходы. Выбери столбцы или период под графиком.' }, svgEl('title', {}, 'Доходы и расходы: ' + item.currency));
    for (let step = 0; step <= 4; step++) { const y = 260 - step * 57.5; svg.append(svgEl('line', { x1: 110, x2: 925, y1: y, y2: y, class: 'chart-grid' }), svgEl('text', { x: 102, y: y + 4, 'text-anchor': 'end', class: 'chart-axis' }, money(max * BigInt(step) / 4n))); }
    const width = 815 / item.points.length, stride = Math.max(1, Math.ceil(item.points.length / 7));
    item.points.forEach((point, index) => {
      const x = 110 + width * index, label = point.label + ': ' + metrics.map(([key, name]) => name + ' ' + money(point[key + 'Minor']) + ' ' + item.currency).join('; '), area = svgEl('g', { role: 'button', tabindex: '0', 'aria-label': label, class: 'chart-hit' }, svgEl('title', {}, label));
      area.append(svgEl('rect', { x, y: 25, width: Math.max(.5, width), height: 240, fill: 'transparent' }));
      visible.forEach(([key, , color], metricIndex) => { const h = height(point[key + 'Minor']); area.append(svgEl('rect', { x: x + width * .12 + metricIndex * width * .76 / visible.length, y: 260 - h, width: Math.max(.4, width * .7 / visible.length), height: h, fill: color, 'pointer-events': 'none' })); });
      if (!point.loadedCount) area.append(svgEl('line', { x1: x + 1, x2: x + width - 1, y1: 264, y2: 264, class: 'chart-gap' }));
      area.addEventListener('click', () => show(index)); area.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); show(index); } }); svg.append(area);
      if (index % stride === 0 || index === item.points.length - 1) svg.append(svgEl('text', { x: x + width / 2, y: 287, 'text-anchor': 'middle', class: 'chart-axis' }, point.label));
    });
    graph.replaceChildren(svg);
  }
  panel.append(summary, legend, graph, el('label', { class: 'row' }, 'Период:', period), details, warning); paint(); show(Number(period.value));
}
function newBoard() {
  const label = el('input', { value: 'Мой дашборд', required: true, maxlength: '80' });
  modal('Новый дашборд', field('Название', label), async () => { const result = await api('/api/dashboards', { method: 'POST', body: { name: label.value, widgets: [] } }); state.boardId = result.id; await loadMeta(); render(); });
}
async function renderOrders() {
  const generation = state.generation, [result, reporting] = await Promise.all([api('/api/orders'), import('/order-summary.mjs')]);
  const { summarizeOrders, categoryOf, orderCategories } = reporting;
  if (generation !== state.generation || state.tab !== 'orders') return;
  app.replaceChildren(el('div', { class: 'toolbar' }, el('h1', { text: 'Заказы и чеки' })), el('p', { class: 'subtle', text: 'Детали покупок дополняют банковские операции. Импорт заказа сам по себе не увеличивает расходы: связь с оплатой подтверждается отдельно.' }));
  const service = select([['', 'Все сервисы'], ...Object.entries(result.services)], state.orderService || ''); service.setAttribute('aria-label', 'Сервис заказов');
  const category = select([['', 'Все заказы'], ...Object.entries(orderCategories)], state.orderCategory || ''); category.setAttribute('aria-label', 'Категория заказов');
  const from = el('input', { type: 'date', value: state.orderFrom || '', 'aria-label': 'Заказы с даты' }), to = el('input', { type: 'date', value: state.orderTo || '', 'aria-label': 'Заказы по дату' });
  const search = el('input', { type: 'search', 'aria-label': 'Поиск в заказах', value: state.orderSearch || '' }), sources = el('div', { class: 'order-sources' }), list = el('section', { 'aria-label': 'Список заказов' });
  for (const source of result.sources) sources.append(el('div', { class: 'widget' }, el('h2', { text: result.services[source.service] + ' · ' + source.count + ' записей' }), el('p', { text: source.coverageNote })));
  if (!result.sources.length) sources.append(el('p', { text: 'История заказов пока не загружена.' }));
  function draw() {
    state.orderService = service.value; state.orderSearch = search.value; state.orderCategory = category.value; state.orderFrom = from.value; state.orderTo = to.value;
    const rows = result.rows.filter(row => (!service.value || row.service === service.value) && (!category.value || categoryOf(row) === category.value) && (!from.value || row.date && row.date >= from.value) && (!to.value || row.date && row.date <= to.value) && [row.title, row.rawText].join(' ').toLocaleLowerCase('ru').includes(search.value.toLocaleLowerCase('ru'))), body = el('tbody'), report = summarizeOrders(rows);
    const overview = el('section', { 'aria-label': 'Суммы заказов по категориям' }, el('h2', { text: 'Еда и такси по истории заказов' }), el('p', { class: 'subtle', text: 'Суммы из истории без отменённых заказов. Оплата, возвраты и способ оплаты уточняются по чекам и банковским записям. Эти суммы не прибавляются к расходам дашборда.' }));
    const missingAmounts = rows.filter(row => row.amountMinor == null).length;
    if (missingAmounts) overview.append(el('p', { class: 'subtle', text: 'Записей без указанной суммы: ' + missingAmounts + '. Они сохранены в списке и не входят в денежные итоги.' }));
    for (const total of report.totals) {
      const monthRows = report.months.filter(row => row.category === total.category && row.currency === total.currency), max = monthRows.reduce((value, row) => BigInt(row.amountMinor) > value ? BigInt(row.amountMinor) : value, 1n);
      const monthly = el('details', {}, el('summary', { text: 'По месяцам · ' + monthRows.length })), monthBody = el('tbody');
      for (const month of monthRows) monthBody.append(el('tr', {}, el('td', { text: month.month }), el('td', { text: String(month.count) }), el('td', { class: 'amount', text: money(month.amountMinor) + ' ' + month.currency }), el('td', {}, el('div', { class: 'order-month-bar', style: 'width:' + Number(BigInt(month.amountMinor) * 10000n / max) / 100 + '%', 'aria-hidden': 'true' }))));
      monthly.append(el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Месяц', 'Заказы', 'Сумма', 'Сравнение'].map(text => el('th', { text })))), monthBody)));
      overview.append(el('div', { class: 'widget' }, el('h2', { text: orderCategories[total.category] + ' · ' + total.currency }), el('p', { class: 'metric', text: money(total.amountMinor) }), el('p', { text: total.count + ' заказов · ' + (total.from || 'Нет даты') + ' — ' + (total.to || 'Нет даты') }), el('p', { class: 'subtle', text: 'Отменено: ' + total.cancelledCount + '. Год предположен: ' + total.inferredYearCount + '. Без даты: ' + total.unknownDateCount + '.' }), monthly));
    }
    const wrap = el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Дата', 'Сервис / заказ', 'Сумма заказа', 'Статус', 'Связь с оплатой', 'Детали'].map(text => el('th', { text })))), body));
    list.replaceChildren(overview, el('p', { class: 'subtle', text: 'Найдено: ' + rows.length }), wrap);
    let offset = 0; const more = button('Показать ещё заказы', () => add(), true);
    function add() {
      for (const row of rows.slice(offset, offset + 100)) body.append(el('tr', {}, el('td', { class: 'text-cell', text: (row.date || row.dateLabel || 'Дата неизвестна') + (row.time ? ' ' + row.time : '') + (row.dateCertainty === 'inferred_year' ? ' · год предположен' : '') }), el('td', { class: 'text-cell', text: result.services[row.service] + ' · ' + row.title }), el('td', { class: 'amount', text: money(row.amountMinor) + ' ' + (row.currency || '') }), el('td', { class: 'text-cell', text: row.status || 'Не указан' }), el('td', { class: 'text-cell', text: row.links.length ? row.links.some(link => link.needsReview) ? 'Перепроверить связь' : 'Связано' : 'Не сопоставлено' }), el('td', {}, button('Детали заказа', () => showOrder(row.id), true))));
      offset += 100; more.hidden = offset >= rows.length;
    }
    add(); list.append(more);
  }
  service.onchange = draw; category.onchange = draw; from.onchange = draw; to.onchange = draw; search.oninput = draw;
  app.append(el('div', { class: 'filters' }, field('Сервис', service), field('Категория', category), field('С даты', from), field('По дату', to), field('Поиск', search)), list, el('details', {}, el('summary', { text: 'Источники и охват · ' + result.sources.length }), sources)); draw();
}
async function showOrder(id) {
  const detail = await api('/api/orders/' + id), row = detail.row, wrapper = el('div', {}, el('p', { text: (row.date || row.dateLabel || 'Дата неизвестна') + ' ' + (row.time || '') + ' · ' + (row.dateCertainty === 'inferred_year' ? 'год определён по текущей истории, нужно подтвердить' : row.dateCertainty === 'unknown' ? 'дата не подтверждена' : 'дата подтверждена') }), el('p', { class: 'metric', text: money(row.amountMinor) + ' ' + (row.currency || '') }), el('p', { text: row.status || 'Статус не указан' }), el('p', { text: 'Оплата: ' + (row.paymentMethod || 'не указана') + (row.cardSuffix ? ' · карта ' + row.cardSuffix : '') }));
  const detailNames = { from: 'Откуда', to: 'Куда', route: 'Адрес / маршрут', category: 'Категория заказа', cancelled: 'Отменён', amountMissing: 'В истории нет суммы', sameTextOccurrence: 'Совпадающая запись в истории, №', receiptNumber: 'Номер чека', receiptIssuedAt: 'Чек выдан', plusPoints: 'Баллы Плюса', paidMinor: 'Оплачено', refundMinor: 'Возвращено', deliveryMinor: 'Доставка', discountMinor: 'Скидка' };
  for (const [key, value] of Object.entries(row.details)) wrapper.append(el('p', { text: (detailNames[key] || key) + ': ' + (key.endsWith('Minor') ? money(value) + ' ' + row.currency : key === 'category' ? ({ food: 'Еда', taxi: 'Такси', other: 'Другие заказы' }[value] || value) : typeof value === 'boolean' ? value ? 'Да' : 'Нет' : value) }));
  if (row.items.length) wrapper.append(el('ul', {}, ...row.items.map(item => el('li', { text: item.name + (item.quantity ? ' × ' + item.quantity : '') + (item.amountMinor != null ? ' · ' + money(item.amountMinor) + ' ' + row.currency : '') }))));
  if (row.details.plusPoints) wrapper.append(el('p', { class: 'subtle', text: 'Баллы Плюса не учитываются как денежный доход.' }));
  wrapper.append(el('h2', { text: 'Банковские операции' }));
  for (const link of detail.links) wrapper.append(el('div', { class: 'conflict-card' }, el('p', { text: (link.relation === 'refund' ? 'Возврат' : 'Оплата') + ': ' + link.event.date + ' · ' + (link.event.merchant || '') + ' · ' + money(link.event.amount_minor) + ' ' + link.event.currency + (link.needsReview ? ' · запись изменилась, проверь связь' : '') }), button('Открыть банковскую запись', () => { dialog.close(); return editRow(link.event_id); }, true), button('Убрать связь', async () => { await api('/api/orders/' + id + '/link', { method: 'POST', body: { eventId: link.event_id, relation: link.relation, active: false, expectedOrderVersion: row.version, expectedEventVersion: link.event.version } }); dialog.close(); await showOrder(id); }, true)));
  const candidates = [...detail.candidates, ...detail.refunds].filter(candidate => !detail.links.some(link => link.event_id === candidate.id && link.relation === candidate.relation));
  if (!detail.links.length && !candidates.length) wrapper.append(el('p', { class: 'subtle', text: 'Подходящая банковская запись пока не найдена. Расходы не изменены.' }));
  for (const candidate of candidates) wrapper.append(el('div', { class: 'conflict-card' }, el('p', { text: 'Возможное совпадение: ' + candidate.date + ' · ' + candidate.merchant + ' · ' + money(candidate.amount_minor) + ' ' + candidate.currency }), el('p', { class: 'subtle', text: candidate.reasons.join('. ') + '. Проверь, что это та же операция.' }), button(candidate.relation === 'refund' ? 'Подтвердить связь с возвратом' : 'Подтвердить связь с оплатой', async () => { await api('/api/orders/' + id + '/link', { method: 'POST', body: { eventId: candidate.id, relation: candidate.relation, active: true, expectedOrderVersion: row.version, expectedEventVersion: candidate.version } }); dialog.close(); await showOrder(id); })));
  wrapper.append(el('details', {}, el('summary', { text: 'Исходная запись' }), el('pre', { text: row.rawText })));
  for (const observation of detail.observations) wrapper.append(el('details', {}, el('summary', { text: 'Источник и охват истории' }), el('p', { text: observation.source.coverageNote }), ...observation.source.artifacts.map((artifact, index) => el('p', {}, el('a', { href: '/api/order-files/' + observation.batchId + '/' + index, target: '_blank', rel: 'noopener', text: artifact.name })))));
  modal(row.title, wrapper, null);
}
function editWidget(id) {
  const board = state.meta.dashboards.find(board => board.id === state.boardId), widget = board.widgets.find(widget => widget.id === id) || { name: 'Мои расходы', metric: 'expense', group: 'category', currency: '', viewId: '' };
  const label = el('input', { value: widget.name, required: true, maxlength: '80' }), metric = select([['expense', 'Сумма расходов'], ['income', 'Подтверждённые доходы'], ['incoming', 'Все поступления на карты'], ['transfer', 'Перемещения своих денег'], ['count', 'Количество операций']], widget.metric), group = select([['', 'Общий итог'], ['category', 'Категории'], ['merchant', 'Магазины / сервисы'], ['day', 'Дни'], ['month', 'Месяцы'], ...state.meta.fields.filter(field => field.active).map(field => [field.id, field.name])], widget.group), currency = select([['', 'Все валюты, отдельно'], ...[...new Set(['UZS', 'USD', ...state.meta.currencies])].map(code => [code, code])], widget.currency), view = select([['', 'Фильтры дашборда'], ...state.meta.views.map(view => [view.id, view.name])], widget.viewId || '');
  const form = el('div', { class: 'form-grid' }, field('Название', label, true), field('Показатель', metric), field('Разбивка', group), field('Валюта', currency), field('Источник / представление', view));
  if (id) form.append(button('Удалить виджет', async () => { await api('/api/dashboards', { method: 'POST', body: { ...board, expectedVersion: board.version, widgets: board.widgets.filter(widget => widget.id !== id) } }); dialog.close(); await loadMeta(); render(); }, true));
  modal(id ? 'Настроить виджет' : 'Добавить виджет', form, async () => { const updated = { id: id || 'widget-' + Date.now() + '-' + Math.random().toString(16).slice(2), name: label.value, metric: metric.value, group: group.value, currency: currency.value, viewId: view.value }; const widgets = id ? board.widgets.map(widget => widget.id === id ? updated : widget) : [...board.widgets, updated]; await api('/api/dashboards', { method: 'POST', body: { ...board, expectedVersion: board.version, widgets } }); await loadMeta(); render(); });
}
async function connection() {
  const box = el('div', {}, el('p', { text: 'На телефоне: My Personal Throughput Accounting → Подключить общую таблицу. Введи адрес и код ниже.' }), el('p', { class: 'connection-url', text: state.meta.url }));
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
  form.onsubmit = async event => { event.preventDefault(); try { await api('/api/login', { method: 'POST', body: { password: password.value } }); await loadMeta(); await render(); await resumeStatementImport(); } catch (problem) { error.textContent = problem.message; } };
  app.replaceChildren(el('section', { class: 'login' }, el('h1', { text: 'Войти в My Personal Throughput Accounting' }), el('p', { text: 'На основном компьютере открой 127.0.0.1:8788. Телефон подключается кодом из окна «Подключение».' }), form));
}
window.financeNavigate = tab => {
  if (!['dashboard', 'table'].includes(tab)) return;
  const changed = state.tab !== tab;
  if (changed && dialog.open) dialog.close();
  state.tab = tab; route(tab, tab === 'dashboard' ? state.boardId : '');
  if (state.meta && changed) render();
  return tab;
};
for (const item of document.querySelectorAll('[data-tab]')) item.onclick = () => { if (!state.meta) return; state.tab = item.dataset.tab; render(); };
document.querySelector('#connect').onclick = () => state.meta ? connection() : login();
async function start() { try { await loadMeta(); await render(); await resumeStatementImport(); } catch (error) { if (error.status === 401) login(); else app.replaceChildren(el('p', { text: 'Компьютер недоступен: ' + error.message }), button('Повторить', start)); } }
start();
setInterval(async () => { if (!state.meta || dialog.open || document.hidden) return; try { await loadMeta(); if (state.tab === 'table') await loadRows(false); else if (state.tab === 'dashboard') { if (state.refreshBoard) await state.refreshBoard(); if (state.refreshBalances) await state.refreshBalances(); } } catch (error) { if (error.status === 401) { state.meta = null; login(); } } }, 20000);
