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

from parse_ipak import extract as extract_ipak
ipak_cells = ['2026-01-02', 'Перевод', 'TEST\nPERSON', '3 USD']
ipak = [{'page': 1, 'text': 'История\n2026-01-01 - 2026-01-31\n2026-01-02 Перевод TEST 3 USD\n2026-01-02 Перевод TEST 3 USD', 'tables': [[ipak_cells, ipak_cells[:]]]}]
history = extract_ipak(ipak)
assert len(history['rows']) == 2
assert [r['documentNumber'] for r in history['rows']] == ['1', '2']
assert all(r['amountMinor'] == 300 and r['postingTime'] is None for r in history['rows'])
assert history['rows'][0]['fragments'][0]['cells'] == ipak_cells
for value, expected in [('730 437.50 UZS', 73043750), ('139.80 USD', 13980), ('11 000 RUB', 1100000), ('0 UZS', 0)]:
    cells = [*ipak_cells[:3], value]
    one = [{'page': 1, 'text': 'История\n2026-01-01 - 2026-01-31\n2026-01-02 Перевод TEST ' + value, 'tables': [[cells]]}]
    assert extract_ipak(one)['rows'][0]['amountMinor'] == expected
for invalid in [
    [{**ipak[0], 'tables': [[ipak_cells]]}],  # Never silently drop the second row.
    [{**ipak[0], 'text': 'Other statement'}],
    [{**ipak[0], 'tables': [[['2026-02-02', *ipak_cells[1:]], ipak_cells]]}],
    [{**ipak[0], 'tables': [[[*ipak_cells[:3], '3.001 USD'], ipak_cells]]}],
    [{**ipak[0], 'tables': [[['2026-01-02', 'Покупка', *ipak_cells[2:]], ipak_cells]]}],
]:
    try:
        extract_ipak(invalid)
        raise AssertionError('Unsupported history accepted')
    except ValueError:
        pass
print('Ipak history: separate identical rows, three currencies, zero, missing direction and complete page coverage checked.')

from parse_payme import extract as extract_payme, HEADERS
cheque = ['02-01-2026', '12:34:56', 'Списание', 'TEST SHOP', 'TEST COMPANY', 66473.16,
          'продукты', '', '', '123456******1234', 'TEST CARD', '', 'Payme', 'Оплачен', 'TEST POINT', 'TEST TERMINAL']
cancelled = ['', '', *cheque[2:13], 'Отменен', *cheque[14:]]
data = [HEADERS, cheque, cheque[:], cancelled]
payment = extract_payme(data, {2: '66473.16', 3: '66473.16', 4: '66473.16'}, '20260101_20261231.xlsx')
assert len(payment['rows']) == 3
assert [r['occurrence'] for r in payment['rows']] == [1, 2, 1]
assert payment['rows'][0]['amountMinor'] == 6647316
assert payment['rows'][0]['cardSuffix'] == '1234'
assert payment['rows'][2]['postingDate'] is None and not payment['rows'][2]['paid']
assert payment['rows'][0]['fragments'][0]['cells'] == cheque
assert payment['rows'][0]['fragments'][0]['row'] == 2
assert payment['period'] == {'from': '2026-01-01', 'to': '2026-12-31'}
assert payment['coverage'] == {'from': '2026-01-02', 'to': '2026-01-02'}
for invalid_rows, invalid_numeric, name in [
    ([HEADERS, ['', *cheque[1:]]], {2: '1'}, 'file.xlsx'),
    ([HEADERS, cheque], {2: '0.001'}, 'file.xlsx'),
    ([HEADERS, cheque], {2: 'NaN'}, 'file.xlsx'),
    ([HEADERS, cheque], {}, 'file.xlsx'),
    ([HEADERS, ['=NOW()', *cheque[1:]]], {2: '1'}, 'file.xlsx'),
    ([HEADERS[:-1], cheque], {2: '1'}, 'file.xlsx'),
    ([HEADERS, cheque], {2: '1'}, '20250101_20251231.xlsx'),
]:
    try:
        extract_payme(invalid_rows, invalid_numeric, name)
        raise AssertionError('Unsupported Payme input accepted')
    except ValueError:
        pass
print('Payme: exact XML cents, cancelled rows without dates, separate identical rows, coverage and invalid inputs checked.')
