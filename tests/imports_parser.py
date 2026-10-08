import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'web'))
from parse_uzum import extract

header = 'UZUM BANK JSC\nfor the period from 01.01.2024 to 31.01.2024\naccount No. 22618000000000001234 in UZS currency'
columns = ['Operation\ndate and\ntime', 'Document\ndate', 'Document\nnumber', 'Transaction\namount', 'Operation details']
start = ['22.01.2024', '22.01.2024', '123456', '12 345,67', 'Оплата с карты Visa UB 123456******1234 по MID ABC']
continued = ['12:34:56', '', '', '', 'в TID XYZ, 2024-01-\n21 11.00.00']
pages = [{'page': 1, 'text': header, 'tables': [[columns, start]]}, {'page': 2, 'text': '', 'tables': [[continued]]}]
result = extract(pages)
assert len(result['rows']) == 1
row = result['rows'][0]
assert row['amountMinor'] == 1234567
assert row['postingDate'] == '2024-01-22' and row['postingTime'] == '12:34:56'
assert row['fragments'][0]['cells'] == start and row['fragments'][1]['cells'] == continued
assert start[0] == '22.01.2024' and start[4].endswith('ABC')
assert result['period'] == {'from': '2024-01-01', 'to': '2024-01-31'}
split_amount = extract([{'page': 1, 'text': header, 'tables': [[columns, [*start[:3], '12', start[4]]]]}, {'page': 2, 'text': '', 'tables': [[[continued[0], '', '', '345,67', continued[4]]]]}])
assert split_amount['rows'][0]['amountMinor'] == 1234567
for invalid in [
    [{'page': 1, 'text': header, 'tables': [[columns, continued]]}],
    [{'page': 1, 'text': header, 'tables': [[columns, start, start]]}],
    [{'page': 1, 'text': header, 'tables': [[columns, [*start[:3], '12,345.67', start[4]], continued]]}],
    [{'page': 1, 'text': header, 'tables': [[columns, ['32.01.2024', *start[1:]], continued]]}],
    [{'page': 1, 'text': 'OTHER BANK', 'tables': [[columns, start, continued]]}],
]:
    try:
        extract(invalid)
        raise AssertionError('Unsupported input accepted')
    except ValueError:
        pass
print('PDF parser: continuation, exact cents, raw preservation and invalid inputs checked.')
