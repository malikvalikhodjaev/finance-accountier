import { mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVersion, sourceRevision, requireSigningKey } from './workflow.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const version = readVersion();
const revision = sourceRevision();
const key = requireSigningKey();
const locate = (folder, required) => {
  const parent = path.join(root, '.tools', folder);
  const found = readdirSync(parent).map(name => path.join(parent, name)).find(candidate => existsSync(path.join(candidate, required)));
  if (!found) throw new Error('Не найден инструмент ' + required + '. Запусти node bootstrap-tools.mjs.');
  return found;
};
const jdk = locate('jdk', 'bin/java.exe');
const tools = locate('build-tools', 'aapt2.exe');
const platform = locate('platform', 'android.jar');
const build = path.join(root, 'build');
const classes = path.join(build, 'classes');
const dex = path.join(build, 'dex');
const output = path.join(root, 'output');
const generated = path.join(build, 'generated');
mkdirSync(build, { recursive: true });
mkdirSync(output, { recursive: true });
for (const folder of [classes, dex, generated]) {
  const relative = path.relative(build, path.resolve(folder));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Небезопасный путь сборки.');
  if (existsSync(folder)) {
    const realRelative = path.relative(realpathSync(build), realpathSync(folder));
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('Каталог сборки выходит за пределы build.');
    rmSync(folder, { recursive: true, force: true });
  }
  mkdirSync(folder, { recursive: true });
}
const run = (file, args) => execFileSync(file, args, { cwd: root, windowsHide: true, stdio: 'inherit' });
const java = path.join(jdk, 'bin/java.exe');
const androidJar = path.join(platform, 'android.jar');
const src = path.join(root, 'src/uz/rhythm/money');
const sources = readdirSync(src).filter(name => name.endsWith('.java')).map(name => path.join(src, name));
const commitId = revision.commit?.slice(0, 8) || 'local';
if (!/^(?:[a-f0-9]{8}|local)$/.test(commitId)) throw new Error('Некорректный идентификатор Git.');
const buildInfo = path.join(generated, 'BuildInfo.java');
writeFileSync(buildInfo, 'package uz.rhythm.money;\npublic final class BuildInfo {\n    public static final String VERSION = "' + version.name + '";\n    public static final String COMMIT = "' + commitId + (revision.dirty ? '-dev' : '') + '";\n    private BuildInfo() {}\n}\n');
sources.push(buildInfo);
run(path.join(jdk, 'bin/javac.exe'), ['-encoding', 'UTF-8', '--release', '8', '-classpath', androidJar, '-d', classes, ...sources]);
const classesJar = path.join(build, 'classes.jar');
run(path.join(jdk, 'bin/jar.exe'), ['--create', '--file', classesJar, '-C', classes, '.']);
run(java, ['-cp', path.join(tools, 'lib/d8.jar'), 'com.android.tools.r8.D8', '--lib', androidJar, '--min-api', '26', '--output', dex, classesJar]);
const resources = path.join(build, 'resources.zip');
run(path.join(tools, 'aapt2.exe'), ['compile', '--dir', 'res', '-o', 'build/resources.zip']);
const unsigned = path.join(build, 'unsigned.apk');
run(path.join(tools, 'aapt2.exe'), ['link', '-I', path.relative(root, androidJar), '--manifest', 'AndroidManifest.xml', '--min-sdk-version', '26', '--target-sdk-version', '35', '-o', 'build/unsigned.apk', 'build/resources.zip']);
// jar's update command preserves the linked Android resource table and adds classes.dex.
run(path.join(jdk, 'bin/jar.exe'), ['--update', '--file', unsigned, '-C', dex, 'classes.dex']);
const aligned = path.join(build, 'aligned.apk');
run(path.join(tools, 'zipalign.exe'), ['-f', '-p', '4', 'build/unsigned.apk', 'build/aligned.apk']);
const signed = path.join(build, 'signed.apk');
run(java, ['-jar', path.join(tools, 'lib/apksigner.jar'), 'sign', '--ks', key, '--ks-key-alias', 'rhythm-local', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', signed, aligned]);
run(java, ['-jar', path.join(tools, 'lib/apksigner.jar'), 'verify', '--verbose', signed]);
run(path.join(tools, 'zipalign.exe'), ['-c', '-p', '4', path.relative(root, signed)]);
run(path.join(tools, 'aapt2.exe'), ['dump', 'badging', path.relative(root, signed)]);
const sha256 = createHash('sha256').update(readFileSync(signed)).digest('hex');
const filename = 'rhythm-money-' + version.name + '-' + commitId + (revision.dirty ? '-dev' : '') + '-' + sha256.slice(0, 8) + '.apk';
const apk = path.join(output, filename);
if (existsSync(apk)) {
  if (createHash('sha256').update(readFileSync(apk)).digest('hex') !== sha256) throw new Error('Существующий APK отличается; сохранён без изменения.');
} else copyFileSync(signed, apk);
const metadata = { packageId: version.packageId, version: version.name, versionCode: version.code, commit: revision.commit, dirty: revision.dirty, apk: filename, sha256, builtAt: new Date().toISOString() };
if (!existsSync(apk + '.json')) writeFileSync(apk + '.json', JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
writeFileSync(path.join(output, 'latest-build.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log('APK: ' + apk);
