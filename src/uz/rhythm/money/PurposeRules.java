package uz.rhythm.money;

import java.time.LocalDate;
import java.util.Locale;
import java.util.regex.Pattern;

/** Conservative rules for the owner's explicit answer, independent of merchant guessing. */
public final class PurposeRules {
    public static final String[] CHOICES = {"Еда", "Продукты", "Транспорт", "Здоровье", "Жильё", "Связь", "Обучение", "Рабочие траты", "Подарки", "Свои деньги"};
    private PurposeRules() {}
    public static String validate(String answer) {
        if (answer == null || answer.trim().isEmpty()) throw new IllegalArgumentException("Напиши, на что потратил, или выбери категорию.");
        String purpose = answer.trim();
        if (purpose.length() > 300) throw new IllegalArgumentException("Назначение: до 300 символов.");
        return purpose;
    }
    private static boolean matches(String text, String words) {
        return Pattern.compile("(?iu)(?<![\\p{L}\\p{N}])(?:" + words + ")(?![\\p{L}\\p{N}])").matcher(text).find();
    }
    public static String category(String answer) {
        String text = validate(answer).toLowerCase(Locale.ROOT);
        if (matches(text, "не|нет|not")) return "";
        if (matches(text, "свои деньги|свои счета|перевод себе|между своими счетами|на свою карту")) return "Свои деньги";
        java.util.Set<String> categories = new java.util.LinkedHashSet<>();
        if (matches(text, "продукты|продуктов|продуктами|groceries")) categories.add("Продукты");
        if (matches(text, "еда|еды|еду|обед|обеда|завтрак|ужин|кофе|перекус|кафе|ресторан|доставка еды|food")) categories.add("Еда");
        if (matches(text, "транспорт|такси|taxi|проезд|бензин|метро|автобус")) categories.add("Транспорт");
        if (matches(text, "здоровье|аптека|лекарства|лекарств|врач|анализы|стоматолог")) categories.add("Здоровье");
        if (matches(text, "жильё|жилье|аренда|аренду|коммуналка|коммунальные|электричество|квартплата")) categories.add("Жильё");
        if (matches(text, "связь|интернет|мобильная связь|тариф")) categories.add("Связь");
        if (matches(text, "обучение|учёба|учеба|курс|курсы|книги|репетитор")) categories.add("Обучение");
        if (matches(text, "рабочие траты|для работы|рабочая покупка")) categories.add("Рабочие траты");
        if (matches(text, "подарки|подарок|подарка|подарки маме")) categories.add("Подарки");
        return categories.size() == 1 ? categories.iterator().next() : "";
    }
    public static boolean needsAnswer(String state, String kind, String operation, String purpose) {
        if (purpose != null && !purpose.trim().isEmpty()) return false;
        if ("duplicate".equals(state) || "ignored".equals(state)) return false;
        if ("recorded".equals(state) && "expense".equals(kind)) return true;
        String op = operation == null ? "" : operation.trim().toLowerCase(Locale.ROOT).replace('\u2018', '\'').replace('\u2019', '\'');
        boolean outgoing = op.equals("platezh") || op.equals("platej") || op.startsWith("spisanie ")
            || op.equals("humo oplata") || op.equals("debit online") || op.equals("kartadan chiqim")
            || op.equals("online to'lov") || op.equals("to'lov") || op.equals("pokupka") || op.equals("e-com oplata");
        return "review".equals(state) && "unknown".equals(kind) && outgoing;
    }
    public static String resolvedKind(String currentKind, String answer) {
        String category = category(answer);
        if (category.equals("Свои деньги")) return "transfer";
        if (currentKind.equals("unknown") && !category.isEmpty()) return "expense";
        return currentKind;
    }
    public static boolean notifyNow(String source, String state, String kind, String operation, String purpose, String bankDate, long eventMillis, long nowMillis) {
        if (!(source.equals("sms") || source.equals("push")) || !needsAnswer(state, kind, operation, purpose)) return false;
        long age = nowMillis - eventMillis;
        if (age < -120000 || age > 86400000) return false;
        try {
            LocalDate today = java.time.Instant.ofEpochMilli(nowMillis).atZone(Formats.ZONE).toLocalDate();
            LocalDate date = LocalDate.parse(bankDate);
            return !date.isBefore(today.minusDays(1)) && !date.isAfter(today);
        } catch (RuntimeException error) { return false; }
    }
    public static String exportDescription(String description, String purpose) {
        if (purpose == null || purpose.trim().isEmpty()) return description;
        String text = purpose.trim() + (description.isEmpty() ? "" : " · " + description);
        return text.substring(0, Math.min(500, text.length()));
    }
}
