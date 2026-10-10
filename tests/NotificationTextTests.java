package uz.rhythm.money;

public final class NotificationTextTests {
    public static void main(String[] args) {
        String body = "15 000 UZS, карта *8084, P2P VISAUZUM TO HUMO. Доступно 129 782,07 UZS";
        String result = NotificationText.body(body, body, new String[]{body, body});
        if (!result.equals(body)) throw new AssertionError("Alternative text fields must not duplicate the payment");
        long posted = java.time.Instant.parse("2026-10-09T14:47:00Z").toEpochMilli();
        if (UzumPushParser.parse(UzumPushParser.PACKAGE, "Перевод отправлен", result, posted) == null) throw new AssertionError("Duplicated Android extras must still parse");
        if (!NotificationText.body(null, body, null).equals(body)) throw new AssertionError("Normal text fallback");
        if (!NotificationText.body("  ", "", new String[]{body, body, null, ""}).equals(body)) throw new AssertionError("Line fallback preserves raw text without repeated copies");
        if (!NotificationText.body(null, null, null).isEmpty()) throw new AssertionError("Empty extras remain empty");
        if (!NotificationText.body("Код подтверждения: 123456", body, null).startsWith("Код")) throw new AssertionError("Do not discard authentication fields in favour of a payment");
        if (!NotificationText.authentication("Перевод отправлен", body, "Код подтверждения: 123456", null)) throw new AssertionError("Authentication in an alternative field must be excluded");
        if (!NotificationText.authentication("", body, "", new String[]{"OTP 123456"})) throw new AssertionError("Authentication in lines must be excluded");
        System.out.println("Passed 8 notification text checks.");
    }
}
