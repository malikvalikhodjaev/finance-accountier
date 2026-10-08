package uz.rhythm.money;

public final class HistoryTests {
    private static int checks;
    private static void check(boolean condition,String name) { checks++; if (!condition) throw new AssertionError(name); }
    public static void main(String[] args) {
        check(HistoryRules.bankSender("UZCARD"),"Uzcard detected");
        check(HistoryRules.bankSender("HUMO"),"Humo detected");
        check(HistoryRules.bankSender("Uzcard SMS"),"Bank sender spelling detected");
        check(!HistoryRules.bankSender("Personal contact"),"Unselected personal sender excluded");
        String sms="Pokupka: TEST SHOP, UZ,22.01.24 20:55,karta ***1234. summa:5000.00 UZS balans:100000.00 UZS";
        check(HistoryRules.financial(sms),"Purchases retained");
        check(HistoryRules.financial(sms.replace("Pokupka","Spisanie c karty")),"Ambiguous movements retained for review");
        check(HistoryRules.financial("Списание: 50 000 сум. Баланс: 100 000 сум"),"Unrecognised financial format retained");
        check(!HistoryRules.financial("Your code is 123456. Amount: 5000 UZS"),"OTP excluded before storage");
        check(!HistoryRules.financial("Подтверждение оплаты: код 123456. 5000 UZS"),"Financial OTP excluded");
        check(!HistoryRules.financial("Скидки на покупки до 50 процентов"),"Bank advertising without a movement amount excluded");
        check(!HistoryRules.financial("Service activated"),"Service SMS excluded");
        check(!HistoryRules.financial(null),"Null SMS ignored");
        long sum=0; long before=System.nanoTime();
        for (int i=0;i<37000;i++) {
            BankParser.Transaction t=BankParser.parse(sms).get(0);
            sum+=t.amountMinor;
            if (!t.raw.equals(sms)) throw new AssertionError("Raw history changed");
        }
        check(sum==18500000000L,"37000 transactions parsed exactly, without changing raw text");
        check(!PurposeRules.notifyNow("history","recorded","expense","Pokupka","","2024-01-22",1705938900000L,System.currentTimeMillis()),"History never sends purpose prompts");
        System.out.println("Passed "+checks+" history checks; 37000 messages in "+((System.nanoTime()-before)/1000000)+" ms.");
    }
}
