package uz.rhythm.money;

import java.util.List;

public final class ParserTests {
    private static int checks;
    private static void check(boolean condition, String description) { checks++; if (!condition) throw new AssertionError(description); }
    private static void rejects(Runnable action, String description) { boolean rejected = false; try { action.run(); } catch (RuntimeException expected) { rejected = true; } check(rejected, description); }
    private static String sample(String operation, String merchant, String amount) {
        return operation + ": " + merchant + ", UZ,22.01.24 20:55,karta ***1234. summa:" + amount + " UZS balans:123456.78 UZS";
    }
    public static void main(String[] args) {
        check(Formats.amountMinor("1 250 000,50") == 125000050L, "Grouped sum parses exactly");
        check(Formats.amountMinor("20899.00") == 2089900L, "No floating point rounding");
        check(Formats.amount(500L).equals("5.00"), "Minor units format");
        rejects(() -> Formats.amountMinor("-500"), "Negative amount rejected");
        rejects(() -> Formats.amountMinor("1e6"), "Scientific notation rejected");
        rejects(() -> Formats.amountMinor("100.001"), "Third decimal rejected");
        rejects(() -> Formats.amountMinor("0"), "Zero amount rejected");
        rejects(() -> Formats.amountMinor("1000000000001"), "Oversized amount rejected");
        check(Formats.currency("uzs").equals("UZS"), "Currency normalized");
        rejects(() -> Formats.currency("UZSS"), "Invalid currency rejected");
        check(Formats.authenticationText("Ваш код 123456"), "Russian OTP excluded");
        check(Formats.authenticationText("Tasdiqlash kodi: 123456"), "Uzbek OTP excluded");
        check(Formats.authenticationText("Your code is 123456"), "English OTP excluded");
        check(!Formats.authenticationText(sample("Pokupka", "SHOP", "20000.00")), "Payment text allowed");
        check(Formats.date(1704135600000L).equals("2024-01-02"), "Dates use Tashkent rather than UTC");
        rejects(() -> Formats.validateDate("2024-02-30"), "Impossible date rejected");
        check(!Formats.fingerprint("ab", "c", "", "", "").equals(Formats.fingerprint("a", "bc", "", "", "")), "Fingerprint includes field boundaries");
        check(Formats.csv("a,\"b\"\nc").equals("\"a,\"\"b\"\"\nc\""), "CSV preserves quotes and line breaks");
        check(Formats.csv(" =1+1").startsWith("\"'"), "CSV formula text neutralised");
        BankParser.Transaction payment = BankParser.parse(sample("E-Com oplata", "UPAY YANDEX GO", "5000.00")).get(0);
        check(payment.amountMinor == 500000L, "Payment sum is not balance");
        check(payment.balanceMinor == 12345678L, "Balance remains a separate observation");
        check(payment.date.equals("2024-01-22") && payment.time.equals("20:55"), "Bank occurrence date is preserved");
        check(payment.kind.equals("expense") && payment.category.equals("Яндекс Go"), "Known service spending recorded");
        check(payment.cardSuffix.equals("1234"), "Masked card suffix preserved");
        check(BankParser.parse(sample("Popolnenie scheta", "BANK", "600000.00")).get(0).kind.equals("unknown"), "Funding is not automatically income");
        check(BankParser.parse(sample("Spisanie c karty", "UZUMBANK UZCARD2UZCARD P2P", "604200.00")).get(0).kind.equals("unknown"), "P2P is not automatically expense");
        check(BankParser.parse(sample("Platezh", "UZUMBANK UZCARD2HUMO P2P", "5035.00")).get(0).kind.equals("unknown"), "P2P under Platezh also needs review");
        check(BankParser.parse(sample("Vidacha nalichnykh v bankomate", "ATM", "1010000.00")).get(0).kind.equals("transfer"), "Cash withdrawal is money movement");
        check(BankParser.parse(sample("Popolnenie nalichnimi v ATM", "ATM", "3383000.00")).get(0).kind.equals("transfer"), "Cash deposit is money movement");
        check(BankParser.parse(sample("Platezh", "FRB KAPITAL 24 AKB KAPI", "4400000.00")).get(0).kind.equals("unknown"), "Payment to bank needs clarification");
        String shop = "Pokupka: TEST SHOP, TOSHKENT, ADDRESS 19.01.24 14:59 karta ***1234. summa:20000.00 UZS, balans:123456.78 UZS";
        check(BankParser.parse(shop).get(0).merchant.equals("TEST SHOP"), "Shop name separated from address");
        check(BankParser.parse(shop).get(0).category.equals("Без категории"), "Unknown shop not assigned an invented category");
        check(BankParser.parse("Code: 123456. " + sample("Pokupka", "SHOP", "5000.00")).isEmpty(), "OTP message is not parsed");
        check(BankParser.parse(sample("Pokupka", "SHOP", "5000.00") + " summa:9000.00 UZS").isEmpty(), "Ambiguous amount fields rejected");
        check(BankParser.parse(sample("Pokupka", "SHOP", "5000.00").replace("22.01.24", "31.02.24")).isEmpty(), "Invalid bank date rejected");
        check(BankParser.parse(sample("Pokupka", "SHOP", "5000.00").replace("***1234", "1234")).isEmpty(), "Unexpected card format needs review");
        String batch = sample("Pokupka", "SHOP", "5000.00") + " " + sample("E-Com oplata", "UPAY YANDEX GO", "10500.00") + " " + sample("Popolnenie scheta", "BANK", "600000.00");
        List<BankParser.Transaction> transactions = BankParser.parse(batch);
        check(transactions.size() == 3, "Concatenated SMS split into individual operations");
        check(transactions.get(1).amountMinor == 1050000L, "Each operation uses its own amount");
        check(transactions.get(0).raw.startsWith("Pokupka:") && transactions.get(1).raw.startsWith("E-Com oplata:"), "Raw segments preserved");
        String malformedBatch = sample("Pokupka", "SHOP", "5000.00") + " " + sample("Pokupka", "SHOP", "1.000") + " " + sample("Pokupka", "SHOP", "7000.00");
        check(BankParser.parse(malformedBatch).size() == 2 && BankParser.fragments(malformedBatch).size() == 3, "Malformed bank operation is retained for review");
        check(payment.signature.equals(BankParser.parse(sample("E-Com oplata", "UPAY YANDEX GO", "5000.00")).get(0).signature), "Candidate duplicates use stable bank fields");
        check(payment.signature.equals(BankParser.parse(sample("Platezh", "UPAY YANDEX GO", "5000.00").replace(" balans:123456.78 UZS", "")).get(0).signature), "Missing balance and differing payment label still produce a duplicate candidate");
        check(!payment.signature.equals(BankParser.parse(sample("E-Com oplata", "UPAY YANDEX GO", "5100.00")).get(0).signature), "Different amounts are separate candidates");
        System.out.println("Passed " + checks + " checks.");
    }
}
