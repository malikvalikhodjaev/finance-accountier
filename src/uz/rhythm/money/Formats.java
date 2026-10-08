package uz.rhythm.money;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Locale;
import java.util.regex.Pattern;

public final class Formats {
    public static final ZoneId ZONE = ZoneId.of("Asia/Tashkent");
    private static final Pattern AUTH = Pattern.compile(
        "(?iu)(?:\\botp\\b|\\bcode\\b|\\bkod(?:i|ni)?\\b|код|парол|password|verification|verify|tasdiq|подтвержден|подтверждения|не сообщайте|do not share)");
    private Formats() {}

    public static boolean authenticationText(String text) {
        return text != null && AUTH.matcher(text).find();
    }
    public static long amountMinor(String input) {
        String value = input.trim().replace(" ", "").replace("\u00a0", "").replace("\u202f", "");
        if (!value.matches("\\d{1,13}(?:[.,]\\d{1,2})?"))
            throw new IllegalArgumentException("Сумма: число больше нуля, максимум два знака после запятой.");
        BigDecimal amount = new BigDecimal(value.replace(',', '.'));
        if (amount.signum() <= 0 || amount.compareTo(new BigDecimal("1000000000000")) > 0)
            throw new IllegalArgumentException("Сумма должна быть больше нуля и не больше 10¹².");
        return amount.movePointRight(2).longValueExact();
    }
    public static String amount(long minor) {
        return BigDecimal.valueOf(minor, 2).toPlainString();
    }
    public static String displayAmount(long minor) {
        return String.format(Locale.forLanguageTag("ru-RU"), "%,.2f", BigDecimal.valueOf(minor, 2));
    }
    public static String currency(String input) {
        String value = input.trim().toUpperCase(Locale.ROOT);
        if (!value.matches("[A-Z]{3}")) throw new IllegalArgumentException("Валюта: UZS, USD или другой код из трёх букв.");
        return value;
    }
    public static String date(long millis) { return Instant.ofEpochMilli(millis).atZone(ZONE).toLocalDate().toString(); }
    public static String validateDate(String value) {
        if (!value.matches("\\d{4}-\\d{2}-\\d{2}")) throw new IllegalArgumentException("Дата: YYYY-MM-DD.");
        LocalDate day;
        try { day = LocalDate.parse(value); }
        catch (RuntimeException error) { throw new IllegalArgumentException("Некорректная дата."); }
        if (day.isAfter(LocalDate.now(ZONE))) throw new IllegalArgumentException("Оплата не может быть в будущем.");
        return day.toString();
    }
    public static String fingerprint(String source, String identity, String time, String title, String body) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String value : new String[]{source, identity, time, title, body}) {
                byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
                digest.update(new byte[]{(byte)(bytes.length >>> 24), (byte)(bytes.length >>> 16), (byte)(bytes.length >>> 8), (byte)bytes.length});
                digest.update(bytes);
            }
            StringBuilder result = new StringBuilder();
            for (byte value : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", value & 255));
            return result.toString();
        } catch (Exception error) { throw new IllegalStateException(error); }
    }
    public static String csv(String value) {
        // Quote every field. Neutralise spreadsheet formulas in user-supplied text.
        String trimmed = value.replaceFirst("^\\s+", "");
        if (!trimmed.isEmpty() && "=+-@".indexOf(trimmed.charAt(0)) >= 0) value = "'" + value;
        return "\"" + value.replace("\"", "\"\"") + "\"";
    }
}
