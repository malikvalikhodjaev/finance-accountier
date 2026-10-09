package uz.rhythm.money;

import android.content.Context;
import org.json.JSONObject;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;

public final class SyncEngine {
    private static final AtomicBoolean running = new AtomicBoolean(false);
    private SyncEngine() {}
    public static void pair(Context context, String inputUrl, String code) throws Exception {
        if (!running.compareAndSet(false, true)) throw new IllegalStateException("Синхронизация уже выполняется. Повтори подключение после её завершения.");
        try {
        String url = SyncConfig.validateUrl(inputUrl);
        if (!code.matches("[0-9]{6}")) throw new IllegalArgumentException("Введи шестизначный код с компьютера.");
        JSONObject input = new JSONObject(); input.put("code", code); input.put("label", android.os.Build.MODEL);
        JSONObject result = SyncTransport.request(context, url + "/api/pair", input, false);
        String serverId = result.getString("serverId"), previous = SyncConfig.prefs(context).getString("serverId", "");
        if (!serverId.equals(previous)) try (EventStore store = new EventStore(context)) { store.resetSync(); }
        SyncConfig.prefs(context).edit().putString("url", url).putString("token", result.getString("token")).putString("deviceId", result.getString("deviceId")).putString("serverId", serverId).putString("error", "").apply();
        SyncJobs.periodic(context); SyncJobs.queue(context);
        } finally { running.set(false); }
    }
    public static boolean sync(Context context) throws Exception {
        if (!SyncConfig.connected(context) || !running.compareAndSet(false, true)) return false;
        String binding = SyncConfig.prefs(context).getString("token", "");
        try (EventStore store = new EventStore(context)) {
            boolean more = false;
            for (int step = 0; step < 10; step++) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                JSONObject request = store.syncRequest();
                JSONObject response = SyncTransport.request(context, SyncConfig.url(context) + "/api/sync", request, true);
                if (!binding.equals(SyncConfig.prefs(context).getString("token", ""))) return false;
                store.syncResponse(request, response);
                more = response.optBoolean("hasMore") || store.syncRequest().getJSONArray("changes").length() > 0;
                if (!more) break;
            }
            SyncConfig.prefs(context).edit().putString("lastSync", Instant.now().toString()).putString("error", "").apply();
            return more;
        } catch (Exception error) {
            SyncConfig.prefs(context).edit().putString("error", "Нет связи с общей базой. Проверь компьютер и Wi-Fi. Локальные операции сохранены.").apply(); throw error;
        } finally { running.set(false); }
    }
    public static String browser(Context context, String tab) throws Exception {
        JSONObject result = SyncTransport.request(context, SyncConfig.url(context) + "/api/mobile/browser-session", new JSONObject(), true);
        String target = SyncConfig.url(context) + result.getString("path") + "&tab=" + (tab.equals("dashboard") || tab.equals("orders") ? tab : "table");
        if (!SyncConfig.sameOrigin(SyncConfig.url(context), target)) throw new IllegalStateException("Сервер вернул другой адрес."); return target;
    }
}
