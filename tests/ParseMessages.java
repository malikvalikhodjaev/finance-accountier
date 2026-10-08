package uz.rhythm.money;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;

public final class ParseMessages {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Usage: ParseMessages input.txt output.csv");
        String raw = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
        List<BankParser.Transaction> rows = BankParser.parse(raw);
        int expenses = 0, movements = 0, review = 0, yandex = 0;
        long expenseSum = 0, movementSum = 0, yandexSum = 0;
        StringBuilder csv = new StringBuilder("externalId,date,amount,currency,type,category,description\r\n");
        for (BankParser.Transaction row : rows) {
            if (row.kind.equals("expense")) { expenses++; expenseSum += row.amountMinor; }
            if (row.kind.equals("transfer")) { movements++; movementSum += row.amountMinor; }
            if (row.kind.equals("unknown")) { review++; continue; }
            if (row.category.equals("Яндекс Go")) { yandex++; yandexSum += row.amountMinor; }
            String[] values = {row.signature, row.date, Formats.amount(row.amountMinor), row.currency, row.kind, row.category, row.merchant};
            for (int i = 0; i < values.length; i++) { if (i > 0) csv.append(','); csv.append(Formats.csv(values[i])); }
            csv.append("\r\n");
        }
        Files.write(Paths.get(args[1]), csv.toString().getBytes(StandardCharsets.UTF_8));
        System.out.println("Parsed=" + rows.size() + "; ExpenseCount=" + expenses + "; ExpenseUZS=" + Formats.amount(expenseSum) + "; MovementCount=" + movements + "; MovementUZS=" + Formats.amount(movementSum) + "; NeedsReview=" + review + "; YandexCount=" + yandex + "; YandexUZS=" + Formats.amount(yandexSum));
    }
}
