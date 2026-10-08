import pathlib
import re
import sqlite3

root = pathlib.Path(__file__).resolve().parents[1]
legacy = (root / 'tests/fixtures/schema-v1.sql').read_text(encoding='utf-8')
current = (root / 'src/uz/rhythm/money/EventStore.java').read_text(encoding='utf-8')
old_statements = [statement.strip() for statement in legacy.split(';') if statement.strip()]
upgrade_statements = re.findall(r'db\.execSQL\("(ALTER TABLE [^"]+)"\)', current)
assert len(upgrade_statements) == 7
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
assert row['local_revision'] == 1 and row['synced_revision'] == 0 and row['server_version'] == 0
assert row['server_base'] == '' and row['sync_conflict'] == ''
assert connection.execute('SELECT previous_json FROM revisions').fetchone()[0] == '{"raw":"unchanged"}'
connection.execute('UPDATE events SET purpose = ? WHERE id = ?', ('обед', 'legacy-payment'))
updated = dict(connection.execute('SELECT * FROM events').fetchone())
assert updated['purpose'] == 'обед'
assert updated['raw_text'] == original['raw_text'] and updated['amount_minor'] == original['amount_minor']
second = sqlite3.connect(':memory:')
for sql in old_statements + upgrade_statements[:2]:
    second.execute(sql)
second.execute('INSERT INTO events (' + ','.join(columns) + ') VALUES (' + ','.join('?' for _ in columns) + ')', list(original.values()))
for sql in upgrade_statements[2:]:
    second.execute(sql)
second.row_factory = sqlite3.Row
row2 = dict(second.execute('SELECT * FROM events').fetchone())
assert all(row2[key] == value for key, value in original.items())
assert row2['local_revision'] == 1 and row2['synced_revision'] == 0
fresh = sqlite3.connect(':memory:')
fresh.execute(re.search(r'db\.execSQL\("(CREATE TABLE events [^"]+)"\)', current)[1])
for sql in upgrade_statements[2:]:
    fresh.execute(sql)
assert {'local_revision', 'server_version', 'sync_conflict'} <= {row[1] for row in fresh.execute('PRAGMA table_info(events)')}
indexes = re.findall(r'db\.execSQL\("(CREATE INDEX IF NOT EXISTS [^"]+)"\)', current)
assert len(indexes) == 4
for database in [connection, second]:
    for sql in indexes:
        database.execute(sql)
    assert database.execute('SELECT raw_text FROM events').fetchone()[0] == original['raw_text']
fresh.execute('CREATE TABLE revisions(event_id TEXT, changed_at TEXT, previous_json TEXT)')
for sql in indexes:
    fresh.execute(sql)
connection.execute('CREATE TABLE sync_state(name TEXT PRIMARY KEY,value TEXT NOT NULL)')
connection.execute('INSERT INTO sync_state VALUES (?,?)', ('sms_history','{"lastId":200,"scanned":200}'))
connection.execute('INSERT INTO sync_state VALUES (?,?)', ('cursor','100'))
connection.execute("DELETE FROM sync_state WHERE name != 'sms_history'")
assert connection.execute('SELECT value FROM sync_state').fetchone()[0] == '{"lastId":200,"scanned":200}'
print('Migrations 1 -> 4, 2 -> 4, 3 -> 4 and fresh schema verified: raw texts, exact amounts and revisions preserved; history checkpoint survives changing sync server.')
