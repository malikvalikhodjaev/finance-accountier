export async function renderBalances(panel, context) {
  const { el, button, money, field, select, api, modal, message } = context;
  let request = 0, previous = '';
  const refresh = async () => {
    const current = ++request, data = await api('/api/balances');
    if (current !== request || !panel.isConnected) return;
    const next = JSON.stringify(data); if (next === previous) return;
    const detailsOpen = panel.querySelector('details')?.open || false;
    panel.replaceChildren();
    panel.append(el('div', { class: 'row balance-heading' }, el('h2', { text: 'Мои счета' }), button('Указать остаток', () => edit(null), true)));
    const totals = el('div', { class: 'balance-totals' });
    for (const total of data.totals) totals.append(el('div', { class: 'balance-total' }, el('span', { class: 'subtle', text: 'Известный баланс · ' + total.currency }), el('strong', { text: money(total.amountMinor) }), el('span', { class: 'subtle', text: total.knownCount < total.accountCount ? 'Неполный баланс · ' + total.knownCount + ' из ' + total.accountCount + ' счетов' : total.incomplete ? 'Нужно обновить остатки · на ' + total.oldestDate : 'Остатки на ' + total.oldestDate })));
    if (!data.totals.length) totals.append(el('p', { class: 'subtle', text: 'Актуальных остатков пока нет. Укажи баланс карты или наличных.' }));
    panel.append(totals);
    const list = el('div', { class: 'balance-list' });
    const accountRow = account => {
      const hint = account.conflict ? 'Остатки источников расходятся — уточни вручную' : !account.asOf ? 'Остаток неизвестен' : account.asOf + ' · ' + account.source + (account.incomplete ? ' · нужно обновить' : '');
      return el('div', { class: 'balance-account' }, el('div', {}, el('strong', { text: account.name }), el('small', { class: 'subtle', text: hint })), el('div', { class: 'balance-value' }, el('strong', { text: money(account.amountMinor) + ' ' + account.currency }), button('Изменить', () => edit(account), true)));
    };
    data.accounts.filter(account => account.included).forEach(account => list.append(accountRow(account)));
    const excluded = data.accounts.filter(account => !account.included);
    if (excluded.length) {
      const details = el('details', {}, el('summary', { text: 'Не включены в итог · ' + excluded.length }), ...excluded.map(accountRow)); details.open = detailsOpen; list.append(details);
    }
    const accounts = el('details', { class: 'balance-accounts' }, el('summary', { text: 'Счета · ' + data.accounts.filter(account => account.included).length }), list, el('p', { class: 'subtle balance-footnote', text: 'Последние известные остатки, независимо от периода дашборда. Карты без операций за 30 дней изначально не включены. Валюты считаются отдельно. Указание остатка не создаёт доход или расход.' })); accounts.open = detailsOpen;
    panel.append(accounts);
    previous = next;
  };
  function edit(account) {
    const dateToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const type = select([['card', 'Карта'], ['cash', 'Наличные']], account?.type || 'card'); type.disabled = !!account;
    const name = el('input', { value: account?.name || '', maxlength: '120', required: true });
    const card = el('input', { value: account?.cardSuffix || '', maxlength: '4', inputmode: 'numeric', pattern: '[0-9]{4}' }); card.disabled = !!account;
    const currency = select([['UZS', 'UZS · сум'], ['USD', 'USD · доллар'], ['EUR', 'EUR · евро'], ['RUB', 'RUB · рубль'], ...(account && !['UZS', 'USD', 'EUR', 'RUB'].includes(account.currency) ? [[account.currency, account.currency]] : [])], account?.currency || 'UZS'); currency.disabled = !!account;
    const amount = el('input', { inputmode: 'decimal', value: '', 'aria-label': 'Новый остаток', placeholder: account?.amountMinor === null || !account ? '0,00' : money(account.amountMinor) });
    const asOf = el('input', { type: 'date', value: dateToday, max: dateToday, required: true });
    const included = el('input', { type: 'checkbox', checked: account?.included ?? true });
    const cardField = field('Последние четыре цифры', card);
    const updateType = () => { cardField.hidden = type.value !== 'card'; card.required = type.value === 'card'; }; updateType(); type.onchange = updateType;
    const body = el('div', { class: 'form-grid' }, field('Тип', type), field('Название', name), cardField, field('Валюта', currency), field(account ? 'Новый остаток (пусто — оставить)' : 'Остаток', amount, true), field('Дата остатка', el('div', { class: 'row' }, asOf, button('Сегодня', () => asOf.value = dateToday, true)), true), el('label', { class: 'full' }, included, ' Включать в общий баланс'), el('p', { class: 'subtle full', text: 'Это снимок остатка. Он не создаёт операций. Новое банковское сообщение с более поздней датой обновит его автоматически.' }));
    modal(account ? 'Изменить счёт' : 'Указать остаток', body, async () => {
      const input = { ...(account ? { id: account.id } : {}), expectedVersion: account?.version || 0, type: type.value, name: name.value, cardSuffix: card.value.trim(), currency: currency.value, included: included.checked };
      if (amount.value.trim() !== '') {
        const text = amount.value.trim().replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
        if (!/^-?\d{1,13}(?:\.\d{1,2})?$/.test(text)) throw new Error('Укажи число, до двух знаков после запятой.');
        const negative = text.startsWith('-'), [integer, fraction = ''] = text.replace(/^-/, '').split('.');
        const value = (BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n);
        if (value > 100000000000000n || value < -100000000000000n) throw new Error('Проверь остаток.');
        input.amountMinor = Number(value); input.asOf = asOf.value;
      } else if (!account) throw new Error('Укажи остаток, включая 0.');
      await api('/api/balances', { method: 'POST', body: input }); await refresh(); message('Остаток сохранён');
    });
  }
  await refresh();
  return refresh;
}
