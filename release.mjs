import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { root, run, git, readVersion, parseVersion, newerVersion, requireSigningKey, latestBuild, sourceRevision } from './workflow.mjs';
import { resolvePhone, phoneProfile, installCurrent } from './phone.mjs';

function privateFiles() {
  const names = git(['ls-files', '--cached', '--others', '--exclude-standard']).split(/\r?\n/);
  const forbidden = names.filter(name => /^(?:\.signing|\.samples|\.phone|\.web|\.tools|build|output)\//.test(name) || ['tests/dashboard-import.mjs', 'tests/acceptance/payment-purpose.feature'].includes(name));
  if (forbidden.length) throw new Error('Личные файлы попали в Git: ' + forbidden.join(', '));
}
function validate() {
  for (const args of [['test.mjs'], ['--test', 'tests/workflow.test.mjs', 'tests/web.test.mjs', 'tests/imports.test.mjs', 'tests/cashflow.test.mjs', 'tests/orders.test.mjs']]) console.log(run(process.execPath, args));
  console.log(run('python', ['tests/migration.py']));
  console.log(run('python', ['tests/imports_parser.py']));
}
function build() { console.log(run(process.execPath, ['build.mjs'])); }
function taggedCommit(tag) {
  try { return git(['rev-parse', '--verify', 'refs/tags/' + tag + '^{commit}']); }
  catch { return null; }
}

const args = process.argv.slice(2);
if (args.includes('--help') || !args.length) {
  console.log('Выпуск: node release.mjs 0.2.1 --message "Показ версии и обновление по Wi-Fi"');
  console.log('Повтор после остановки: node release.mjs 0.2.1 --resume');
  console.log('Дополнительно: --no-install (без телефона), --no-push (только локальный Git).');
} else {
  let lock, original, changedXml, committed = false;
  try {
    const next = args[0];
    parseVersion(next);
    let message = '', resume = false, push = true, install = true;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--message') { message = args[++i]; if (!message?.trim()) throw new Error('После --message нужен текст.'); }
      else if (args[i] === '--resume') resume = true;
      else if (args[i] === '--no-push') push = false;
      else if (args[i] === '--no-install') install = false;
      else throw new Error('Неизвестный аргумент: ' + args[i]);
    }
    if (realpathSync(git(['rev-parse', '--show-toplevel'])).toLowerCase() !== realpathSync(root).toLowerCase()) throw new Error('Нужен отдельный Git проекта finance-collector.');
    const initialHead = git(['rev-parse', 'HEAD']);
    git(['symbolic-ref', '--short', 'HEAD']);
    if (push) git(['remote', 'get-url', 'origin']);
    requireSigningKey();
    privateFiles();
    const previous = readVersion(), tag = 'v' + next;
    const existingTag = taggedCommit(tag);
    if (resume) {
      if (previous.name !== next || sourceRevision().dirty || (existingTag && existingTag !== initialHead)) throw new Error('--resume требует чистый Git с текущей версией и соответствующим тегом.');
      committed = true;
    } else {
      if (!newerVersion(next, previous.name) || existingTag) throw new Error('Новая версия должна быть выше ' + previous.name + ', а тег — свободен.');
      if (previous.code >= 2100000000) throw new Error('Лимит versionCode достигнут.');
    }
    const device = install ? resolvePhone() : null;
    if (device) phoneProfile(device);
    mkdirSync(path.join(root, '.phone'), { recursive: true });
    lock = path.join(root, '.phone', 'release.lock');
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
    const ownedLock = lock;
    lock = null;
    try {
      if (!resume) {
        original = previous.xml;
        changedXml = original.replace(/android:versionName="[^"]+"/, 'android:versionName="' + next + '"').replace(/android:versionCode="\d+"/, 'android:versionCode="' + (previous.code + 1) + '"');
        writeFileSync(path.join(root, 'AndroidManifest.xml'), changedXml);
        validate();
        build();
        if (git(['rev-parse', 'HEAD']) !== initialHead) throw new Error('Git-коммит изменился во время подготовки выпуска.');
        privateFiles();
        git(['add', '.']);
        git(['commit', '-m', 'Release ' + next + ': ' + (message || 'обновление приложения')]);
        committed = true;
        build();
      } else {
        let saved;
        try { saved = latestBuild(); } catch { /* Build metadata may be absent after an interrupted compilation. */ }
        if (!saved || saved.commit !== initialHead || saved.dirty || saved.version !== next || !existsSync(saved.apkPath)) build();
      }
      const head = git(['rev-parse', 'HEAD']), artifact = latestBuild();
      if (artifact.commit !== head || artifact.dirty || sourceRevision().dirty || artifact.version !== next || artifact.versionCode !== readVersion().code) throw new Error('APK не соответствует чистому сохранённому коммиту.');
      if (!taggedCommit(tag)) git(['tag', '-a', tag, '-m', 'Ритм · деньги ' + next]);
      if (taggedCommit(tag) !== head) throw new Error('Тег указывает на другой коммит.');
      if (push) {
        console.log('Отправляю исходники и теги в origin.');
        console.log(run('git', ['-c', 'credential.interactive=false', 'push', '--atomic', '--follow-tags', '-u', 'origin', 'HEAD']));
      }
      if (device) installCurrent(device);
      console.log('Выпуск ' + next + ' завершён. Git ' + head.slice(0, 8) + (push ? ' отправлен в origin' : ' сохранён локально') + (install ? '; приложение открыто на телефоне по Wi-Fi.' : '; установка пропущена.'));
    } finally { unlinkSync(ownedLock); }
  } catch (error) {
    if (!committed && original && readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8') === changedXml) writeFileSync(path.join(root, 'AndroidManifest.xml'), original);
    console.error(error.message);
    if (error.stderr) console.error(String(error.stderr));
    if (error.stdout) console.error(String(error.stdout));
    if (committed) console.error('Сохранённая версия осталась в Git. Для продолжения: node release.mjs ' + args[0] + ' --resume');
    process.exitCode = 1;
  }
}
