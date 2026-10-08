import test from 'node:test';
import assert from 'node:assert/strict';
import { cashflow } from '../web/cashflow.mjs';
const row = overrides => ({ date: '2026-01-10', received_at: '2026-01-10T10:00:00Z', state: 'recorded', kind: 'expense', currency: 'UZS', amount_minor: 12345, custom: {}, ...overrides });

test('Доходы, расходы и оборот поступлений разделены; переводы и повторы не становятся заработком', () => {
  const rows = [row(), row({ kind: 'income', amount_minor: 2345 }), row({ kind: 'transfer', bank_operation: 'Popolnenie scheta', amount_minor: 50000 }), row({ state: 'review', kind: 'unknown', bank_operation: 'Kirim', amount_minor: 40000 }), row({ state: 'review', amount_minor: 30000 }), row({ state: 'duplicate' }), row({ state: 'ignored' }), row({ currency: 'USD', amount_minor: 1299 })], raw = JSON.stringify(rows);
  const data = cashflow(rows), sums = data.currencies.find(item => item.currency === 'UZS').totals;
  assert.equal(sums.incomeMinor, '2345'); assert.equal(sums.expenseMinor, '12345'); assert.equal(sums.incomingMinor, '92345'); assert.equal(sums.reviewCount, 2); assert.equal(data.excludedCount, 2);
  assert.equal(data.currencies.find(item => item.currency === 'USD').totals.expenseMinor, '1299'); assert.equal(JSON.stringify(rows), raw);
});
test('Суммы выше точности Number считаются без округления и возвращаются строками', () => {
  const data = cashflow(Array.from({ length: 100 }, () => row({ amount_minor: 100000000000000 })));
  assert.equal(data.currencies[0].points[0].expenseMinor, '10000000000000000');
});
test('Неделя начинается в понедельник; крайние периоды не расширяют выбранные даты', () => {
  const data = cashflow([row({ date: '2026-01-04' }), row({ date: '2026-01-05', kind: 'income' })], { from: '2026-01-04', to: '2026-01-07' }, 'week');
  assert.deepEqual(data.currencies[0].points.map(point => [point.label, point.from, point.to]), [['2025-12-29', '2026-01-04', '2026-01-04'], ['2026-01-05', '2026-01-05', '2026-01-07']]);
  assert.equal(data.currencies[0].points[0].expenseMinor, '12345'); assert.equal(data.currencies[0].points[1].incomeMinor, '12345');
});
test('Пропуски истории видны как отсутствие загруженных записей', () => {
  const data = cashflow([row({ date: '2026-01-01' }), row({ date: '2026-03-01' })]);
  assert.equal(data.currencies[0].points.length, 3); assert.equal(data.currencies[0].points[1].loadedCount, 0); assert.equal(data.currencies[0].points[1].expenseMinor, '0');
  assert.equal(cashflow([], {}, 'day').currencies.length, 0);
});
test('Большая история переключается на месяцы целиком; фильтр периода применяется до расчётов', () => {
  const rows = [row({ date: '2020-01-01' }), row({ date: '2026-01-01' })], data = cashflow(rows, {}, 'day');
  assert.equal(data.adjusted, true); assert.equal(data.group, 'month'); assert.equal(data.currencies[0].totals.expenseMinor, '24690'); assert.equal(data.currencies[0].points.length, 73);
  assert.equal(cashflow(rows, { from: '2025-01-01', to: '2026-01-02' }, 'day').currencies[0].totals.expenseMinor, '12345');
  assert.throws(() => cashflow(rows, { from: '2026-02-01', to: '2026-01-01' }), /Начальная дата/); assert.throws(() => cashflow(rows, {}, 'year'), /дни/);
});
