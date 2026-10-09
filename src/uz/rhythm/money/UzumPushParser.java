package uz.rhythm.money;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Completed Uzum transfers; the occurrence time is the notification's original post time. */
public final class UzumPushParser {
    public static final String PACKAGE = "uz.kapitalbank.android";
    private static final String NUMBER = "([0-9]+(?:[ \\u00a0\\u202f][0-9]{3})*(?:[.,][0-9]{1,2})?)";
    private static final Pattern BODY = Pattern.compile("(?iu)^\\s*" + NUMBER + "\\s+([A-Z]{3}),\\s*карта\\s*\\*+(\\d{4}),\\s*(.+?)\\.\\s*Доступно\\s+" + NUMBER + "\\s+([A-Z]{3})\\s*$", Pattern.DOTALL);
    private UzumPushParser() {}
    public static BankParser.Transaction parse(String source, String title, String text, long postedAt) {
        if (!PACKAGE.equals(source) || title == null || text == null || postedAt <= 0) return null;
        if (!title.trim().equalsIgnoreCase("Перевод отправлен") || Formats.authenticationText(title + "\n" + text)) return null;
        Matcher match = BODY.matcher(text);
        if (!match.matches()) return null;
        try {
            BankParser.Transaction transaction = new BankParser.Transaction();
            transaction.raw = text; transaction.operation = "Перевод отправлен";
            transaction.amountMinor = Formats.amountMinor(match.group(1)); transaction.currency = Formats.currency(match.group(2));
            transaction.cardSuffix = match.group(3); transaction.merchant = match.group(4).trim();
            if (transaction.merchant.isEmpty() || transaction.merchant.indexOf('\n') >= 0 || transaction.merchant.indexOf('\r') >= 0 || !match.group(6).equalsIgnoreCase(transaction.currency)) return null;
            String balance = match.group(5).replace(" ", "").replace("\u00a0", "").replace("\u202f", "").replace(',', '.');
            transaction.balanceMinor = new BigDecimal(balance).movePointRight(2).longValueExact();
            ZonedDateTime received = Instant.ofEpochMilli(postedAt).atZone(Formats.ZONE);
            transaction.date = Formats.validateDate(received.toLocalDate().toString());
            transaction.time = received.toLocalTime().withSecond(0).withNano(0).toString();
            transaction.kind = "unknown"; transaction.category = "";
            transaction.reviewReason = "Перевод: на что или свои деньги? Дата и время взяты из уведомления Uzum.";
            transaction.signature = Formats.fingerprint("uzum-push-v1", transaction.cardSuffix, Long.toString(postedAt), transaction.merchant.toLowerCase(Locale.ROOT), transaction.amountMinor + "|" + transaction.currency);
            return transaction;
        } catch (RuntimeException error) { return null; }
    }
}
