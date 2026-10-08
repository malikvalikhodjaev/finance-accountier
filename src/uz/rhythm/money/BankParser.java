package uz.rhythm.money;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Adapters for the owner's UZCARD and HUMO SMS formats; source text is preserved. */
public final class BankParser {
    private static final Pattern START = Pattern.compile("(?i)(OTMENA debit online|Debit online|Platezh|Platej|Popolnenie nalichnimi v ATM|Popolnenie scheta|Spisanie [cs] karty|E-Com oplata|Vidacha nalichnykh v bankomate|Pokupka|Perevod na kartu|Online to['‘’]lov|To['‘’]lov|Kartadan chiqim|Kirim|Kartaga o['‘’]tkazma|Vozvrat):\\s*");
    private static final Pattern WHEN = Pattern.compile("(?<!\\d)(\\d{2})\\.(\\d{2})\\.(\\d{2})\\s+(\\d{2}):(\\d{2})(?!\\d)");
    private static final Pattern AMOUNT = Pattern.compile("(?i)\\b(?:summa|Miqdor)\\s*:\\s*([0-9]+(?:[.,][0-9]{1,2})?)\\s+([A-Z]{3})\\b");
    private static final Pattern BALANCE = Pattern.compile("(?i)\\b(?:balans|Qoldiq)\\s*:\\s*([0-9]+(?:[.,][0-9]{1,2})?)\\s+([A-Z]{3})\\b");
    private static final Pattern CARD = Pattern.compile("(?i)\\bkarta\\s*\\*+(\\d{4})\\b");
    private static final Pattern HUMO = Pattern.compile("(?i)^HUMOCARD\\s+\\*(\\d{4}):\\s*(oplata|popolnenie)\\s+([0-9]+(?:[.,][0-9]{1,2})?)\\s+([A-Z]{3});\\s*([^;\\r\\n]+);\\s*(\\d{2})-(\\d{2})-(\\d{2})\\s+(\\d{2}):(\\d{2});\\s*Dostupno:\\s*([0-9]+(?:[.,][0-9]{1,2})?)\\s+([A-Z]{3})\\s*$");
    private BankParser() {}

    public static final class Transaction {
        public String raw, operation, merchant, date, time, currency, cardSuffix, kind, category, reviewReason, signature;
        public long amountMinor;
        public Long balanceMinor;
    }
    public static List<Transaction> parse(String raw) {
        List<Transaction> result = new ArrayList<>();
        if (Formats.authenticationText(raw)) return result;
        for (String block : fragments(raw)) {
            Transaction transaction = parseBlock(block);
            if (transaction != null) result.add(transaction);
        }
        return result;
    }
    /** Preserve malformed blocks so the inbox can queue them for review instead of dropping them. */
    public static List<String> fragments(String raw) {
        List<String> result = new ArrayList<>();
        List<Integer> starts = new ArrayList<>();
        Matcher boundaries = START.matcher(raw);
        while (boundaries.find()) starts.add(boundaries.start());
        if (starts.isEmpty()) { result.add(raw); return result; }
        if (starts.get(0) > 0 && !raw.substring(0, starts.get(0)).trim().isEmpty()) result.add(raw.substring(0, starts.get(0)));
        for (int index = 0; index < starts.size(); index++) {
            String block = raw.substring(starts.get(index), index + 1 < starts.size() ? starts.get(index + 1) : raw.length());
            result.add(block);
        }
        return result;
    }
    private static Transaction parseBlock(String raw) {
        if (Formats.authenticationText(raw)) return null;
        if (raw.regionMatches(true, 0, "HUMOCARD", 0, 8)) return parseHumo(raw);
        Matcher operation = START.matcher(raw), when = WHEN.matcher(raw), amount = AMOUNT.matcher(raw), card = CARD.matcher(raw);
        if (!operation.find() || operation.start() != 0 || !when.find() || !amount.find() || !card.find()) return null;
        if (when.start() < operation.end() || amount.start() <= when.end()) return null;
        // Never guess when an SMS has multiple different amounts under the same field name.
        String amountText = amount.group(1), currencyText = amount.group(2);
        if (amount.find()) return null;
        try {
            Transaction t = new Transaction();
            t.raw = raw;
            t.operation = operation.group(1);
            if (t.operation.toLowerCase(Locale.ROOT).startsWith("otmena")) return null;
            String sellerAndLocation = raw.substring(operation.end(), when.start()).replaceFirst("[,\\s]+$", "");
            t.merchant = sellerAndLocation.split(",", 2)[0].trim();
            if (t.merchant.isEmpty()) {
                if (!t.operation.equalsIgnoreCase("Popolnenie scheta")) return null;
                t.merchant = "Отправитель не указан";
            }
            t.date = LocalDate.of(2000 + Integer.parseInt(when.group(3)), Integer.parseInt(when.group(2)), Integer.parseInt(when.group(1))).toString();
            Formats.validateDate(t.date);
            t.time = LocalTime.of(Integer.parseInt(when.group(4)), Integer.parseInt(when.group(5))).toString();
            t.amountMinor = Formats.amountMinor(amountText);
            t.currency = Formats.currency(currencyText);
            t.cardSuffix = card.group(1);
            Matcher balance = BALANCE.matcher(raw);
            if (balance.find() && balance.group(2).equalsIgnoreCase(t.currency)) {
                java.math.BigDecimal value = new java.math.BigDecimal(balance.group(1).replace(',', '.'));
                t.balanceMinor = value.movePointRight(2).longValueExact();
            }
            String op = t.operation.toLowerCase(Locale.ROOT), merchant = t.merchant.toLowerCase(Locale.ROOT);
            t.kind = "expense";
            t.category = merchant.contains("yandex go") ? "Яндекс Go" : "Без категории";
            t.reviewReason = "";
            if (op.startsWith("vidacha nalichnykh") || op.startsWith("popolnenie nalichnimi")) {
                t.kind = "transfer"; t.category = "Карта ↔ наличные";
            } else if (op.startsWith("popolnenie scheta") || op.startsWith("perevod") || op.equals("kirim") || op.startsWith("kartaga ") || op.equals("vozvrat") || merchant.contains("p2p") || merchant.contains("popolnenie vklada") || merchant.contains("exchange") || op.startsWith("spisanie") || op.equals("debit online") || op.equals("kartadan chiqim") || merchant.startsWith("frb ")) {
                t.kind = "unknown"; t.category = "";
                t.reviewReason = op.startsWith("popolnenie") || op.startsWith("perevod") || op.equals("kirim") || op.startsWith("kartaga ") || op.equals("vozvrat") ? "Поступление: доход, возврат или перевод своих денег?" : "Списание: покупка, перевод своих денег или перевод другому человеку?";
            }
            // This is a candidate match, not proof of identity. Balance may be absent in push.
            t.signature = Formats.fingerprint("bank-latin-v1", t.cardSuffix, t.date + "T" + t.time, merchant, t.amountMinor + "|" + t.currency);
            return t;
        } catch (RuntimeException error) { return null; }
    }
    private static Transaction parseHumo(String raw) {
        Matcher match = HUMO.matcher(raw);
        if (!match.matches()) return null;
        try {
            Transaction t = new Transaction(); t.raw = raw;
            t.cardSuffix = match.group(1); t.operation = match.group(2).equalsIgnoreCase("popolnenie") ? "Popolnenie scheta" : "HUMO oplata";
            t.amountMinor = Formats.amountMinor(match.group(3)); t.currency = Formats.currency(match.group(4)); t.merchant = match.group(5).trim();
            // HUMO prints YY-MM-DD, unlike UZCARD's DD.MM.YY.
            t.date = LocalDate.of(2000 + Integer.parseInt(match.group(6)), Integer.parseInt(match.group(7)), Integer.parseInt(match.group(8))).toString();
            Formats.validateDate(t.date); t.time = LocalTime.of(Integer.parseInt(match.group(9)), Integer.parseInt(match.group(10))).toString();
            if (!match.group(12).equalsIgnoreCase(t.currency) || t.merchant.isEmpty()) return null;
            t.balanceMinor = new java.math.BigDecimal(match.group(11).replace(',', '.')).movePointRight(2).longValueExact();
            String merchant = t.merchant.toLowerCase(Locale.ROOT);
            boolean funding = t.operation.equals("Popolnenie scheta");
            boolean unclear = funding || merchant.contains("p2p") || merchant.contains("humo2") || merchant.contains("uzcard2") || merchant.contains("visa to") || merchant.contains("exchange");
            t.kind = unclear ? "unknown" : "expense"; t.category = unclear ? "" : merchant.contains("yandex") ? "Яндекс Go" : "Без категории";
            t.reviewReason = unclear ? funding ? "Поступление: доход, возврат или перевод своих денег?" : "Списание: покупка или перевод своих денег?" : "";
            t.signature = Formats.fingerprint("bank-latin-v1", t.cardSuffix, t.date + "T" + t.time, merchant, t.amountMinor + "|" + t.currency);
            return t;
        } catch (RuntimeException error) { return null; }
    }
}
