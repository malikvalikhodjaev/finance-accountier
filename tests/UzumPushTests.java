package uz.rhythm.money;

import java.time.Instant;

public final class UzumPushTests {
    private static int checks;
    private static void check(boolean condition, String text) { checks++; if (!condition) throw new AssertionError(text); }
    private static final String BODY = "15 000 UZS, карта *8084, P2P VISAUZUM TO HUMO. Доступно 129 782,07 UZS";
    private static final long POSTED = Instant.parse("2026-10-09T14:47:35Z").toEpochMilli();
    private static BankParser.Transaction parse(String title, String body) { return UzumPushParser.parse(UzumPushParser.PACKAGE, title, body, POSTED); }
    public static void main(String[] args) {
        BankParser.Transaction transfer = parse("Перевод отправлен", BODY);
        check(transfer != null, "Completed Uzum transfer without SMS date is recognised");
        check(transfer.amountMinor == 1500000L && transfer.balanceMinor == 12978207L, "Transfer amount is independent of available balance");
        check(transfer.currency.equals("UZS") && transfer.cardSuffix.equals("8084"), "Currency and masked source card are exact");
        check(transfer.date.equals("2026-10-09") && transfer.time.equals("19:47"), "Original notification timestamp supplies Tashkent date and minute");
        check(transfer.raw.equals(BODY) && transfer.merchant.equals("P2P VISAUZUM TO HUMO"), "Original notification and payment route are preserved");
        check(transfer.kind.equals("unknown") && transfer.category.isEmpty(), "A P2P transfer is not assumed to be an expense or own money");
        check(PurposeRules.notifyNow("push", "review", transfer.kind, transfer.operation, "", transfer.date, POSTED, POSTED), "Fresh completed push can ask for purpose");
        check(!PurposeRules.notifyNow("push", "review", transfer.kind, transfer.operation, "", transfer.date, POSTED, POSTED + 86400001L), "Old active notifications do not cause a prompt storm");
        check(PurposeRules.resolvedKind(transfer.kind, "Свои деньги").equals("transfer"), "Own-money answer excludes it from expenses");
        check(PurposeRules.resolvedKind(transfer.kind, "Обед").equals("expense"), "Explicit expense answer resolves the payment");
        check(PurposeRules.resolvedKind(transfer.kind, "Другу").equals("unknown"), "Unclear answer does not invent a category");
        check(parse("Перевод отправлен", BODY.replace("15 000", "15\u202f000").replace("129 782", "129\u00a0782")) != null, "Non-breaking thousands separators are supported");
        check(parse("Перевод отправлен", BODY.replace("129 782,07", "0")).balanceMinor == 0L, "Zero available balance is valid");
        check(parse("Перевод отправлен", BODY.replace("15 000", "15 000,125")) == null, "Excess decimal precision is rejected");
        check(parse("Перевод отправлен", BODY.replace("15 000", "0")) == null, "Zero transaction amount is rejected");
        check(parse("Перевод отправлен", BODY.replace("129 782,07", "129 782,071")) == null, "Malformed balance is rejected");
        check(parse("Перевод отправлен", BODY.replace("*8084", "8084")) == null, "Unmasked card format is not guessed");
        check(parse("Перевод отправлен", BODY.replace("129 782,07 UZS", "129 782,07 USD")) == null, "Mixed currencies require review");
        check(parse("Перевод отправлен", BODY + " 25 000 UZS") == null, "A second amount cannot be silently ignored");
        check(parse("Перевод отправлен", "Код подтверждения: 123456. " + BODY) == null, "OTP content is never parsed");
        check(parse("Переводы без комиссии", BODY) == null, "Promotional title does not become a transaction");
        check(parse("Перевод не выполнен", BODY) == null, "Failure does not become a completed transaction");
        check(parse("Перевод получен", BODY) == null, "Incoming transfer is not a spending prompt");
        check(UzumPushParser.parse("uz.uzum.app", "Перевод отправлен", BODY, POSTED) == null, "Uzum Market is distinct from the bank app");
        check(UzumPushParser.parse(UzumPushParser.PACKAGE, "Перевод отправлен", BODY, 0) == null, "Missing notification timestamp is rejected");
        check(transfer.signature.equals(parse("Перевод отправлен", BODY).signature), "The same posted notification has a stable signature");
        check(!transfer.signature.equals(UzumPushParser.parse(UzumPushParser.PACKAGE, "Перевод отправлен", BODY, POSTED + 1000).signature), "Two equal transfers within one minute remain distinct");
        System.out.println("Passed " + checks + " Uzum push checks.");
    }
}
