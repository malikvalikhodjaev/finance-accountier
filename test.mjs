import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const jdkRoot = path.join(root, '.tools/jdk');
const jdk = readdirSync(jdkRoot).map(name => path.join(jdkRoot, name)).find(folder => existsSync(path.join(folder, 'bin/java.exe')));
const output = path.join(root, 'build/test-classes'); mkdirSync(output, { recursive: true });
const run = (tool, args) => execFileSync(path.join(jdk, 'bin', tool + '.exe'), args, { windowsHide: true, stdio: 'inherit' });
run('javac', ['-encoding', 'UTF-8', '--release', '8', '-d', output,
  path.join(root, 'src/uz/rhythm/money/Formats.java'), path.join(root, 'src/uz/rhythm/money/BankParser.java'),
  path.join(root, 'src/uz/rhythm/money/PurposeRules.java'),
  path.join(root, 'src/uz/rhythm/money/IncomeReminderRules.java'), path.join(root, 'tests/ReminderTests.java'),
  path.join(root, 'src/uz/rhythm/money/HistoryRules.java'), path.join(root, 'tests/HistoryTests.java'),
  path.join(root, 'src/uz/rhythm/money/OwnTransfers.java'), path.join(root, 'tests/TransferTests.java'),
  path.join(root, 'src/uz/rhythm/money/PdfRules.java'), path.join(root, 'tests/PdfTests.java'),
  path.join(root, 'tests/ParserTests.java'), path.join(root, 'tests/ParseMessages.java'), path.join(root, 'tests/PurposeTests.java')]);
run('java', ['-cp', output, 'uz.rhythm.money.ParserTests']);
run('java', ['-cp', output, 'uz.rhythm.money.PurposeTests']);
run('java', ['-cp', output, 'uz.rhythm.money.ReminderTests']);
run('java', ['-cp', output, 'uz.rhythm.money.HistoryTests']);
run('java', ['-cp', output, 'uz.rhythm.money.TransferTests']);
run('java', ['-cp', output, 'uz.rhythm.money.PdfTests']);
if (existsSync(path.join(root, '.samples/user-messages.txt'))) {
  run('java', ['-cp', output, 'uz.rhythm.money.ParseMessages', path.join(root, '.samples/user-messages.txt'), path.join(root, 'build/sample-operations.csv')]);
}
