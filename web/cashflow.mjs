import { selectRows, dateRange, fail } from './store.mjs';
import { flowOf } from './flows.mjs';

const day = value => value.toISOString().slice(0, 10);
function start(value, group) {
  if (group === 'month') return value.slice(0, 7) + '-01';
  if (group === 'day') return value;
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return day(date);
}
function next(value, group) {
  const date = new Date(value + 'T00:00:00Z');
  if (group === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCDate(date.getUTCDate() + (group === 'week' ? 7 : 1));
  return day(date);
}
function bins(from, to, group) {
  const result = [];
  for (let at = start(from, group); at <= to; at = next(at, group)) {
    result.push(at);
    if (result.length > 400) return null;
  }
  return result;
}
/** Exact ledger sums. Calendar gaps mean no loaded records, not proven zero spending. */
export function cashflow(rows, filters = {}, requestedGroup = 'month') {
  if (!['day', 'week', 'month'].includes(requestedGroup)) fail('Выбери дни, недели или месяцы.');
  const selected = selectRows(rows, filters), dated = selected.filter(row => row.date && !['ignored', 'duplicate'].includes(row.state));
  const range = dateRange(filters), dates = dated.map(row => row.date).sort();
  const from = range.from || dates[0], to = filters.to || (range.from ? range.to : dates.at(-1));
  let group = requestedGroup, starts = from && to ? bins(from, to, group) : [];
  if (!starts) { group = 'month'; starts = bins(from, to, group); }
  if (!starts) fail('Период слишком большой. Выбери меньший диапазон.');
  const codes = [...new Set(dated.map(row => row.currency).filter(Boolean))].sort();
  const currencies = codes.map(currency => {
    const points = starts.map(at => {
      const end = new Date(next(at, group) + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() - 1);
      return { label: group === 'month' ? at.slice(0, 7) : at, from: at < from ? from : at, to: day(end) > to ? to : day(end), incomeMinor: 0n, expenseMinor: 0n, incomingMinor: 0n, incomeCount: 0, expenseCount: 0, incomingCount: 0, reviewCount: 0, loadedCount: 0 };
    });
    const byDate = new Map(points.map(point => [start(point.from, group), point]));
    for (const row of dated.filter(row => row.currency === currency)) {
      const point = byDate.get(start(row.date, group)); if (!point) continue;
      point.loadedCount++; if (row.state === 'review') point.reviewCount++;
      if (!(row.amount_minor > 0)) continue;
      if (row.state === 'recorded' && ['income', 'expense'].includes(row.kind)) {
        point[row.kind + 'Minor'] += BigInt(row.amount_minor); point[row.kind + 'Count']++;
      }
      if (['recorded', 'review'].includes(row.state) && flowOf(row) === 'incoming') {
        point.incomingMinor += BigInt(row.amount_minor); point.incomingCount++;
      }
    }
    const totals = { incomeMinor: 0n, expenseMinor: 0n, incomingMinor: 0n, incomeCount: 0, expenseCount: 0, incomingCount: 0, reviewCount: 0, loadedCount: 0 };
    for (const point of points) for (const key of Object.keys(totals)) totals[key] += point[key];
    const serialise = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, typeof value === 'bigint' ? String(value) : value]));
    return { currency, totals: serialise(totals), points: points.map(serialise) };
  });
  return { group, requestedGroup, adjusted: group !== requestedGroup, from: from || null, to: to || null, currencies, excludedCount: selected.filter(row => ['ignored', 'duplicate'].includes(row.state)).length, undatedCount: selected.filter(row => !row.date).length };
}
