import test from 'node:test';
import assert from 'node:assert/strict';
import { PageCache } from '../web/public/page-cache.mjs';

test('Возврат во вкладку сохраняет готовый экран, строки и позицию прокрутки', () => {
  const cache = new PageCache(), page = cache.create('table'); page.ready = true;
  const payload = { nodes: [{}], rows: [{ id: 'test-row' }], scroll: 420 };
  cache.save(page, 'month:UZS', payload);
  const restored = cache.take('table', 'month:UZS');
  assert.equal(restored.payload, payload); assert.equal(restored.generation, page.generation);
  assert.equal(restored.payload.scroll, 420); assert.equal(cache.take('table', 'month:UZS'), null);
  assert.ok(cache.create('dashboard').generation > page.generation);
});

test('Изменение фильтров, колонок или метаданных не возвращает прежний экран', () => {
  const cache = new PageCache(), page = cache.create('table'); page.ready = true;
  for (const signature of ['filter:USD', 'columns:new', 'fields:changed']) {
    cache.save(page, 'filter:UZS', {}); assert.equal(cache.take('table', signature), null);
  }
  cache.save(cache.create('loading'), '', {}); assert.equal(cache.take('loading', ''), null);
});

test('Сохранение операции и выход очищают данные; поздний старый ответ не оживляет кэш', () => {
  const cache = new PageCache(), old = cache.create('dashboard'); old.ready = true;
  cache.save(old, '', { balance: 'test' }); cache.invalidate();
  assert.equal(cache.take('dashboard', ''), null);
  cache.save(old, '', {}); assert.equal(cache.take('dashboard', ''), null);
  const next = cache.create('table'); next.ready = true; cache.save(next, '', {});
  assert.ok(cache.take('table', '')); assert.ok(next.generation > old.generation);
});

test('Кэш ограничен тремя экранами и живёт только в памяти', () => {
  const cache = new PageCache();
  for (let index = 0; index < 4; index++) { const page = cache.create(String(index)); page.ready = true; cache.save(page, '', { index }); }
  assert.equal(cache.pages.size, 3); assert.equal(cache.take('0', ''), null);
  assert.equal(cache.take('3', '').payload.index, 3);
});
