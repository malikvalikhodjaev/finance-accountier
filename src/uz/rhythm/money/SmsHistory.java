package uz.rhythm.money;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.provider.Telephony;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

public final class SmsHistory {
    private static final AtomicBoolean running = new AtomicBoolean();
    private static volatile boolean paused;
    private SmsHistory() {}
    public static boolean running() { return running.get(); }
    public static void pause() { paused = true; }
    public static final class Preview {
        public final Map<String, Integer> senders = new LinkedHashMap<>();
        public final Map<String, HistoryRules.DateRange> senderDates = new LinkedHashMap<>();
        public final HistoryRules.DateRange dates = new HistoryRules.DateRange();
        public int inbox; public long maxId;
    }
    public static Preview preview(Context context) {
        Preview preview = new Preview();
        String configured = CollectorConfig.prefs(context).getString("senders", "").toLowerCase(Locale.ROOT);
        Set<String> extra = new java.util.HashSet<>();
        for (String value : configured.split("[\\n,;]+")) if (!value.trim().isEmpty()) extra.add(value.trim());
        try (Cursor c = context.getContentResolver().query(Telephony.Sms.CONTENT_URI, new String[]{"_id", "address", "date"}, "type=1", null, "_id ASC")) {
            if (c == null) throw new IllegalStateException("Телефон не вернул список SMS.");
            while (c.moveToNext()) {
                preview.inbox++; preview.maxId = Math.max(preview.maxId, c.getLong(0));
                long received = c.isNull(2) ? 0 : c.getLong(2);
                preview.dates.include(received);
                String sender = c.getString(1); if (sender == null) continue;
                if (HistoryRules.bankSender(sender) || extra.contains(sender.trim().toLowerCase(Locale.ROOT))) {
                    preview.senders.put(sender, preview.senders.containsKey(sender) ? preview.senders.get(sender) + 1 : 1);
                    HistoryRules.DateRange dates = preview.senderDates.get(sender);
                    if (dates == null) { dates = new HistoryRules.DateRange(); preview.senderDates.put(sender, dates); }
                    dates.include(received);
                }
            }
        }
        return preview;
    }
    private static String selection(JSONArray senders) {
        StringBuilder where = new StringBuilder("type=1 AND _id>? AND _id<=? AND address IN (");
        for (int i=0; i<senders.length(); i++) where.append(i == 0 ? "?" : ",?");
        return where.append(')').toString();
    }
    private static String[] arguments(JSONObject state) {
        JSONArray senders = state.optJSONArray("senders");
        String[] args = new String[senders.length()+2]; args[0] = Long.toString(state.optLong("lastId")); args[1] = Long.toString(state.optLong("maxId"));
        for (int i=0; i<senders.length(); i++) args[i+2] = senders.optString(i);
        return args;
    }
    public static void start(Context input, List<String> senders, boolean resume) {
        Context context = input.getApplicationContext();
        if (!running.compareAndSet(false, true)) return;
        paused = false;
        new Thread(() -> {
            try (EventStore store = new EventStore(context)) {
                JSONObject state = store.historyState();
                if (!resume || !state.has("senders")) {
                    if (senders.isEmpty()) throw new IllegalArgumentException("Выбери банковских отправителей.");
                    Preview preview = preview(context);
                    state = new JSONObject(); state.put("senders", new JSONArray(senders)); state.put("maxId", preview.maxId);
                    int total=0; for (String sender : senders) total += preview.senders.containsKey(sender) ? preview.senders.get(sender) : countSender(context, sender, preview.maxId);
                    state.put("total",total); state.put("lastId",0); state.put("scanned",0); state.put("inserted",0); state.put("same",0); state.put("otp",0); state.put("other",0); state.put("startedAt",Instant.now().toString());
                }
                state.put("phase","importing"); state.put("error", ""); store.historyState(state);
                while (!paused && !state.optBoolean("complete")) {
                    List<Message> messages = new ArrayList<>();
                    try (Cursor c = context.getContentResolver().query(Telephony.Sms.CONTENT_URI, new String[]{"_id","address","date","date_sent","body"}, selection(state.getJSONArray("senders")), arguments(state), "_id ASC")) {
                        if (c == null) throw new IllegalStateException("Не удалось прочитать SMS.");
                        while (messages.size()<200 && c.moveToNext()) messages.add(new Message(c));
                    }
                    if (messages.isEmpty()) { state.put("complete",true); store.historyState(state); break; }
                    SQLiteDatabase db = store.getWritableDatabase(); db.beginTransaction();
                    try {
                        for (Message message : messages) {
                            state.put("scanned",state.optInt("scanned")+1); state.put("lastId",message.id);
                            if (Formats.authenticationText(message.text)) increment(state,"otp",1);
                            else if (!HistoryRules.financial(message.text) || message.text.length()>40000) increment(state,"other",1);
                            else {
                                int inserted = store.captureHistory(message.sender,message.millis,message.text);
                                increment(state,inserted == 0 ? "same" : "inserted", inserted == 0 ? 1 : inserted);
                            }
                        }
                        state.put("updatedAt",Instant.now().toString()); store.historyState(state); db.setTransactionSuccessful();
                    } finally { db.endTransaction(); }
                }
                if (paused) { state.put("phase","paused"); store.historyState(state); }
                else {
                    state.put("phase",SyncConfig.connected(context) ? "syncing" : "done"); store.historyState(state);
                    if (SyncConfig.connected(context)) {
                        boolean more;
                        do { more = SyncEngine.sync(context); if (!paused && (more || store.pendingSync()>store.syncConflicts())) Thread.sleep(300); }
                        while (!paused && (more || store.pendingSync()>store.syncConflicts()));
                        state.put("phase", paused ? "paused" : "done"); store.historyState(state);
                    }
                }
                SyncJobs.queue(context);
            } catch (Exception error) {
                try (EventStore store = new EventStore(context)) {
                    JSONObject state = store.historyState(); state.put("phase","error");
                    state.put("error",error instanceof SecurityException ? "Разреши чтение SMS в настройках приложения и продолжи импорт." : "Импорт прерван. Сохранённые записи остаются в базе; нажми «Продолжить». " + (error.getMessage() == null ? "" : error.getMessage()));
                    store.historyState(state);
                } catch (Exception ignored) { }
            } finally { running.set(false); }
        }, "bank-sms-history").start();
    }
    private static int countSender(Context context, String sender, long maxId) {
        try (Cursor c = context.getContentResolver().query(Telephony.Sms.CONTENT_URI,new String[]{"_id"},"type=1 AND address=? AND _id<=?",new String[]{sender,Long.toString(maxId)},null)) { return c == null ? 0 : c.getCount(); }
    }
    private static void increment(JSONObject state, String key, int amount) throws org.json.JSONException { state.put(key,state.optInt(key)+amount); }
    private static final class Message {
        final long id, millis; final String sender, text;
        Message(Cursor c) { id=c.getLong(0); sender=c.getString(1); millis=c.getLong(3)>0 ? c.getLong(3) : c.getLong(2); text=c.isNull(4) ? "" : c.getString(4); }
    }
}
