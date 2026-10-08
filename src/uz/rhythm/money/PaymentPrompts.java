package uz.rhythm.money;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import org.json.JSONObject;

public final class PaymentPrompts {
    public static final String CHANNEL = "payment-purpose";
    public static final String REPLY_KEY = "payment-purpose-answer";
    public static final String EVENT_EXTRA = "purpose-event-id";
    public static final String QUICK_EXTRA = "purpose-quick-answer";
    private PaymentPrompts() {}

    public static void ensureChannel(Context context) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, "На что потратил?", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Короткий вопрос после банковского сообщения об оплате.");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    public static boolean allowed(Context context) {
        ensureChannel(context);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return manager.areNotificationsEnabled() && manager.getNotificationChannel(CHANNEL).getImportance() != NotificationManager.IMPORTANCE_NONE
            && (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
    }
    public static boolean needsAnswer(JSONObject row) {
        return !row.isNull("amount_minor") && PurposeRules.needsAnswer(row.optString("state"), row.optString("kind"), operation(row), row.optString("purpose", ""));
    }
    public static String operation(JSONObject row) {
        String operation = row.optString("bank_operation", "");
        if (operation.isEmpty()) {
            java.util.List<BankParser.Transaction> parsed = BankParser.parse(row.optString("raw_fragment", ""));
            if (!parsed.isEmpty()) operation = parsed.get(0).operation;
        }
        return operation;
    }
    public static void afterCapture(Context context, EventStore store, String id) {
        if (!CollectorConfig.prefs(context).getBoolean("askPurpose", true)) return;
        try {
            JSONObject row = store.find(id);
            if (!needsAnswer(row) || !PurposeRules.notifyNow(row.optString("source_type"), row.optString("state"), row.optString("kind"), operation(row), row.optString("purpose", ""), row.optString("date"), row.optLong("event_millis"), System.currentTimeMillis())) return;
            if (!allowed(context)) {
                CollectorConfig.prefs(context).edit().putString("promptError", "Операции сохраняются, но вопросы не показываются. Разреши уведомления «На что потратил?».").apply();
                return;
            }
            post(context, row);
            CollectorConfig.prefs(context).edit().remove("promptError").apply();
        } catch (RuntimeException error) {
            CollectorConfig.prefs(context).edit().putString("promptError", "Операция сохранена. Вопрос можно открыть в её карточке.").apply();
        }
    }
    private static PendingIntent response(Context context, String id, String action, String quick, boolean mutable) {
        Intent intent = new Intent(context, PurposeReply.class);
        intent.setAction("uz.rhythm.money.PURPOSE_" + action);
        intent.setData(Uri.parse("rhythm-money://purpose/" + id + "/" + action));
        intent.putExtra(EVENT_EXTRA, id);
        if (quick != null) intent.putExtra(QUICK_EXTRA, quick);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (!mutable) flags |= PendingIntent.FLAG_IMMUTABLE;
        else if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(context, 0, intent, flags);
    }
    private static void post(Context context, JSONObject row) {
        String id = row.optString("id");
        Intent open = new Intent(context, MainActivity.class);
        open.setData(Uri.parse("rhythm-money://purpose/" + id + "/open"));
        open.putExtra(EVENT_EXTRA, id);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        RemoteInput input = new RemoteInput.Builder(REPLY_KEY).setLabel("На что? Например, обед или такси домой").setChoices(PurposeRules.CHOICES).setAllowFreeFormInput(true).build();
        Notification.Action reply = new Notification.Action.Builder(null, "Ответить", response(context, id, "REPLY", null, true)).addRemoteInput(input).setAllowGeneratedReplies(false).build();
        String amount = Formats.displayAmount(row.optLong("amount_minor")) + " " + row.optString("currency");
        String merchant = row.optString("merchant", row.optString("source_name"));
        Notification publicVersion = new Notification.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_edit).setContentTitle("На что потратил?").setContentText("Добавь назначение оплаты").build();
        Notification question = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_edit).setContentTitle("На что потратил?")
            .setContentText(amount + " · " + merchant)
            .setStyle(new Notification.BigTextStyle().bigText(amount + "\n" + merchant + "\nОтветь здесь или нажми уведомление, чтобы выбрать категорию. Можно ответить позже."))
            .setContentIntent(tap).setAutoCancel(false).setOnlyAlertOnce(true).setWhen(row.optLong("event_millis"))
            .setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(publicVersion)
            .addAction(reply)
            .addAction(new Notification.Action.Builder(null, "Еда", response(context, id, "FOOD", "Еда", false)).build())
            .addAction(new Notification.Action.Builder(null, "Транспорт", response(context, id, "TRANSPORT", "Транспорт", false)).build())
            .build();
        context.getSystemService(NotificationManager.class).notify("purpose:" + id, 1, question);
    }
    public static void cancel(Context context, String id) { context.getSystemService(NotificationManager.class).cancel("purpose:" + id, 1); }
}
