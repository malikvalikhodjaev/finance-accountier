import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, newerVersion } from '../workflow.mjs';
import { validateEndpoint } from '../phone.mjs';

test('Версии сравниваются численно и не допускают повторный выпуск', () => {
  assert.equal(newerVersion('0.10.0', '0.9.9'), true);
  assert.equal(newerVersion('1.0.0', '0.99.99'), true);
  assert.equal(newerVersion('0.2.1', '0.2.0'), true);
  assert.equal(newerVersion('0.2.0', '0.2.0'), false);
  assert.equal(newerVersion('0.1.99', '0.2.0'), false);
  for (const value of ['0.02.1', '0.2', '0.2.1-dev', '0.2.1;shutdown', undefined, '9007199254740992.0.0']) assert.throws(() => parseVersion(value));
});
test('Адрес телефона содержит только IPv4 и допустимый порт', () => {
  assert.equal(validateEndpoint('192.168.100.102:37001'), '192.168.100.102:37001');
  for (const value of ['192.168.1.1:0', '192.168.1.1:65536', '999.1.1.1:10000', '192.168.1.1', '192.168.1.1:12345;shutdown', '--serial']) assert.throws(() => validateEndpoint(value));
});
