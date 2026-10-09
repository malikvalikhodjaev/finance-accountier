/** Direction of an observed movement; incoming funds can be own transfers or refunds. */
export function flowOf(row) {
  if (row.kind === 'income') return 'incoming';
  if (row.kind === 'expense') return 'outgoing';
  const operation = String(row.bank_operation || '').trim();
  if (/^(?:popolnenie(?: scheta| nalichnimi)|perevod na kartu|kirim\b|kartaga o['‘’]tkazma|vozvrat\b|(?:поступление|зачисление)(?=\s|$)|возврат оплаты|закрытие\/списание со вклада на пк)/iu.test(operation)) return 'incoming';
  if (/^(?:platezh\b|platej\b|spisanie\b|debit online\b|e-com oplata\b|pokupka\b|humo oplata\b|vidacha nalichnykh|(?:online )?to['‘’]lov\b|kartadan chiqim\b|(?:списание|оплата|перевод отправлен)(?=\s|$)|p2p c пк(?=\s|$))/iu.test(operation)) return 'outgoing';
  return 'unknown';
}
