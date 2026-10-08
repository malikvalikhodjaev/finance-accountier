import pathlib
import re
import sqlite3

root = pathlib.Path(__file__).resolve().parents[1]
legacy = (root / 'tests/fixtures/schema-v1.sql').read_text(encoding='utf-8')
current = (root / 'src/uz/rhythm/money/EventStore.java').read_text(encoding='utf-8')
old_statements = [statement.strip() for statement in legacy.split(';') if statement.strip()]
upgrade_statements = re.findall(r'db\.execSQL\("(ALTER TABLE [^"]+)"\)', current)
assert len(upgrade_statements) == 2
connection = sqlite3.connect(':memory:')
for sql in old_statements:
    connection.execute(sql)
original = {
    'id': 'legacy-payment', 'fingerprint': 'legacy-unique', 'source_type': 'sms',
    'source_name': 'BANK', 'source_ref': 'BANK', 'received_at': '2024-01-22T15:55:00Z',
    'event_millis': 1705938900000, 'raw_title': 'BANK',
    'raw_text': 'Pokupka: SHOP, karta ***1234. summa:5000.00 UZS',
    'raw_fragment': 'Pokupka: SHOP, karta ***1234. summa:5000.00 UZS',
    'state': 'recorded', 'amount_minor': 500000, 'currency': 'UZS', 'kind': 'expense',
    'date': '2024-01-22', 'time': '20:55', 'merchant': 'SHOP',
    'category': 'Без категории', 'description': 'SHOP',
}
columns = list(original)
connection.execute('INSERT INTO events (' + ','.join(columns) + ') VALUES (' + ','.join('?' for _ in columns) + ')', list(original.values()))
connection.execute('INSERT INTO revisions VALUES (?, ?, ?)', ('legacy-payment', '2024-01-22T16:00:00Z', '{"raw":"unchanged"}'))
connection.commit()
for sql in upgrade_statements:
    connection.execute(sql)
connection.commit()
connection.row_factory = sqlite3.Row
row = dict(connection.execute('SELECT * FROM events').fetchone())
assert all(row[key] == value for key, value in original.items())
assert row['purpose'] == '' and row['bank_operation'] == ''
assert connection.execute('SELECT previous_json FROM revisions').fetchone()[0] == '{"raw":"unchanged"}'
connection.execute('UPDATE events SET purpose = ? WHERE id = ?', ('обед', 'legacy-payment'))
updated = dict(connection.execute('SELECT * FROM events').fetchone())
assert updated['purpose'] == 'обед'
assert updated['raw_text'] == original['raw_text'] and updated['amount_minor'] == original['amount_minor']
print('Migration 1 -> 2 verified against the archived schema: amounts, source texts and revision history preserved.')
