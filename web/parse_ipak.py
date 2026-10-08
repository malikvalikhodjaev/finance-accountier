"""Read the four-column history PDF explicitly selected as Ipak Yuli."""
import json
import re
from datetime import date


def extract(pages):
    text = '\n'.join(page['text'] for page in pages)
    period = re.search(r'^История\s+(\d{4}-\d{2}-\d{2})\s+-\s+(\d{4}-\d{2}-\d{2})', text)
    if not period:
        raise ValueError('Не распознан PDF истории Ipak Yuli: нужен заголовок «История» и период.')
    start, end = period.groups()
    date.fromisoformat(start)
    date.fromisoformat(end)
    if start > end:
        raise ValueError('Некорректный период истории Ipak Yuli.')
    rows = []
    for page in pages:
        for table in page['tables']:
            for cells in table:
                if len(cells) != 4 or any(not isinstance(cell, str) or not cell.strip() for cell in cells):
                    raise ValueError('Не удалось полностью прочитать строку истории Ipak Yuli.')
                day, operation, counterparty, amount = cells
                day = day.strip()
                date.fromisoformat(day)
                if not start <= day <= end:
                    raise ValueError('Дата операции выходит за период истории.')
                operation = operation.strip()
                if operation not in ('Конверсия', 'Перевод'):
                    raise ValueError('Неизвестный тип операции Ipak Yuli. Нужна проверка формата.')
                match = re.fullmatch(r'(\d[\d \u00a0\u202f]*)(?:\.(\d{1,2}))?\s+([A-Z]{3})', amount.strip())
                if not match:
                    raise ValueError('Не распознаны сумма и валюта в истории Ipak Yuli.')
                major = re.sub(r'\s+', '', match[1])
                minor = int(major) * 100 + int((match[2] or '').ljust(2, '0'))
                if minor > 100000000000000:
                    raise ValueError('Сумма выходит за допустимые пределы.')
                rows.append({'documentDate': day, 'documentNumber': str(len(rows) + 1),
                             'postingDate': day, 'postingTime': None, 'amountMinor': minor,
                             'currency': match[3], 'operation': operation,
                             'counterparty': re.sub(r'\s+', ' ', counterparty).strip(),
                             'details': operation + ': ' + re.sub(r'\s+', ' ', counterparty).strip(),
                             'fragments': [{'page': page['page'], 'cells': cells}]})
        # Every dated row in the page text must have a corresponding table row.
        dated_lines = re.findall(r'^\d{4}-\d{2}-\d{2}\s+(?:Конверсия|Перевод)\b', page['text'], re.M)
        if len(dated_lines) != sum(len(table) for table in page['tables']):
            raise ValueError('Не все строки страницы попали в таблицу. Исходник сохранён для сверки.')
    if not rows or len(rows) > 10000:
        raise ValueError('В истории не найдена поддерживаемая таблица операций.')
    return {'source': 'ipak-history-pdf-v1', 'period': {'from': start, 'to': end},
            'pages': len(pages), 'rows': rows}


def read_pdf(filename):
    import pdfplumber
    with pdfplumber.open(filename) as pdf:
        if len(pdf.pages) > 500:
            raise ValueError('Больше 500 страниц. Выгрузи меньший период.')
        return extract([{'page': i + 1, 'text': page.extract_text() or '', 'tables': page.extract_tables()}
                        for i, page in enumerate(pdf.pages)])
