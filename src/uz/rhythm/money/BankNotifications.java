package uz.rhythm.money;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.time.Instant;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;

public final class BankNotifications extends NotificationListenerService {
    private static volatile BankNotifications live;
    private static final String PROBE = "collector-probe";
    private static final int PROBE_ID = 701;
    public static boolean access(Context context) {
        if (android.os.Build.VERSION.SDK_INT < 27) {
            String enabled = android.provider.Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
            return enabled != null && java.util.Arrays.asList(enabled.split(":")).contains(new android.content.ComponentName(context, BankNotifications.class).flattenToString());
        }
        return context.getSystemService(NotificationManager.class).isNotificationListenerAccessGranted(new android.content.ComponentName(context, BankNotifications.class));
    }
    public static String status(Context context) {
        if (!access(context)) return "Доступ к уведомлениям не выдан";
        return live != null ? "Сборщик подключён к Android" : "Сборщик не подключён к Android — требуется восстановление";
    }
    public static void ensureConnected(Context context) {
        if (live != null || !access(context)) return;
        long now = System.currentTimeMillis(), last = CollectorConfig.prefs(context).getLong("listenerRebindAt", 0);
        if (now >= last && now - last < 60000) return;
        refresh(context);
    }
    public static void refresh(Context context) {
        if (!access(context)) return;
        BankNotifications current = live;
        if (current != null) { new android.os.Handler(android.os.Looper.getMainLooper()).post(current::scanActive); return; }
        CollectorConfig.prefs(context).edit().putLong("listenerRebindAt", System.currentTimeMillis()).apply();
        try { requestRebind(new android.content.ComponentName(context, BankNotifications.class)); }
        catch (RuntimeException error) { CollectorConfig.prefs(context).edit().putString("listenerError", "Android не подключил сборщик. Выключи и снова включи доступ к уведомлениям в настройках.").apply(); }
    }
    public static void probe(Context context) {
        if (android.os.Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            throw new IllegalStateException("Разреши уведомления приложения, чтобы выполнить проверку.");
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (!manager.areNotificationsEnabled()) throw new IllegalStateException("Уведомления приложения выключены в настройках Android.");
        manager.createNotificationChannel(new NotificationChannel(PROBE, "Проверка сборщика", NotificationManager.IMPORTANCE_LOW));
        if (manager.getNotificationChannel(PROBE).getImportance() == NotificationManager.IMPORTANCE_NONE) throw new IllegalStateException("Разреши канал «Проверка сборщика» в настройках уведомлений.");
        String nonce = java.util.UUID.randomUUID().toString();
        CollectorConfig.prefs(context).edit().putString("listenerProbeNonce", nonce).putLong("listenerProbeSentAt", System.currentTimeMillis()).putLong("listenerProbeReceivedAt", 0).commit();
        refresh(context);
        Notification notification = new Notification.Builder(context, PROBE).setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Проверка доставки уведомлений").setContentText("Проверка сборщика. Финансовая операция не создаётся.").setTimeoutAfter(30000).build();
        notification.extras.putString("collectorProbeNonce", nonce);
        manager.notify(PROBE, PROBE_ID, notification);
    }
    private android.content.BroadcastReceiver unlock;
    @Override public void onCreate() {
        super.onCreate();
        unlock = new android.content.BroadcastReceiver() {
            @Override public void onReceive(android.content.Context context, android.content.Intent intent) { ensureConnected(context); PromptOverlay.resume(context); }
        };
        android.content.IntentFilter filter = new android.content.IntentFilter(android.content.Intent.ACTION_USER_PRESENT);
        if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(unlock, filter, android.content.Context.RECEIVER_NOT_EXPORTED); else registerReceiver(unlock, filter);
    }
    @Override public void onDestroy() { if (live == this) live = null; if (unlock != null) unregisterReceiver(unlock); super.onDestroy(); }
    @Override public void onListenerDisconnected() {
        live = null;
        CollectorConfig.prefs(this).edit().putString("listenerDisconnectedAt", Instant.now().toString()).apply();
        refresh(this);
    }
    @Override public void onListenerConnected() {
        live = this;
        IncomeReminders.initialize(this);
        CollectorConfig.prefs(this).edit().putString("connectedAt", Instant.now().toString()).remove("listenerError").apply();
        scanActive();
    }
    private void scanActive() {
        if (live != this) return;
        try { StatusBarNotification[] active = getActiveNotifications(); if (active != null) for (StatusBarNotification event : active) onNotificationPosted(event); }
        catch (RuntimeException error) { CollectorConfig.prefs(this).edit().putString("listenerError", "Не удалось прочитать текущие уведомления. Повтори проверку сборщика.").apply(); }
    }
    @Override public void onNotificationPosted(StatusBarNotification event) {
        if (event == null) return;
        Notification notification = event.getNotification();
        if (notification == null) return;
        Bundle extras = notification.extras;
        if (event.getPackageName().equals(getPackageName()) && PROBE.equals(event.getTag())) {
            String nonce = extras == null ? "" : extras.getString("collectorProbeNonce", "");
            if (!nonce.isEmpty() && nonce.equals(CollectorConfig.prefs(this).getString("listenerProbeNonce", ""))) {
                CollectorConfig.prefs(this).edit().putLong("listenerProbeReceivedAt", System.currentTimeMillis()).apply();
                getSystemService(NotificationManager.class).cancel(PROBE, PROBE_ID);
            }
            return;
        }
        boolean uzum = event.getPackageName().equals(UzumPushParser.PACKAGE);
        if (!CollectorConfig.acceptsApp(this, event.getPackageName())) {
            if (uzum) outcome(event, "Уведомление дошло до сборщика, но сбор на паузе или Uzum не выбран");
            return;
        }
        if (extras == null) { if (uzum) outcome(event, "Android передал уведомление без текста"); return; }
        String title = text(extras.getCharSequence(Notification.EXTRA_TITLE));
        if (title.isEmpty()) title = text(extras.getCharSequence(Notification.EXTRA_TITLE_BIG));
        CharSequence[] sourceLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        String[] lines = sourceLines == null ? null : new String[sourceLines.length];
        if (lines != null) for (int i = 0; i < lines.length; i++) lines[i] = text(sourceLines[i]);
        String big = text(extras.getCharSequence(Notification.EXTRA_BIG_TEXT)), normal = text(extras.getCharSequence(Notification.EXTRA_TEXT));
        if (NotificationText.authentication(title + "\n" + text(extras.getCharSequence(Notification.EXTRA_TITLE_BIG)), big, normal, lines)) { if (uzum) outcome(event, "Сообщение с кодом подтверждения пропущено"); return; }
        String body = NotificationText.body(big, normal, lines);
        boolean recognised = UzumPushParser.parse(event.getPackageName(), title, body, event.getPostTime()) != null || !BankParser.parse(body).isEmpty();
        if ((notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) { if (uzum) outcome(event, "Сводка уведомлений пропущена; отдельные операции читаются отдельно"); return; }
        if (title.isEmpty() && body.isEmpty()) { if (uzum) outcome(event, "Android передал пустое уведомление"); return; }
        String name = event.getPackageName();
        try { name = getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(name, 0)).toString(); }
        catch (Exception ignored) { /* The package name remains an exact source identifier. */ }
        try (EventStore store = new EventStore(this)) {
            int added = store.capture("push", name, event.getPackageName(), event.getKey(), event.getPostTime(), title, body);
            if (uzum) outcome(event, recognised ? added > 0 ? "Операция распознана; назначение можно уточнить" : "Операция уже сохранена" : "Уведомление получено; формат на проверке в разделе «Данные»");
        } catch (RuntimeException error) {
            if (uzum) outcome(event, "Уведомление получено, но сохранение не удалось");
            CollectorConfig.prefs(this).edit().putString("lastError", "Не удалось сохранить уведомление. Проверь свободное место.").apply();
        }
    }
    private void outcome(StatusBarNotification event, String status) {
        CollectorConfig.prefs(this).edit().putLong("uzumLastPushAt", event.getPostTime()).putString("uzumLastPushStatus", status).apply();
    }
    private static String text(CharSequence value) { return value == null ? "" : value.toString(); }
}
