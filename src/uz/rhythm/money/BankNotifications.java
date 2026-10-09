package uz.rhythm.money;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;

public final class BankNotifications extends NotificationListenerService {
    public static void refresh(android.content.Context context) {
        requestRebind(new android.content.ComponentName(context, BankNotifications.class));
    }
    private android.content.BroadcastReceiver unlock;
    @Override public void onCreate() {
        super.onCreate();
        unlock = new android.content.BroadcastReceiver() {
            @Override public void onReceive(android.content.Context context, android.content.Intent intent) { PromptOverlay.resume(context); }
        };
        android.content.IntentFilter filter = new android.content.IntentFilter(android.content.Intent.ACTION_USER_PRESENT);
        if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(unlock, filter, android.content.Context.RECEIVER_NOT_EXPORTED); else registerReceiver(unlock, filter);
    }
    @Override public void onDestroy() { if (unlock != null) unregisterReceiver(unlock); super.onDestroy(); }
    @Override public void onListenerConnected() {
        IncomeReminders.initialize(this);
        CollectorConfig.prefs(this).edit().putString("connectedAt", Instant.now().toString()).apply();
        StatusBarNotification[] active = getActiveNotifications();
        if (active != null) for (StatusBarNotification event : active) onNotificationPosted(event);
    }
    @Override public void onNotificationPosted(StatusBarNotification event) {
        if (event == null || !CollectorConfig.acceptsApp(this, event.getPackageName())) return;
        Notification notification = event.getNotification();
        if (notification == null || (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        Bundle extras = notification.extras;
        if (extras == null) return;
        String title = text(extras.getCharSequence(Notification.EXTRA_TITLE));
        Set<String> parts = new LinkedHashSet<>();
        String big = text(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        String normal = text(extras.getCharSequence(Notification.EXTRA_TEXT));
        if (!big.isEmpty()) parts.add(big); else if (!normal.isEmpty()) parts.add(normal);
        CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (lines != null) for (CharSequence line : lines) if (line != null && line.length() > 0) parts.add(line.toString());
        String body = String.join("\n", parts);
        if (title.isEmpty() && body.isEmpty()) return;
        String name = event.getPackageName();
        try { name = getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(name, 0)).toString(); }
        catch (Exception ignored) { /* The package name remains an exact source identifier. */ }
        try (EventStore store = new EventStore(this)) {
            int added = store.capture("push", name, event.getPackageName(), event.getKey(), event.getPostTime(), title, body);
            if (event.getPackageName().equals(UzumPushParser.PACKAGE) && !Formats.authenticationText(title + "\n" + body)) {
                boolean recognised = UzumPushParser.parse(event.getPackageName(), title, body, event.getPostTime()) != null || !BankParser.parse(body).isEmpty();
                CollectorConfig.prefs(this).edit().putLong("uzumLastPushAt", event.getPostTime())
                    .putString("uzumLastPushStatus", recognised ? added > 0 ? "Операция распознана; назначение можно уточнить" : "Это уведомление уже сохранено" : "Уведомление получено; формат требует проверки").apply();
            }
        } catch (RuntimeException error) {
            CollectorConfig.prefs(this).edit().putString("lastError", "Не удалось сохранить уведомление. Проверь свободное место.").apply();
        }
    }
    private static String text(CharSequence value) { return value == null ? "" : value.toString(); }
}
