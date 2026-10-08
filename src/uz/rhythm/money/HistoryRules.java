package uz.rhythm.money;

import java.util.Locale;
import java.util.regex.Pattern;

/** History contains service SMS too; retain financial messages, never authentication codes. */
public final class HistoryRules {
    private static final Pattern MONEY = Pattern.compile("(?iu)\\d[\\d .,]*\\s*(?:UZS|USD|EUR|RUB|сум|so['‘’]?m)\\b");
    private static final Pattern MOVEMENT = Pattern.compile("(?iu)(?:platezh|pokupka|oplata|spisanie|popolnenie|perevod|vidacha|summa|balans|покупк|оплат|списан|пополн|перевод|сумма|баланс|to['‘’]?lov|o['‘’]?tkaz|yechil|kirim|chiqim)");
    private HistoryRules() {}
    public static final class DateRange {
        public long first, last;
        public void include(long millis) {
            if (millis <= 0) return;
            if (first == 0 || millis < first) first = millis;
            if (last == 0 || millis > last) last = millis;
        }
    }
    public static boolean bankSender(String sender) {
        String name = sender == null ? "" : sender.toLowerCase(Locale.ROOT).replaceAll("[^a-z]", "");
        return name.contains("uzcard") || name.contains("humo");
    }
    public static boolean financial(String text) {
        if (text == null || text.isEmpty() || Formats.authenticationText(text)) return false;
        return MONEY.matcher(text).find() && MOVEMENT.matcher(text).find();
    }
}
