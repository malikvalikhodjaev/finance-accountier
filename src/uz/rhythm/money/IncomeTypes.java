package uz.rhythm.money;

/** The selected source uses the existing income source column and sync protocol. */
public final class IncomeTypes {
    public static final String[] CHOICES = { "Выбери тип поступления", "Зарплата", "Проекты и клиенты", "Бизнес", "Подработка", "Другое" };
    public static final int OTHER = CHOICES.length - 1;
    private IncomeTypes() {}
    public static String source(int selection, String other) {
        if (selection <= 0 || selection >= CHOICES.length) throw new IllegalArgumentException("Выбери тип поступления.");
        if (selection != OTHER) return CHOICES[selection];
        String value = other == null ? "" : other.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("Для «Другое» напиши источник поступления.");
        if (value.length() > 120) throw new IllegalArgumentException("Источник: до 120 символов.");
        return value;
    }
    public static int selection(String source) {
        if (source == null || source.trim().isEmpty()) return 0;
        for (int i = 1; i < OTHER; i++) if (CHOICES[i].equals(source)) return i;
        return OTHER;
    }
}
