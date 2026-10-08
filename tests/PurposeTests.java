package uz.rhythm.money;

import java.time.Instant;

public final class PurposeTests {
    private static int checks;
    private static void check(boolean condition, String text) { checks++; if (!condition) throw new AssertionError(text); }
    private static void rejects(Runnable action, String text) { boolean rejected = false; try { action.run(); } catch (RuntimeException expected) { rejected = true; } check(rejected, text); }
    public static void main(String[] args) {
        check(PurposeRules.validate("  такси домой  ").equals("такси домой"), "User's wording is preserved after trimming");
        rejects(() -> PurposeRules.validate("  "), "An empty answer is not saved");
        rejects(() -> PurposeRules.validate(null), "Missing remote input is rejected");
        StringBuilder longText = new StringBuilder(); for (int i = 0; i < 301; i++) longText.append('a');
        rejects(() -> PurposeRules.validate(longText.toString()), "Overlong answer is rejected");
        check(PurposeRules.category("обед с коллегой").equals("Еда"), "Free answer about lunch");
        check(PurposeRules.category("продукты на неделю").equals("Продукты"), "Groceries are separated from dining");
        check(PurposeRules.category("такси домой").equals("Транспорт"), "Taxi purpose inferred");
        check(PurposeRules.category("лекарства маме").equals("Здоровье"), "Medicine purpose inferred");
        check(PurposeRules.category("аренда квартиры").equals("Жильё"), "Housing purpose inferred");
        check(PurposeRules.category("кофейный аппарат").isEmpty(), "A partial word does not falsely imply coffee spending");
        check(PurposeRules.category("яндекс").isEmpty(), "Yandex alone does not imply taxi");
        check(PurposeRules.category("не такси").isEmpty(), "A negated purpose is not classified by its keyword");
        check(PurposeRules.category("продукты и лекарства").isEmpty(), "Mixed purposes are not arbitrarily put in one category");
        check(PurposeRules.category("свои деньги").equals("Свои деньги"), "Explicit own-money choice");
        check(PurposeRules.resolvedKind("unknown", "перевод себе").equals("transfer"), "Own money is not an expense");
        check(PurposeRules.resolvedKind("unknown", "аренда квартиры").equals("expense"), "Explicit expense purpose resolves outgoing payment");
        check(PurposeRules.resolvedKind("unknown", "маме").equals("unknown"), "Unclear purpose keeps ambiguous payment for review");
        check(PurposeRules.resolvedKind("transfer", "обед").equals("transfer"), "Existing confirmed transfer is not reinterpreted by a note");
        check(PurposeRules.needsAnswer("recorded", "expense", "Pokupka", ""), "Every fresh purchase is eligible even with a learned category");
        check(!PurposeRules.needsAnswer("recorded", "expense", "Pokupka", "обед"), "An answered payment is not prompted again");
        check(!PurposeRules.needsAnswer("duplicate", "expense", "Pokupka", ""), "Possible duplicates are not prompted");
        check(!PurposeRules.needsAnswer("ignored", "expense", "Pokupka", ""), "Ignored records are not prompted");
        check(!PurposeRules.needsAnswer("recorded", "transfer", "Vidacha nalichnykh v bankomate", ""), "Cash withdrawal is not a purchase prompt");
        check(!PurposeRules.needsAnswer("review", "unknown", "Popolnenie scheta", ""), "Funding is not a spending prompt");
        check(PurposeRules.needsAnswer("review", "unknown", "Spisanie c karty", ""), "Ambiguous outgoing payment can get a purpose question");
        long now = Instant.parse("2024-01-22T15:55:00Z").toEpochMilli();
        check(PurposeRules.notifyNow("sms", "recorded", "expense", "Pokupka", "", "2024-01-22", now, now), "Fresh SMS is prompted");
        check(PurposeRules.notifyNow("push", "recorded", "expense", "Pokupka", "", "2024-01-22", now, now), "Fresh push is prompted");
        check(!PurposeRules.notifyNow("shared", "recorded", "expense", "Pokupka", "", "2024-01-22", now, now), "Historical text import never posts questions");
        check(!PurposeRules.notifyNow("sms", "recorded", "expense", "Pokupka", "", "2024-01-22", now - 86400001, now), "Old active notification is not prompted");
        check(!PurposeRules.notifyNow("sms", "recorded", "expense", "Pokupka", "", "2023-01-22", now, now), "Old bank occurrence is not prompted");
        check(!PurposeRules.notifyNow("sms", "recorded", "expense", "Pokupka", "", "2024-01-23", now, now), "Future bank date is rejected");
        check(PurposeRules.notifyNow("sms", "recorded", "expense", "Pokupka", "", "2024-01-21", now, now), "A delayed payment near midnight is allowed");
        check(PurposeRules.exportDescription("SHOP", "обед").equals("обед · SHOP"), "Purpose accompanies merchant in existing CSV contract");
        check(PurposeRules.exportDescription("SHOP", "").equals("SHOP"), "Old exports keep their description");
        StringBuilder merchant = new StringBuilder(); for (int i = 0; i < 500; i++) merchant.append('b');
        check(PurposeRules.exportDescription(merchant.toString(), "обед").length() == 500, "Export obeys dashboard description limit");
        System.out.println("Passed " + checks + " purpose and prompt checks.");
    }
}
