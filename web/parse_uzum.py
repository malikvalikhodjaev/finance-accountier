"""Read Uzum account statements without modifying the source PDF."""
import json
import re
import sys
from datetime import datetime


def date(value):
    return datetime.strptime(value, '%d.%m.%Y').strftime('%Y-%m-%d')


def extract(pages):
    text = '\n'.join(page['text'] for page in pages)
    if not re.search(r'UZUM BANK|UZUM BANK JSC', text, re.I):
        raise ValueError('Нужна выписка по счёту Uzum Bank.')
    period = re.search(r'period from\s+(\d{2}\.\d{2}\.\d{4})\s+to\s+(\d{2}\.\d{2}\.\d{4})', text, re.I)
    account = re.search(r'account No\.\s*(\d{20})\s+in\s+([A-Z]{3})\s+currency', text)
    if not period or not account:
        raise ValueError('Не распознан шаблон выписки. Выбери английский язык документа в Uzum Bank.')
    start, end = map(date, period.groups())
    if start > end:
        raise ValueError('Некорректный период выписки.')
    rows = []
    header_seen = False
    for page in pages:
        for table in page['tables']:
            for cells in table:
                if len(cells) != 5:
                    raise ValueError('Неожиданное число колонок в выписке.')
                cells = [cell or '' for cell in cells]
                if 'Operation' in cells[0] and 'Document' in cells[2]:
                    header_seen = True
                    continue
                if re.fullmatch(r'\d+', cells[2]):
                    rows.append({'cells': cells[:], 'fragments': [{'page': page['page'], 'cells': cells[:]}]})
                elif not cells[1] and not cells[2] and rows:
                    if cells[3] and re.fullmatch(r'\d+,\d{2}', re.sub(r'\s+', '', rows[-1]['cells'][3])):
                        raise ValueError('Неожиданное продолжение уже полной суммы.')
                    rows[-1]['fragments'].append({'page': page['page'], 'cells': cells[:]})
                    for index, cell in enumerate(cells):
                        if cell:
                            rows[-1]['cells'][index] += '\n' + cell
                elif any(cells):
                    raise ValueError('Не удалось связать строку на границе страниц.')
    if not header_seen or not rows or len(rows) > 10000:
        raise ValueError('В выписке не найдена поддерживаемая таблица операций.')
    result, keys = [], set()
    for row in rows:
        operation, document_date, number, amount, details = row['cells']
        stamp = operation.split()
        if len(stamp) != 2:
            raise ValueError('Не распознаны дата и время операции.')
        posting_date = date(stamp[0])
        datetime.strptime(stamp[1], '%H:%M:%S')
        if not start <= posting_date <= end:
            raise ValueError('Дата проведения выходит за период выписки.')
        document_date = date(document_date.strip())
        amount = re.sub(r'[\s\u00a0\u202f]', '', amount)
        if not re.fullmatch(r'\d+,\d{2}', amount):
            raise ValueError('Не распознана сумма операции.')
        major, fraction = amount.split(',')
        minor = int(major) * 100 + int(fraction)
        if not 0 < minor <= 100000000000000:
            raise ValueError('Сумма выходит за допустимые пределы.')
        key = document_date + ':' + number
        if key in keys:
            raise ValueError('В исходной таблице повторяется номер документа за одну дату.')
        keys.add(key)
        flattened = re.sub(r'\s+', ' ', details).strip()
        flattened = re.sub(r'(20\d{2}-\d{2}-)\s+(\d{2})', r'\1\2', flattened)
        authorization = re.search(r'\.xml,\s*(20\d{2}-\d{2}-\d{2})\s+(\d{2})\.(\d{2})\.(\d{2})', flattened)
        result.append({'documentDate': document_date, 'documentNumber': number, 'postingDate': posting_date,
                       'postingTime': stamp[1], 'amountMinor': minor, 'details': flattened,
                       'authorizationDate': authorization[1] if authorization else None,
                       'authorizationTime': ':'.join(authorization.groups()[1:]) if authorization else None,
                       'fragments': row['fragments']})
    return {'source': 'uzum-account-pdf-v1', 'account': account[1], 'currency': account[2],
            'period': {'from': start, 'to': end}, 'pages': len(pages), 'rows': result}


def read_pdf(filename):
    import pdfplumber
    with pdfplumber.open(filename) as pdf:
        if len(pdf.pages) > 500:
            raise ValueError('Выписка содержит больше 500 страниц. Выбери меньший период.')
        pages = [{'page': index + 1, 'text': page.extract_text() or '', 'tables': page.extract_tables()}
                 for index, page in enumerate(pdf.pages)]
    return extract(pages)


if __name__ == '__main__':
    try:
        print(json.dumps(read_pdf(sys.argv[1]), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
