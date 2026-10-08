"""Select a verified export reader; never modify the source file."""
import json
import sys
from parse_uzum import read_pdf as read_uzum
from parse_ipak import read_pdf as read_ipak
from parse_payme import read_xlsx as read_payme


if __name__ == '__main__':
    try:
        source = sys.argv[2] if len(sys.argv) > 2 else 'uzum'
        if source not in ('uzum', 'ipak', 'payme'):
            raise ValueError('Выбери источник выписки: Uzum Bank, Ipak Yuli или Payme.')
        parsed = read_payme(sys.argv[1], sys.argv[3]) if source == 'payme' else (read_ipak if source == 'ipak' else read_uzum)(sys.argv[1])
        print(json.dumps(parsed, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
