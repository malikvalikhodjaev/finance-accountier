import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { root, run, readVersion, latestBuild, sourceRevision } from './workflow.mjs';

const folder = path.join(root, '.phone');
const configPath = path.join(folder, 'device.json');
export function config() { return existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : { serverPort: 15037 }; }
export function adb(args, serial = null, options = {}) {
  const settings = config();
  const port = settings.serverPort ?? 15037;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Некорректный порт ADB.');
  const executable = path.join(root, '.tools', 'adb', 'platform-tools', 'adb.exe');
  if (!existsSync(executable)) throw new Error('Сначала выполни node bootstrap-adb.mjs.');
  return run(executable, ['-P', String(port), ...(serial ? ['-s', serial] : []), ...args], options);
}
export function validateEndpoint(value) {
  const match = String(value).match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
  if (!match || match[1].split('.').some(octet => Number(octet) > 255) || Number(match[2]) < 1 || Number(match[2]) > 65535) throw new Error('Введи IPv4-адрес и порт с экрана «Отладка по Wi-Fi».');
  return value;
}
export function rememberPhone(endpoint, expectedSerial = null) {
  validateEndpoint(endpoint);
  const current = config();
  const physicalSerial = adb(['shell', 'getprop', 'ro.serialno'], endpoint).trim();
  if (!physicalSerial || !/^[A-Za-z0-9_-]+$/.test(physicalSerial)) throw new Error('Не удалось определить серийный номер телефона.');
  const expected = expectedSerial || current.physicalSerial;
  if (expected && physicalSerial !== expected) throw new Error('Это другой телефон; настройки прежнего устройства сохранены.');
  mkdirSync(folder, { recursive: true });
  writeFileSync(configPath, JSON.stringify({ serverPort: current.serverPort ?? 15037, physicalSerial, endpoint }, null, 2) + '\n');
  return endpoint;
}
function connectedDevices() {
  return adb(['devices']).split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(fields => fields[1] === 'device').map(fields => fields[0]);
}
function isWireless(serial) { return serial.includes(':') || serial.includes('._adb-tls-connect._tcp'); }
export function resolvePhone({ usb = false, serial = null } = {}) {
  const settings = config();
  if (usb) {
    const devices = connectedDevices().filter(id => !isWireless(id) && !id.startsWith('emulator-'));
    const selected = serial || (devices.length === 1 ? devices[0] : null);
    if (!selected || !devices.includes(selected)) throw new Error('Выбери единственный подключённый USB-телефон или передай --serial.');
    if (settings.physicalSerial && adb(['shell', 'getprop', 'ro.serialno'], selected).trim() !== settings.physicalSerial) throw new Error('Подключён другой телефон.');
    return selected;
  }
  if (!settings.physicalSerial) throw new Error('Wi-Fi ещё не настроен. Выполни node phone.mjs pair, затем node phone.mjs connect.');
  const matches = device => {
    try { return adb(['shell', 'getprop', 'ro.serialno'], device, { timeout: 8000 }).trim() === settings.physicalSerial; }
    catch { return false; }
  };
  const online = connectedDevices().filter(isWireless).find(matches);
  if (online) return online;
  let discovered = [];
  try {
    discovered = adb(['mdns', 'services']).split(/\r?\n/).map(line => line.trim().split(/\s+/))
      .filter(fields => fields[0]?.startsWith('adb-' + settings.physicalSerial + '-') && fields[1]?.startsWith('_adb-tls-connect._tcp'))
      .map(fields => fields.at(-1));
  } catch { /* An explicitly remembered address still works without mDNS. */ }
  for (const endpoint of [...new Set([...discovered, settings.endpoint].filter(Boolean))]) {
    try {
      validateEndpoint(endpoint);
      adb(['connect', endpoint], null, { timeout: 12000 });
      if (matches(endpoint)) return rememberPhone(endpoint);
    } catch { /* Try only the known phone's next advertised endpoint. */ }
  }
  throw new Error('Телефон недоступен по Wi-Fi. Включи «Отладка по Wi-Fi», подключи его к той же сети и обнови адрес через node phone.mjs connect.');
}
export function phoneProfile(device) {
  const profile = adb(['shell', 'am', 'get-current-user'], device).trim();
  if (!/^\d+$/.test(profile)) throw new Error('Не определён профиль телефона.');
  const line = adb(['shell', 'dumpsys', 'user'], device).split(/\r?\n/).find(value => value.includes('UserInfo{' + profile + ':'));
  if (line && /:(Режим отладки|Debug mode):/i.test(line)) throw new Error('Выйди из отдельного «Режима отладки» Xiaomi через его уведомление. Для сборщика нужен обычный профиль с банками.');
  const sdk = Number(adb(['shell', 'getprop', 'ro.build.version.sdk'], device).trim());
  if (!Number.isInteger(sdk) || sdk < 26) throw new Error('Нужен Android 8.0 или новее.');
  return profile;
}
function permissions(device, profile, packageId) {
  const text = adb(['shell', 'dumpsys', 'package', packageId], device);
  const listeners = adb(['shell', 'settings', '--user', profile, 'get', 'secure', 'enabled_notification_listeners'], device).trim();
  return {
    questions: /android\.permission\.POST_NOTIFICATIONS: granted=true/.test(text),
    sms: /android\.permission\.RECEIVE_SMS: granted=true/.test(text),
    notifications: listeners.split(':').some(listener => listener.startsWith(packageId + '/'))
  };
}
export function installCurrent(device) {
  const version = readVersion(), build = latestBuild(), profile = phoneProfile(device);
  const revision = sourceRevision();
  if (!build.commit || revision.dirty || revision.commit !== build.commit) throw new Error('APK должен соответствовать текущему чистому Git-коммиту.');
  if (build.packageId !== version.packageId || build.version !== version.name || build.versionCode !== version.code || build.dirty) throw new Error('Сборка должна соответствовать сохранённой версии Git. Выполни выпуск или его --resume.');
  const bytes = readFileSync(build.apkPath);
  if (createHash('sha256').update(bytes).digest('hex') !== build.sha256) throw new Error('APK изменился после проверки сборки.');
  const before = permissions(device, profile, version.packageId);
  console.log('Обновляю ' + version.name + ' по ' + (isWireless(device) ? 'Wi-Fi' : 'USB') + '; профиль ' + profile + '.');
  try { console.log(adb(['install', '--no-incremental', '-r', '--user', profile, build.apkPath], device)); }
  catch (error) {
    const details = String(error.stderr || '') + String(error.stdout || '');
    if (details.includes('INSTALL_FAILED_USER_RESTRICTED')) throw new Error('Xiaomi отклонил установку. В обычном профиле включи «Установка через USB» и подтверди установку на телефоне, затем выполни node phone.mjs install. Удалять приложение не нужно.');
    throw error;
  }
  const installed = adb(['shell', 'dumpsys', 'package', version.packageId], device);
  if (Number(installed.match(/\bversionCode=(\d+)/)?.[1]) !== version.code || installed.match(/\bversionName=([^\s]+)/)?.[1] !== version.name) throw new Error('Установленная версия не совпала со сборкой.');
  const launched = adb(['shell', 'am', 'start', '-W', '--user', profile, '-n', version.packageId + '/.MainActivity'], device);
  if (!/^Status: ok\s*$/m.test(launched)) throw new Error('APK установлен, но запуск не подтверждён: ' + launched);
  const after = permissions(device, profile, version.packageId);
  const preserved = Object.keys(before).every(key => !before[key] || after[key]);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'last-install.json'), JSON.stringify({ version: version.name, versionCode: version.code, commit: build.commit, sha256: build.sha256, transport: isWireless(device) ? 'wifi' : 'usb', profile, installedAt: new Date().toISOString(), permissionsBefore: before, permissionsAfter: after, permissionsPreserved: preserved }, null, 2) + '\n');
  console.log('Открыта версия ' + version.name + ', сборка ' + build.commit.slice(0, 8) + '.');
  if (!preserved) throw new Error('Версия установлена, но одно из прежних разрешений нужно включить заново.');
  return build;
}
async function main() {
  const [command, argument, ...extra] = process.argv.slice(2);
  if (command === 'pair') {
    const prompts = createInterface({ input: stdin, output: stdout });
    try {
      const endpoint = validateEndpoint(argument || (await prompts.question('Адрес и порт из окна сопряжения: ')).trim());
      const code = (await prompts.question('Шестизначный код с телефона: ')).trim();
      if (!/^\d{6}$/.test(code)) throw new Error('Код должен содержать шесть цифр.');
      console.log(adb(['pair', endpoint, code]));
      console.log('Теперь выполни node phone.mjs connect с адресом основного экрана отладки по Wi-Fi.');
    } finally { prompts.close(); }
  } else if (command === 'connect') {
    const prompts = createInterface({ input: stdin, output: stdout });
    try {
      const endpoint = validateEndpoint(argument || (await prompts.question('Адрес и порт с основного экрана отладки по Wi-Fi: ')).trim());
      console.log(adb(['connect', endpoint]));
      rememberPhone(endpoint);
      phoneProfile(endpoint);
      console.log('Телефон сохранён для следующих обновлений по Wi-Fi.');
    } finally { prompts.close(); }
  } else if (command === 'install' || command === 'status') {
    const flags = [argument, ...extra].filter(Boolean);
    const serialIndex = flags.indexOf('--serial');
    const device = resolvePhone({ usb: flags.includes('--usb'), serial: serialIndex >= 0 ? flags[serialIndex + 1] : null });
    if (command === 'install') installCurrent(device);
    else console.log(JSON.stringify({ device, profile: phoneProfile(device), version: readVersion().name, wifi: isWireless(device) }, null, 2));
  } else {
    console.log('Команды: node phone.mjs pair | connect | status | install. По умолчанию используется только Wi-Fi; --usb выбирается явно.');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
