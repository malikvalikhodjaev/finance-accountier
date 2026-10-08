import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOrders, categoryOf, cancelledOrder } from '../web/public/order-summary.mjs';
const row = overrides => ({ service: 'yandex_go', title: 'Такси Комфорт', date: '2026-01-02', dateCertainty: 'exact', currency: 'UZS', amountMinor: 2900000, details: {}, ...overrides });

test('Отмены не увеличивают суммы и количество поездок, валюта и еда отделены', () => {
  const report = summarizeOrders([row(), row({ status: 'Отмена указана в истории', amountMinor: 99999999 }), row({ details: { cancelled: true } }), row({ title: 'Пицца', details: { category: 'food' }, amountMinor: 5000000 }), row({ currency: 'USD', amountMinor: 1000 })]);
  const taxi = report.totals.find(item => item.category === 'taxi' && item.currency === 'UZS');
  assert.equal(taxi.amountMinor, '2900000'); assert.equal(taxi.count, 1); assert.equal(taxi.cancelledCount, 2); assert.equal(taxi.cancelledMinor, '102899999');
  assert.equal(report.totals.find(item => item.category === 'food').amountMinor, '5000000');
  assert.equal(report.totals.find(item => item.currency === 'USD').amountMinor, '1000'); assert.equal(report.months.length, 3);
});
test('Месяцы сортируются; неизвестная дата не получает вымышленный месяц', () => {
  const report = summarizeOrders([row({ date: '2026-02-01', dateCertainty: 'inferred_year' }), row({ date: null, dateCertainty: 'unknown' }), row()]);
  assert.deepEqual(report.months.map(item => item.month), ['2026-01', '2026-02']); assert.equal(report.totals[0].count, 3);
  assert.equal(report.totals[0].unknownDateCount, 1); assert.equal(report.totals[0].inferredYearCount, 1); assert.equal(report.totals[0].from, '2026-01-02');
  assert.equal(report.months.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n), 5800000n);
});
test('Большие итоги сохраняют точность, пропущенная сумма не превращается в ноль', () => {
  const rows = Array.from({ length: 1000 }, () => row({ amountMinor: 99999999999999 })); rows.push(row({ amountMinor: null }));
  const report = summarizeOrders(rows); assert.equal(report.totals[0].amountMinor, '99999999999999000'); assert.equal(report.totals[0].count, 1000);
  assert.equal(categoryOf(row({ title: 'Такси Комфорт+' })), 'taxi'); assert.equal(categoryOf(row({ title: 'Пицца' })), 'other');
  assert.equal(cancelledOrder(row({ status: 'Cancelled' })), true);
});
