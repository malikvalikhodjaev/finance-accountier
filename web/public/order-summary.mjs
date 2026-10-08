export const orderCategories = { food: 'Еда', taxi: 'Такси', other: 'Другие заказы' };
export const categoryOf = row => ['food', 'taxi'].includes(row.details?.category) ? row.details.category : row.service === 'yandex_go' && /^Такси(?:\s|$)/u.test(row.title) ? 'taxi' : 'other';
export const cancelledOrder = row => row.details?.cancelled === true || /отмен|cancelled|canceled/iu.test(row.status || '');

export function summarizeOrders(rows) {
  const totals = new Map(), months = new Map();
  for (const row of rows) {
    const category = categoryOf(row), currency = row.currency;
    if (!currency || row.amountMinor == null) continue;
    const key = category + '|' + currency;
    if (!totals.has(key)) totals.set(key, { category, currency, count: 0, cancelledCount: 0, unknownDateCount: 0, inferredYearCount: 0, amountMinor: 0n, cancelledMinor: 0n, from: null, to: null });
    const total = totals.get(key), amount = BigInt(row.amountMinor);
    if (cancelledOrder(row)) { total.cancelledCount++; total.cancelledMinor += amount; continue; }
    total.count++; total.amountMinor += amount;
    if (!row.date) total.unknownDateCount++;
    else {
      if (!total.from || row.date < total.from) total.from = row.date;
      if (!total.to || row.date > total.to) total.to = row.date;
      if (row.dateCertainty === 'inferred_year') total.inferredYearCount++;
      const month = row.date.slice(0, 7), monthKey = month + '|' + key;
      if (!months.has(monthKey)) months.set(monthKey, { month, category, currency, count: 0, amountMinor: 0n });
      months.get(monthKey).count++; months.get(monthKey).amountMinor += amount;
    }
  }
  const serialize = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? String(value) : value]));
  return { totals: [...totals.values()].map(serialize), months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category)).map(serialize) };
}
