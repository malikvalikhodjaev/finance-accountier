package uz.rhythm.money;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.Build;
import org.json.JSONObject;
import java.time.LocalDate;

public final class IncomeReminders {
    public static final String CHANNEL = "income-reminders";
    public static final String CYCLE_EXTRA = "income-cycle";
    public static final String ALARM = "uz.rhythm.money.INCOME_ALARM";
    private IncomeReminders() {}
    public static boolean enabled(Context context) { return CollectorConfig.prefs(context).getBoolean("incomeReminders", true); }
    public static int startHour(Context context) { return CollectorConfig.prefs(context).getInt("incomeStart", 9); }
    public static int endHour(Context context) { return CollectorConfig.prefs(context).getInt("incomeEnd", 20); }
    public static void initialize(Context context) {
        if (!CollectorConfig.prefs(context).contains("incomeAnchor"))
            CollectorConfig.prefs(context).edit().putString("incomeAnchor", Formats.date(System.currentTimeMillis())).putBoolean("incomeReminders", true).commit();
        schedule(context);
    }
    public static void configure(Context context, boolean active, int start, int end) {
        IncomeReminderRules.hours(start, end);
        boolean wasEnabled = enabled(context);
        android.content.SharedPreferences.Editor edit = CollectorConfig.prefs(context).edit().putBoolean("incomeReminders", active).putInt("incomeStart", start).putInt("incomeEnd", end);
        // Re-enabling does not create months of questions for the time the schedule was paused.
        if (active && !wasEnabled) edit.putString("incomeAnchor", Formats.date(System.currentTimeMillis()));
        edit.commit();
        if (!active) { cancelNotification(context); PromptOverlay.dismissIncome(); }
        schedule(context);
    }
    public static boolean exactAllowed(Context context) { return Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager.class).canScheduleExactAlarms(); }
    private static PendingIntent alarmIntent(Context context) {
        Intent intent = new Intent(context, IncomeAlarm.class).setAction(ALARM);
        return PendingIntent.getBroadcast(context, 5101, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static void prepare(Context context, EventStore store, long now) {
        if (!enabled(context)) return;
        String anchor = CollectorConfig.prefs(context).getString("incomeAnchor", Formats.date(now));
        for (String cycle : IncomeReminderRules.dueCycles(anchor, now, startHour(context))) {
            ContentValues row = new ContentValues(); row.put("cycle", cycle); row.put("status", "pending");
            row.put("due_at", IncomeReminderRules.atStart(LocalDate.parse(cycle), startHour(context)));
            store.getWritableDatabase().insertWithOnConflict("income_reminders", null, row, SQLiteDatabase.CONFLICT_IGNORE);
        }
    }
    public static synchronized void schedule(Context context) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        PendingIntent intent = alarmIntent(context);
        manager.cancel(intent);
        if (!enabled(context)) return;
        long now = System.currentTimeMillis(), next;
        try (EventStore store = new EventStore(context)) {
            prepare(context, store, now);
            String anchor = CollectorConfig.prefs(context).getString("incomeAnchor", Formats.date(now));
            next = IncomeReminderRules.nextNewCycle(anchor, now, startHour(context));
            try (Cursor cursor = store.getReadableDatabase().rawQuery("SELECT MIN(due_at) FROM income_reminders WHERE status='pending'", null)) {
                if (cursor.moveToFirst() && !cursor.isNull(0)) next = Math.min(next, IncomeReminderRules.inAllowedHours(Math.max(now, cursor.getLong(0)), startHour(context), endHour(context)));
            }
        }
        next = Math.max(now + 5000, next);
        try {
            if (exactAllowed(context)) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, intent);
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, intent);
            CollectorConfig.prefs(context).edit().putLong("incomeNextAlarm", next).remove("incomeAlarmError").apply();
        } catch (SecurityException error) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, intent);
            CollectorConfig.prefs(context).edit().putLong("incomeNextAlarm", next).putString("incomeAlarmError", "Android задерживает напоминания: разреши точные будильники.").apply();
        }
    }
    public static synchronized void fire(Context context) {
        if (!enabled(context)) return;
        long now = System.currentTimeMillis();
        if (IncomeReminderRules.inAllowedHours(now, startHour(context), endHour(context)) != now) { schedule(context); return; }
        String cycle = null;
        try (EventStore store = new EventStore(context)) {
            prepare(context, store, now);
            SQLiteDatabase db = store.getWritableDatabase(); db.beginTransaction();
            try {
                try (Cursor c = db.rawQuery("SELECT cycle FROM income_reminders WHERE status='pending' AND due_at<=? ORDER BY cycle LIMIT 1", new String[]{Long.toString(now)})) { if (c.moveToFirst()) cycle = c.getString(0); }
                if (cycle != null) {
                    ContentValues update = new ContentValues(); update.put("due_at", IncomeReminderRules.retry(now, startHour(context), endHour(context)));
                    db.update("income_reminders", update, "status='pending' AND due_at<=?", new String[]{Long.toString(now)});
                }
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        }
        if (cycle != null) {
            notify(context, cycle);
            PromptOverlay.offerIncome(context, cycle);
        }
        schedule(context);
    }
    public static boolean pending(Context context, String cycle) {
        try (EventStore store = new EventStore(context); Cursor c = store.getReadableDatabase().rawQuery("SELECT status FROM income_reminders WHERE cycle=?", new String[]{cycle})) { return c.moveToFirst() && "pending".equals(c.getString(0)); }
    }
    public static String summary(Context context) {
        String text = enabled(context) ? "5-е и 20-е · каждые 10 минут до ответа\n" + String.format(java.util.Locale.ROOT, "%02d:00–%02d:00", startHour(context), endHour(context)) + " · Ташкент" : "Напоминания приостановлены";
        try (EventStore store = new EventStore(context); Cursor c = store.getReadableDatabase().rawQuery("SELECT cycle,due_at FROM income_reminders WHERE status='pending' ORDER BY due_at LIMIT 1", null)) {
            if (c.moveToFirst()) text += "\nОжидает ответа за " + c.getString(0) + " · следующий вопрос " + displayTime(c.getLong(1));
        }
        return text;
    }
    public static String displayTime(long millis) { return java.time.Instant.ofEpochMilli(millis).atZone(Formats.ZONE).format(java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm")); }
    public static void snooze(Context context, String cycle, String date) {
        IncomeReminderRules.validateCycle(cycle);
        long until = IncomeReminderRules.snooze(date, System.currentTimeMillis(), startHour(context));
        try (EventStore store = new EventStore(context)) {
            ContentValues row = new ContentValues(); row.put("due_at", until);
            if (store.getWritableDatabase().update("income_reminders", row, "cycle=? AND status='pending'", new String[]{cycle}) != 1) throw new IllegalArgumentException("На это напоминание уже ответили.");
        }
        cancelNotification(context); schedule(context);
    }
    public static String save(Context context, String token, String cycle, String amount, String currency, String date, String source) {
        String id;
        try (EventStore store = new EventStore(context)) { id = store.quickIncome(token, cycle, amount, currency, date, source); }
        if (cycle != null) cancelNotification(context);
        SyncJobs.queue(context); schedule(context); return id;
    }
    private static void notify(Context context, String cycle) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Поступления 5-го и 20-го", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Вопрос о новом заработке: повтор каждые 10 минут до ответа или выбранной даты.");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE); manager.createNotificationChannel(channel);
        Intent open = new Intent(context, IncomeActivity.class).putExtra(CYCLE_EXTRA, cycle).setData(Uri.parse("rhythm-money://income/" + cycle));
        PendingIntent tap = PendingIntent.getActivity(context, 5102, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        try {
            manager.notify("income-reminder", 1, new Notification.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_edit).setContentTitle("Сколько поступило?")
                .setContentText("Напоминание за " + cycle + ". Укажи сумму или дату отсрочки.").setContentIntent(tap).setAutoCancel(false)
                .setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PRIVATE).build());
        } catch (SecurityException ignored) { }
    }
    public static void cancelNotification(Context context) { context.getSystemService(NotificationManager.class).cancel("income-reminder", 1); }
}
