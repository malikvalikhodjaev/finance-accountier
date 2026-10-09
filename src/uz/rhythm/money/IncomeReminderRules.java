package uz.rhythm.money;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;

/** Calendar rules independent of Android, with every date interpreted in Tashkent. */
public final class IncomeReminderRules {
    public static final long REPEAT_MILLIS = 10 * 60 * 1000L;
    private IncomeReminderRules() {}
    public static void hours(int start, int end) {
        if (start < 0 || start > 23 || end < 1 || end > 24 || start >= end)
            throw new IllegalArgumentException("Начало должно быть раньше конца, часы от 0 до 24.");
    }
    public static LocalDate firstCycle(LocalDate day) {
        if (day.getDayOfMonth() <= 5) return day.withDayOfMonth(5);
        if (day.getDayOfMonth() <= 20) return day.withDayOfMonth(20);
        return day.plusMonths(1).withDayOfMonth(5);
    }
    public static LocalDate nextCycle(LocalDate cycle) {
        validateCycle(cycle.toString());
        return cycle.getDayOfMonth() == 5 ? cycle.withDayOfMonth(20) : cycle.plusMonths(1).withDayOfMonth(5);
    }
    public static String validateCycle(String input) {
        LocalDate date;
        try { date = LocalDate.parse(input); }
        catch (RuntimeException error) { throw new IllegalArgumentException("Некорректная дата напоминания."); }
        if (!(date.getDayOfMonth() == 5 || date.getDayOfMonth() == 20))
            throw new IllegalArgumentException("Напоминания назначаются на 5-е и 20-е число.");
        return date.toString();
    }
    public static long atStart(LocalDate date, int start) { return date.atTime(start, 0).atZone(Formats.ZONE).toInstant().toEpochMilli(); }
    public static long inAllowedHours(long time, int start, int end) {
        hours(start, end);
        ZonedDateTime local = Instant.ofEpochMilli(time).atZone(Formats.ZONE);
        if (local.getHour() < start) return atStart(local.toLocalDate(), start);
        if (local.getHour() >= end) return atStart(local.toLocalDate().plusDays(1), start);
        return time;
    }
    public static long retry(long now, int start, int end) { return inAllowedHours(Math.addExact(now, REPEAT_MILLIS), start, end); }
    public static long snooze(String date, long now, int start) {
        LocalDate selected;
        try { selected = LocalDate.parse(date); }
        catch (RuntimeException error) { throw new IllegalArgumentException("Выбери дату отсрочки."); }
        long until = atStart(selected, start);
        if (until <= now) throw new IllegalArgumentException("Выбери будущую дату. Напоминание вернётся в начале выбранного дня.");
        return until;
    }
    public static List<String> dueCycles(String anchor, long now, int start) {
        List<String> result = new ArrayList<>();
        LocalDate cycle = firstCycle(LocalDate.parse(anchor));
        while (atStart(cycle, start) <= now) { result.add(cycle.toString()); cycle = nextCycle(cycle); }
        return result;
    }
    public static long nextNewCycle(String anchor, long now, int start) {
        LocalDate today = Instant.ofEpochMilli(now).atZone(Formats.ZONE).toLocalDate();
        LocalDate first = LocalDate.parse(anchor);
        LocalDate cycle = firstCycle(today.isBefore(first) ? first : today);
        if (atStart(cycle, start) <= now) cycle = nextCycle(cycle);
        return atStart(cycle, start);
    }
    public static long amount(String text, boolean allowZero) {
        String clean = text == null ? "" : text.trim().replace(" ", "").replace("\u00a0", "").replace("\u202f", "");
        if (allowZero && clean.matches("0+(?:[.,]0{1,2})?")) return 0;
        return Formats.amountMinor(clean);
    }
}
