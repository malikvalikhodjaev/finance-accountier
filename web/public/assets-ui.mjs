export async function renderAssets(panel, context) {
  const { el, button, money, field, select, api, modal, state } = context, generation = state.generation;
  const result = await api('/api/assets');
  if (generation !== state.generation || state.boardId !== 'assets' || state.tab !== 'dashboard') return;
  const amount = value => String(BigInt(value) / 100n) + '.' + String(BigInt(value) % 100n).padStart(2, '0');
  function edit(row = null) {
    const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const controls = { name: el('input', { value: row?.name || '', maxlength: '120', required: true }), kind: select(Object.entries(result.kinds), row?.kind || 'bank'), currency: el('input', { value: row?.currency || 'UZS', maxlength: '3', required: true }), value: el('input', { value: row ? amount(row.amountMinor) : '', inputmode: 'decimal', required: true }), date: el('input', { type: 'date', value: row?.asOf || now, max: now, required: true }), note: el('textarea', { value: row?.note || '', maxlength: '1000' }) };
    const form = el('div', { class: 'form-grid' }, ...[['Название', 'name'], ['Тип', 'kind'], ['Валюта', 'currency'], ['Текущая оценка / остаток', 'value'], ['Дата оценки', 'date'], ['Примечание', 'note']].map(([label, key]) => field(label, controls[key])));
    modal(row ? 'Обновить оценку актива' : 'Добавить актив или обязательство', form, async () => {
      const clean = controls.value.value.trim().replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
      if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(clean)) throw new Error('Введи неотрицательную сумму с максимум двумя знаками после запятой.');
      const [whole, cents = ''] = clean.split('.'), minor = BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0')); if (minor > 100000000000000n) throw new Error('Слишком большая сумма.');
      await api('/api/assets', { method: 'POST', body: { ...(row ? { id: row.id } : {}), name: controls.name.value, kind: controls.kind.value, currency: controls.currency.value.trim().toUpperCase(), amountMinor: Number(minor), asOf: controls.date.value, note: controls.note.value, expectedVersion: row?.version || 0 } });
      await renderAssets(panel, context);
    });
  }
  const body = el('tbody');
  for (const row of result.rows) body.append(el('tr', {}, el('td', { text: row.name }), el('td', { text: result.kinds[row.kind] }), el('td', { text: money(row.amountMinor) + ' ' + row.currency }), el('td', { text: row.asOf }), el('td', {}, button('Обновить оценку', () => edit(row), true))));
  panel.replaceChildren(el('section', { class: 'widget', 'aria-label': 'Активы и обязательства' }, el('div', { class: 'chart-heading' }, el('h2', { text: 'Активы и обязательства' }), button('Добавить актив', () => edit())), el('p', { class: 'subtle', text: 'Текущие оценки и остатки на указанную дату. Покупка актива и перевод между своими картами не доказывают его текущую стоимость. Оценки здесь не создают банковских операций и не увеличивают заработок.' }), result.rows.length ? el('div', { class: 'economy-grid' }, ...result.totals.map(item => el('div', { class: 'economy-metric' }, el('span', { text: 'Чистые активы · ' + item.currency }), el('strong', { text: money(item.netMinor) }), el('small', { text: 'Активы: ' + money(item.assetsMinor) + '. Обязательства: ' + money(item.liabilitiesMinor) + '. Даты оценок: ' + item.oldestDate + ' — ' + item.newestDate + '.' })))) : el('p', { text: 'Нет данных об оценках активов. Это не означает, что активы равны нулю.' }), el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Актив / обязательство', 'Тип', 'Оценка', 'Дата', 'Действие'].map(text => el('th', { text })))), body))));
}
