package uz.rhythm.money;

/** Expanded and collapsed notification fields are alternative copies of one payload. */
public final class NotificationText {
    private NotificationText() {}
    public static boolean authentication(String title, String big, String normal, String[] lines) {
        StringBuilder text = new StringBuilder(String.valueOf(title)).append('\n').append(big).append('\n').append(normal);
        if (lines != null) for (String line : lines) text.append('\n').append(line);
        return Formats.authenticationText(text.toString());
    }
    public static String body(String big, String normal, String[] lines) {
        if (big != null && !big.trim().isEmpty()) return big;
        if (normal != null && !normal.trim().isEmpty()) return normal;
        java.util.LinkedHashSet<String> unique = new java.util.LinkedHashSet<>();
        if (lines != null) for (String line : lines) if (line != null && !line.trim().isEmpty()) unique.add(line);
        return String.join("\n", unique);
    }
}
