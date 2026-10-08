package uz.rhythm.money;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

/** Local maintenance bridge: one base64 SMS fragment per line, no source text in output. */
public final class SmsReparseCli {
    private static String text(String value) {
        return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }
    public static void main(String[] args) throws Exception {
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = input.readLine()) != null) {
            String raw = new String(Base64.getDecoder().decode(line), StandardCharsets.UTF_8);
            List<BankParser.Transaction> parsed = BankParser.parse(raw);
            if (parsed.size() != 1 || !parsed.get(0).raw.equals(raw)) { System.out.println("0"); continue; }
            BankParser.Transaction t = parsed.get(0);
            System.out.println("1\t" + t.amountMinor + "\t" + (t.balanceMinor == null ? "" : t.balanceMinor) + "\t" + text(t.currency) + "\t" + text(t.date) + "\t" + text(t.time) + "\t" + text(t.merchant) + "\t" + text(t.cardSuffix) + "\t" + text(t.signature) + "\t" + text(t.operation));
        }
    }
}
