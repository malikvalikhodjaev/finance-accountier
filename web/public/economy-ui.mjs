import { calculatePlan } from './economy-math.mjs';

export async function renderEconomy(panel, context) {
  const { el, button, money, field, select, api, modal, editRow, state, render, message } = context;
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' }).format(new Date());
  const month = el('input', { type: 'month', value: state.economyMonth ?? now, max: now, 'aria-label': 'Месяц экономики' });
  const currency = select([...new Set(['UZS', ...state.meta.currencies])].map(code => [code, code]), state.economyCurrency || 'UZS'); currency.setAttribute('aria-label', 'Валюта экономики');
  const actual = el('section', { class: 'widget economy-actual', 'aria-label': 'Факт личной экономики' }), scenario = el('section', { id: 'economy-monthly-model', class: 'widget economy-scenario', 'aria-label': 'Месячная модель экономики' });
  const explanation = el('p', { class: 'subtle', text: 'Личная адаптация throughput-модели по полученным и потраченным деньгам: заработок − прямые переменные затраты = throughput; затем вычитаются рабочие расходы и расходы на жизнь. Инвестиционные платежи показаны отдельно.' });
  const compact = document.documentElement.classList.contains('embedded-app');
  const controls = el('div', { class: 'filters economy-controls' }, field('Период', month), field('Валюта', currency), button('Вся история', () => { month.value = ''; state.economyMonth = ''; return refresh(); }, true));
  const help = el('details', { class: 'economy-help' }, el('summary', { text: 'Как считается моя экономика' }), explanation);
  const model = el('a', { href: '#economy-monthly-model', text: 'Модель обычного месяца' });
  panel.replaceChildren(...(compact ? [controls, actual, help, model, scenario] : [explanation, controls, model, actual, scenario]));
  state.economyDrafts ||= {};
  let report, plan, request = 0, actualKey = '', planKey = '';
  const periodFilters = () => {
    if (!month.value) return { period: 'all' };
    const [year, number] = month.value.split('-').map(Number), end = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
    return { from: month.value + '-01', to: end };
  };
  const table = filters => { state.filters = { ...periodFilters(), ...filters }; state.tab = 'table'; history.replaceState(null, '', '/?tab=table'); render(); };
  const metric = (label, value, caption = '') => el('div', { class: 'economy-metric' }, el('span', { text: label }), el('strong', { text: value === null ? 'Нет данных' : money(value) + ' ' + currency.value }), caption ? el('small', { text: caption }) : null);
  async function refresh() {
    const generation = state.generation, ticket = ++request;
    state.economyMonth = month.value; state.economyCurrency = currency.value;
    const params = new URLSearchParams(periodFilters()); params.set('currency', currency.value);
    const [nextReport, nextPlan] = await Promise.all([api('/api/economy?' + params), api('/api/economy/plan?currency=' + currency.value)]);
    if (generation !== state.generation || ticket !== request || state.tab !== 'dashboard' || state.boardId !== 'economy') return;
    const nextActual = JSON.stringify([nextReport, month.value, currency.value]), nextScenario = JSON.stringify([nextPlan, currency.value]);
    report = nextReport; plan = nextPlan;
    if (actualKey !== nextActual) { drawActual(); actualKey = nextActual; }
    if (planKey !== nextScenario) { drawScenario(); planKey = nextScenario; }
  }
  function bulk(kind) {
    const rows = report.unassigned.filter(row => row.kind === kind && row.currency === currency.value);
    if (!rows.length) { message(kind === 'income' ? 'Подтверждённых доходов без роли за этот период нет. Сначала уточни поступления в таблице.' : 'Подтверждённых расходов без роли за этот период нет.'); return; }
    const total = rows.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
    const options = kind === 'expense' ? ['living', 'work', 'variable', 'investment', 'exclude'] : ['earned', 'other', 'financing', 'exclude'];
    const role = select(options.map(key => [key, report.roles[key]]), kind === 'expense' ? 'living' : 'earned'); role.setAttribute('aria-label', 'Роль выбранных операций');
    modal('Разметить операции выбранного периода', el('div', {}, el('p', { text: rows.length + ' операций без роли, сумма ' + money(total) + ' ' + currency.value + '. Период: ' + (month.value || 'вся загруженная история') + '.' }), field('Назначить роль', role), el('p', { class: 'subtle', text: 'Эта роль будет назначена всем перечисленным по количеству операциям без роли данного типа и валюты. Отдельные исключения удобнее сначала разметить в таблице.' })), async () => {
      await api('/api/economy/classify', { method: 'POST', body: { role: role.value, rows: rows.map(row => ({ id: row.id, expectedVersion: row.version })) } });
      await refresh(); message('Роли сохранены с историей изменений');
    });
  }
  function drawActual() {
    const total = report.totals.find(item => item.currency === currency.value);
    const head = el('div', { class: 'chart-heading' }, el('div', {}, el('h2', { text: 'Факт · ' + (month.value || 'вся история') }), el('p', { class: 'subtle economy-fact-note', text: 'Только подтверждённые операции с назначенной ролью. Переводы между своими картами, повторы и история заказов не прибавляются к заработку.' })), button('Операции периода', () => table({ currency: currency.value }), true));
    actual.replaceChildren(head);
    if (!total) { actual.append(el('p', { text: 'За выбранный период нет распознанных сумм в этой валюте. Это не означает нулевой доход или расход.' })); return; }
    const known = total.earnedCount > 0;
    const cost = role => total[role + 'Count'] || !total.unassignedCount ? total[role] : null;
    actual.append(el('div', { class: 'economy-badge ' + (total.incomplete ? 'review' : '') , text: total.incomplete ? 'Частичный факт · проверь полноту доходов и разметку' : 'По размеченным операциям · полнота выписок не подтверждена' }));
    actual.append(el('div', { class: 'economy-grid' }, metric('Полученный заработок', known ? total.earned : null), metric('Прямые переменные затраты', cost('variable'), 'По размеченным операциям'), metric('Throughput · T', total.throughputMinor, 'Заработок − прямые затраты'), metric('Рабочие расходы · OE', cost('work'), 'Расходы, не зависящие напрямую от объёма заработка'), metric('Результат работы', total.operatingMinor, 'T − рабочие расходы'), metric('Расходы на жизнь', cost('living')), metric('Личный остаток', total.personalMinor, 'Результат работы − личные расходы'), metric('Инвестиционные платежи', cost('investment')), metric('После инвестиций', total.availableMinor, 'Личный остаток − инвестиционные платежи')));
    actual.append(el('p', { class: 'subtle', text: 'Прочие доходы: ' + money(total.other) + ' ' + currency.value + '. Финансирование: ' + money(total.financing) + ' ' + currency.value + '. Это отдельные движения. Остаток модели не является балансом карт.' }));
    const coverage = el('div', { class: 'economy-coverage' }, el('h3', { text: 'Что ещё нужно разобрать' }), el('p', { text: 'Подтверждённые расходы без роли: ' + money(total.unassignedExpense) + ' ' + currency.value + '. Доходы без роли: ' + money(total.unassignedIncome) + ' ' + currency.value + '.' }), el('p', { class: 'subtle', text: 'На уточнении: ' + total.pendingCount + ' операций; поступления с известной суммой — ' + money(total.pendingIncoming) + ' ' + currency.value + '. Они не считаются заработком. Записей без суммы, даты или валюты: ' + report.unreadableCount + '.' }), el('div', { class: 'actions expanded' }, button('Разметить расходы без роли', () => bulk('expense'), true), button('Разметить доходы без роли', () => bulk('income'), true), button('Уточнить поступления', () => table({ currency: currency.value, flow: 'incoming', state: 'review' }), true), button('Добавить отсутствующий заработок', () => editRow(null, { kind: 'income', category: 'Доход', custom: { [report.fields.role]: report.roles.earned } }), true)));
    actual.append(coverage);
    const sources = report.sources.filter(item => item.currency === currency.value);
    if (sources.length) {
      const section = el('details', {}, el('summary', { text: 'Источники заработка · ' + sources.length })), body = el('tbody');
      for (const item of sources) body.append(el('tr', {}, el('td', { text: item.source }), el('td', { text: money(item.earned) }), el('td', { text: money(item.variable) }), el('td', { text: money(item.throughputMinor) })));
      section.append(el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Источник', 'Заработок', 'Прямые затраты', 'T'].map(text => el('th', { text })))), body))); actual.append(section);
    }
    const periods = report.months.filter(item => item.currency === currency.value), body = el('tbody');
    const maximum = periods.reduce((value, item) => { const cost = BigInt(item.unassignedExpense) + BigInt(item.variable) + BigInt(item.work) + BigInt(item.living); return cost > value ? cost : value; }, 1n);
    for (const item of periods) {
      const cost = BigInt(item.unassignedExpense) + BigInt(item.variable) + BigInt(item.work) + BigInt(item.living);
      const positive = cost > 0n ? cost : 0n;
      body.append(el('tr', {}, el('td', { text: item.month }), el('td', { text: item.earnedCount ? money(item.earned) : 'Нет данных' }), el('td', { text: money(item.throughputMinor) }), el('td', { text: money(item.personalMinor) }), el('td', { text: money(item.unassignedExpense) }), el('td', {}, el('progress', { max: '10000', value: String(positive * 10000n / maximum), 'aria-label': 'Расходы ' + item.month }))));
    }
    actual.append(el('details', {}, el('summary', { text: 'По месяцам · ' + periods.length }), el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Месяц', 'Заработок', 'T', 'Личный остаток', 'Расходы без роли', 'Расходы'].map(text => el('th', { text })))), body))));
  }
  function drawScenario() {
    scenario.replaceChildren(el('h2', { text: 'Модель обычного месяца · ' + currency.value }), el('p', { class: 'subtle', text: 'План и сценарий отделены от банковского факта. Введи 0 для отсутствующих затрат. Пустое поле означает, что данных пока нет. Изменения показываются сразу; кнопка сохраняет модель.' }));
    const labels = { revenueMinor: 'Заработок за месяц', variableBps: 'Прямые затраты, % от заработка', workMinor: 'Рабочие постоянные расходы', livingMinor: 'Расходы на жизнь', investmentMinor: 'Инвестиционные платежи за месяц', goalMinor: 'Желаемый свободный остаток' }, inputs = {}, form = el('div', { class: 'form-grid' }), results = el('div', { class: 'economy-plan-result' }), status = el('p', { class: 'subtle', role: 'status' });
    const display = (value, percentage = false) => value == null ? '' : String(BigInt(value) / 100n) + '.' + String(BigInt(value) % 100n).padStart(2, '0');
    const parse = (text, percentage = false) => {
      const clean = text.trim().replace(/[ \u00a0\u202f]/g, '').replace(',', '.'); if (!clean) return null;
      if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(clean)) throw new Error('Введи неотрицательное число с максимум двумя знаками после запятой.');
      const [whole, fraction = ''] = clean.split('.'), value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
      if (value > BigInt(percentage ? 10000 : 100000000000000)) throw new Error(percentage ? 'Процент: от 0 до 100.' : 'Слишком большая сумма.');
      return Number(value);
    };
    const draft = state.economyDrafts[currency.value], baseVersion = draft?.version ?? plan.version;
    const inputPlan = () => ({ currency: currency.value, ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, parse(input.value, key === 'variableBps')])) });
    const draw = () => {
      try {
        const calculation = calculatePlan(inputPlan()); status.textContent = 'Черновик · ещё не сохранён';
        if (!calculation.complete) { results.replaceChildren(el('p', { text: 'Для расчёта заполни все шесть параметров. Можно указать ноль.' })); return; }
        results.replaceChildren(el('div', { class: 'economy-grid' }, metric('Throughput', calculation.throughputMinor), metric('Результат работы', calculation.operatingMinor), metric('Личный остаток', calculation.personalMinor), metric('После инвестиций', calculation.availableMinor), metric('Разница с целью', calculation.goalGapMinor), metric('Заработок для цели', calculation.requiredRevenueMinor, calculation.requiredRevenueMinor === null ? 'При прямых затратах 100% заработок не создаёт throughput' : 'При этой доле затрат и этих ежемесячных расходах')));
      } catch (error) { status.textContent = error.message; results.replaceChildren(); }
    };
    for (const [key, label] of Object.entries(labels)) {
      const input = el('input', { value: draft?.values[key] ?? display(plan[key]), inputmode: 'decimal', 'aria-label': label }); inputs[key] = input; input.oninput = () => { state.economyDrafts[currency.value] = { version: baseVersion, values: Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])) }; draw(); }; form.append(field(label, input));
    }
    scenario.append(form, results, status, button('Сохранить месячную модель', async () => {
      const next = inputPlan(), response = await api('/api/economy/plan', { method: 'POST', body: { ...next, expectedVersion: state.economyDrafts[currency.value]?.version ?? plan.version } });
      delete state.economyDrafts[currency.value]; plan = response; drawScenario();
    }));
    draw(); status.textContent = draft ? baseVersion !== plan.version ? 'Черновик сохранён в этой вкладке. Модель изменилась в другой вкладке; сохранение потребует сверки.' : 'Черновик · ещё не сохранён' : plan.version ? 'Сохранённая модель · версия ' + plan.version : 'Модель пока не заполнена';
  }
  month.onchange = () => refresh().catch(error => message(error.message)); currency.onchange = () => refresh().catch(error => message(error.message));
  state.refreshBoard = refresh;
  await refresh();
}
