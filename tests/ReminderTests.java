package uz.rhythm.money;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;

public final class ReminderTests {
    private static int checks;
    private static void check(boolean condition, String label) { checks++; if (!condition) throw new AssertionError(label); }
    private static void rejects(Runnable action, String label) { boolean rejected = false; try { action.run(); } catch (RuntimeException expected) { rejected = true; } check(rejected, label); }
    private static long time(String date, int hour, int minute) { return LocalDate.parse(date).atTime(hour, minute).atZone(Formats.ZONE).toInstant().toEpochMilli(); }
    public static void main(String[] args) {
        check(IncomeReminderRules.firstCycle(LocalDate.parse("2026-10-09")).toString().equals("2026-10-20"), "Activation on the 9th does not ask for older paydays");
        check(IncomeReminderRules.firstCycle(LocalDate.parse("2026-10-05")).getDayOfMonth() == 5, "Activation on payday includes that payday");
        check(IncomeReminderRules.nextCycle(LocalDate.parse("2026-12-20")).toString().equals("2027-01-05"), "December rolls over into next year");
        check(IncomeReminderRules.nextCycle(LocalDate.parse("2024-02-20")).toString().equals("2024-03-05"), "Leap month needs no artificial payday");
        check(IncomeReminderRules.dueCycles("2026-10-09", time("2026-10-20", 8, 59), 9).isEmpty(), "Not due before 09:00");
        check(IncomeReminderRules.dueCycles("2026-10-09", time("2026-11-05", 9, 0), 9).equals(Arrays.asList("2026-10-20", "2026-11-05")), "A restart catches up missed cycles once");
        check(IncomeReminderRules.nextNewCycle("2026-10-09", time("2026-10-20", 9, 0), 9) == time("2026-11-05", 9, 0), "After today's cycle, next new cycle is the 5th");
        long payment = time("2026-10-20", 12, 7);
        check(IncomeReminderRules.retry(payment, 9, 20) == time("2026-10-20", 12, 17), "Repeat exactly ten minutes after the attempt");
        check(IncomeReminderRules.retry(time("2026-10-20", 19, 55), 9, 20) == time("2026-10-21", 9, 0), "No overnight repeats");
        check(IncomeReminderRules.inAllowedHours(time("2026-10-20", 20, 0), 9, 20) == time("2026-10-21", 9, 0), "20:00 is the exclusive end of the chosen window");
        check(IncomeReminderRules.retry(time("2026-10-20", 23, 55), 0, 24) == time("2026-10-21", 0, 5), "All-day range can cross midnight");
        check(IncomeReminderRules.snooze("2026-11-10", payment, 9) == time("2026-11-10", 9, 0), "Snooze restores on the chosen date, in Tashkent");
        rejects(() -> IncomeReminderRules.snooze("2026-10-20", payment, 9), "Past snooze time rejected");
        rejects(() -> IncomeReminderRules.snooze("2026-02-30", payment, 9), "Invalid calendar date rejected");
        rejects(() -> IncomeReminderRules.hours(20, 9), "Reversed hours rejected");
        rejects(() -> IncomeReminderRules.validateCycle("2026-10-06"), "Arbitrary dates cannot manufacture reminder cycles");
        check(IncomeReminderRules.amount("1 250 000,50", false) == 125000050, "Exact decimal sum, without floating point");
        check(IncomeReminderRules.amount("0", true) == 0 && IncomeReminderRules.amount("0,00", true) == 0, "Zero is an explicit reminder answer");
        rejects(() -> IncomeReminderRules.amount("", true), "Blank is not zero");
        rejects(() -> IncomeReminderRules.amount("0", false), "Manual income must be positive");
        rejects(() -> IncomeReminderRules.amount("-1", true), "Negative income rejected");
        rejects(() -> IncomeReminderRules.amount("1.001", false), "More than two decimal places rejected");
        rejects(() -> IncomeReminderRules.amount("1000000000001", false), "Ledger amount limit preserved");
        check(Instant.ofEpochMilli(time("2026-10-20", 9, 0)).toString().equals("2026-10-20T04:00:00Z"), "Schedule fixed to Tashkent regardless of device timezone");
        System.out.println("Passed " + checks + " income reminder checks.");
    }
}
