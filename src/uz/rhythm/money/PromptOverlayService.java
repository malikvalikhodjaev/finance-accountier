package uz.rhythm.money;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

public final class PromptOverlayService extends Service {
    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { PromptOverlay.dismiss(false); }
    };
    @Override public void onCreate() {
        super.onCreate();
        IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(screen, filter, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(screen, filter);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("finance-overlay", "Открытый вопрос", NotificationManager.IMPORTANCE_LOW));
        Intent close = new Intent(this, PromptOverlayService.class).setAction("close");
        PendingIntent button = PendingIntent.getService(this, 5103, close, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, "finance-overlay").setSmallIcon(android.R.drawable.ic_menu_edit).setContentTitle("Вопрос о финансах открыт")
            .setContentText("Можно ответить в окне или закрыть его здесь").setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(new Notification.Action.Builder(null, "Закрыть окно", button).build()).build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(5104, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE); else startForeground(5104, notification);
        } catch (RuntimeException error) { PromptOverlay.dismiss(false); stopSelf(); return START_NOT_STICKY; }
        if (intent != null && "close".equals(intent.getAction())) PromptOverlay.dismiss(true);
        if (!PromptOverlay.visible()) stopSelf();
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() { unregisterReceiver(screen); stopForeground(true); super.onDestroy(); }
}
