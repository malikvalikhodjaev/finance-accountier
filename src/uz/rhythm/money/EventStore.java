package uz.rhythm.money;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public final class EventStore extends SQLiteOpenHelper {
    private final Context context;
    public EventStore(Context context) { super(context, "money.db", null, 4); this.context = context.getApplicationContext(); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE events (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, signature TEXT, source_type TEXT NOT NULL, source_name TEXT NOT NULL, source_ref TEXT NOT NULL, received_at TEXT NOT NULL, event_millis INTEGER NOT NULL, raw_title TEXT NOT NULL, raw_text TEXT NOT NULL, raw_fragment TEXT NOT NULL, state TEXT NOT NULL, amount_minor INTEGER, currency TEXT, kind TEXT, date TEXT, time TEXT, merchant TEXT, card_suffix TEXT, balance_minor INTEGER, category TEXT, description TEXT, review_reason TEXT, purpose TEXT NOT NULL DEFAULT '', bank_operation TEXT NOT NULL DEFAULT '')");
        db.execSQL("CREATE INDEX events_signature ON events(signature)");
        db.execSQL("CREATE TABLE revisions (event_id TEXT NOT NULL, changed_at TEXT NOT NULL, previous_json TEXT NOT NULL)");
        syncSchema(db);
        historyIndexes(db);
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion == 1 && newVersion >= 2) {
            db.execSQL("ALTER TABLE events ADD COLUMN purpose TEXT NOT NULL DEFAULT ''");
            db.execSQL("ALTER TABLE events ADD COLUMN bank_operation TEXT NOT NULL DEFAULT ''");
        }
        if (oldVersion <= 2 && newVersion >= 3) syncSchema(db);
        if (oldVersion <= 3 && newVersion >= 4) historyIndexes(db);
        if (oldVersion < 1 || newVersion > 4) throw new IllegalStateException("Требуется отдельная миграция хранилища.");
    }
    private void historyIndexes(SQLiteDatabase db) {
        db.execSQL("CREATE INDEX IF NOT EXISTS events_state_date ON events(state, date, kind)");
        db.execSQL("CREATE INDEX IF NOT EXISTS events_history_order ON events(COALESCE(date, ''), COALESCE(time, ''), received_at)");
        db.execSQL("CREATE INDEX IF NOT EXISTS revisions_event ON revisions(event_id, changed_at)");
        db.execSQL("CREATE INDEX IF NOT EXISTS events_sync_pending ON events(received_at) WHERE local_revision > synced_revision AND sync_conflict = ''");
    }
    private void syncSchema(SQLiteDatabase db) {
        db.execSQL("ALTER TABLE events ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 1");
        db.execSQL("ALTER TABLE events ADD COLUMN synced_revision INTEGER NOT NULL DEFAULT 0");
        db.execSQL("ALTER TABLE events ADD COLUMN server_version INTEGER NOT NULL DEFAULT 0");
        db.execSQL("ALTER TABLE events ADD COLUMN server_base TEXT NOT NULL DEFAULT ''");
        db.execSQL("ALTER TABLE events ADD COLUMN sync_conflict TEXT NOT NULL DEFAULT ''");
        db.execSQL("CREATE TABLE sync_state (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
    }

    public int capture(String type, String name, String ref, String identity, long millis, String title, String raw) {
        return capture(type, name, ref, identity, millis, title, raw, false);
    }
    int captureHistory(String sender, long millis, String raw) {
        return capture("sms", sender, sender, sender, millis, sender, raw, true);
    }
    private int capture(String type, String name, String ref, String identity, long millis, String title, String raw, boolean history) {
        if (title.length() + raw.length() > 40000 || Formats.authenticationText(title + "\n" + raw)) return 0;
        if (title.isEmpty() && raw.trim().isEmpty()) return 0;
        List<String> fragments = BankParser.fragments(raw);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        int count = 0;
        List<String> promptIds = new ArrayList<>();
        try {
            for (int index = 0; index < fragments.size(); index++) {
                String fragment = fragments.get(index);
                List<BankParser.Transaction> parsed = BankParser.parse(fragment);
                ContentValues value = base(type, name, ref, identity, millis, title, raw, fragment, index);
                if (containsFingerprint(db, value.getAsString("fingerprint"))) continue;
                if (parsed.isEmpty()) {
                    value.put("state", "review"); value.put("review_reason", "Формат ещё не распознан. Уточни операцию.");
                    if (db.insertWithOnConflict("events", null, value, SQLiteDatabase.CONFLICT_IGNORE) != -1) count++;
                    continue;
                }
                BankParser.Transaction t = parsed.get(0);
                value.put("bank_operation", t.operation);
                value.put("signature", t.signature); value.put("amount_minor", t.amountMinor); value.put("currency", t.currency);
                value.put("kind", t.kind); value.put("date", t.date); value.put("time", t.time); value.put("merchant", t.merchant);
                value.put("card_suffix", t.cardSuffix); if (t.balanceMinor != null) value.put("balance_minor", t.balanceMinor);
                String learned = CollectorConfig.prefs(context).getString(categoryKey(t.merchant), null);
                value.put("category", learned != null && t.kind.equals("expense") ? learned : t.category);
                value.put("description", t.merchant.substring(0, Math.min(500, t.merchant.length())));
                boolean possibleDuplicate = containsSignature(db, t.signature);
                value.put("state", possibleDuplicate ? "duplicate" : t.kind.equals("unknown") ? "review" : "recorded");
                value.put("review_reason", possibleDuplicate ? "Возможный повтор SMS/push. В итоги не включён. Если это отдельная оплата, сохрани её." : t.reviewReason);
                if (db.insertWithOnConflict("events", null, value, SQLiteDatabase.CONFLICT_IGNORE) != -1) {
                    count++; promptIds.add(value.getAsString("id"));
                }
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        if (!history) {
            for (String id : promptIds) PaymentPrompts.afterCapture(context, this, id);
            if (count > 0) SyncJobs.queue(context);
        }
        return count;
    }
    private ContentValues base(String type, String name, String ref, String identity, long millis, String title, String raw, String fragment, int index) {
        ContentValues value = new ContentValues();
        value.put("id", UUID.randomUUID().toString());
        value.put("fingerprint", Formats.fingerprint(type + ":" + ref, identity + ":" + index, Long.toString(millis), title, raw));
        value.put("source_type", type); value.put("source_name", name); value.put("source_ref", ref);
        value.put("received_at", Instant.now().toString()); value.put("event_millis", millis);
        value.put("raw_title", title); value.put("raw_text", raw); value.put("raw_fragment", fragment);
        return value;
    }
    private boolean containsFingerprint(SQLiteDatabase db, String fingerprint) {
        try (Cursor c = db.rawQuery("SELECT 1 FROM events WHERE fingerprint = ? LIMIT 1", new String[]{fingerprint})) { return c.moveToFirst(); }
    }
    private boolean containsSignature(SQLiteDatabase db, String signature) {
        try (Cursor c = db.rawQuery("SELECT 1 FROM events WHERE signature = ? AND state != 'ignored' LIMIT 1", new String[]{signature})) { return c.moveToFirst(); }
    }
    public List<JSONObject> all() {
        List<JSONObject> result = new ArrayList<>();
        try (Cursor c = getReadableDatabase().query("events", null, null, null, null, null, "COALESCE(date, '') DESC, COALESCE(time, '') DESC, received_at DESC")) {
            while (c.moveToNext()) result.add(row(c));
        }
        return result;
    }
    public JSONObject find(String id) {
        try (Cursor c = getReadableDatabase().query("events", null, "id = ?", new String[]{id}, null, null, null)) {
            if (!c.moveToFirst()) throw new IllegalArgumentException("Запись не найдена.");
            return row(c);
        }
    }
    public JSONObject statistics() {
        String question = "purpose = '' AND ((state='recorded' AND kind='expense') OR (state='review' AND kind='unknown' AND (LOWER(bank_operation)='platezh' OR LOWER(bank_operation) LIKE 'spisanie %')))";
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) total, COALESCE(SUM(state='review'),0) review, COALESCE(SUM(state='duplicate'),0) duplicates, COALESCE(SUM(state='recorded' AND kind='expense' AND category='Без категории'),0) categories, COALESCE(SUM(" + question + "),0) unanswered FROM events", null)) { c.moveToFirst(); return row(c); }
    }
    public List<JSONObject> recent(String first, boolean ignored) {
        List<JSONObject> result = new ArrayList<>();
        String selection = "(state != 'recorded' OR date >= ?)" + (ignored ? "" : " AND state != 'ignored'");
        try (Cursor c = getReadableDatabase().query("events", null, selection, new String[]{first}, null, null, "COALESCE(date, '') DESC, COALESCE(time, '') DESC, received_at DESC", "101")) { while (c.moveToNext()) result.add(row(c)); }
        return result;
    }
    public List<JSONObject> summary(String first) {
        List<JSONObject> result = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT currency, kind, SUM(amount_minor) amount_minor FROM events WHERE state='recorded' AND date>=? GROUP BY currency,kind", new String[]{first})) { while (c.moveToNext()) result.add(row(c)); }
        return result;
    }
    public List<JSONObject> breakdown(String first, boolean merchant) {
        List<JSONObject> result = new ArrayList<>();
        String key = merchant ? "COALESCE(NULLIF(merchant,''),NULLIF(description,''),'Вручную')" : "COALESCE(NULLIF(category,''),'Без категории')";
        try (Cursor c = getReadableDatabase().rawQuery("SELECT " + key + " label, currency, SUM(amount_minor) amount_minor FROM events WHERE state='recorded' AND kind='expense' AND date>=? GROUP BY " + key + ",currency ORDER BY amount_minor DESC LIMIT 20", new String[]{first})) { while (c.moveToNext()) result.add(row(c)); }
        return result;
    }
    JSONObject historyState() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT value FROM sync_state WHERE name='sms_history'", null)) {
            if (!c.moveToFirst()) return new JSONObject();
            return new JSONObject(c.getString(0));
        } catch (org.json.JSONException error) { throw new IllegalStateException(error); }
    }
    public List<OwnTransfers.Pair> transferCandidates() {
        List<OwnTransfers.Item> items=new ArrayList<>();
        try (Cursor c=getReadableDatabase().rawQuery("SELECT id,card_suffix,currency,amount_minor,date,time,bank_operation,merchant,local_revision,server_version FROM events WHERE state='review' AND kind='unknown' AND source_type='sms' AND sync_conflict='' AND card_suffix IS NOT NULL AND date IS NOT NULL AND time IS NOT NULL",null)) {
            while (c.moveToNext()) try { items.add(new OwnTransfers.Item(c.getString(0),c.getString(1),c.getString(2),c.getLong(3),c.getString(4),c.getString(5),c.getString(6),c.getString(7),c.getLong(8),c.getLong(9))); } catch (RuntimeException ignored) { }
        }
        return OwnTransfers.candidates(items);
    }
    public void confirmTransfer(OwnTransfers.Pair pair) {
        SQLiteDatabase db=getWritableDatabase(); db.beginTransaction();
        try {
            for (OwnTransfers.Item item : new OwnTransfers.Item[]{pair.outgoing,pair.incoming}) {
                JSONObject current=find(item.id);
                if (!current.optString("state").equals("review") || !current.optString("kind").equals("unknown") || current.optLong("local_revision")!=item.revision || current.optLong("server_version")!=item.serverVersion || !current.optString("sync_conflict").isEmpty())
                    throw new IllegalArgumentException("Операция изменилась. Перечитай список переводов.");
                ContentValues value=new ContentValues(); value.put("kind","transfer"); value.put("state","recorded"); value.put("category","Перевод своих денег"); value.put("purpose","Свои деньги"); value.put("review_reason","");
                revise(item.id,current,value);
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    void historyState(JSONObject state) {
        ContentValues value = new ContentValues(); value.put("name", "sms_history"); value.put("value", state.toString());
        getWritableDatabase().insertWithOnConflict("sync_state", null, value, SQLiteDatabase.CONFLICT_REPLACE);
    }
    private JSONObject row(Cursor cursor) {
        JSONObject result = new JSONObject();
        try {
            for (int i = 0; i < cursor.getColumnCount(); i++) {
                Object value = cursor.isNull(i) ? JSONObject.NULL : cursor.getType(i) == Cursor.FIELD_TYPE_INTEGER ? cursor.getLong(i) : cursor.getString(i);
                result.put(cursor.getColumnName(i), value);
            }
        } catch (Exception error) { throw new IllegalStateException(error); }
        return result;
    }
    public void saveTransaction(String id, String amount, String currency, String kind, String date, String category, String description) {
        long minor = Formats.amountMinor(amount);
        String code = Formats.currency(currency), day = Formats.validateDate(date);
        if (!(kind.equals("expense") || kind.equals("income") || kind.equals("transfer"))) throw new IllegalArgumentException("Неизвестный тип операции.");
        if (category.length() > 120 || description.length() > 500) throw new IllegalArgumentException("Категория: до 120 символов; описание: до 500.");
        ContentValues value = new ContentValues();
        value.put("amount_minor", minor); value.put("currency", code); value.put("kind", kind); value.put("date", day);
        value.put("category", category.trim().isEmpty() ? "Без категории" : category.trim()); value.put("description", description.trim());
        value.put("state", "recorded"); value.put("review_reason", "");
        JSONObject previous = find(id);
        revise(id, previous, value);
        String merchant = previous.optString("merchant", "");
        if (kind.equals("expense") && !merchant.isEmpty() && !category.trim().isEmpty() && !category.trim().equals("Без категории"))
            CollectorConfig.prefs(context).edit().putString(categoryKey(merchant), category.trim()).apply();
        PaymentPrompts.cancel(context, id);
    }
    public void savePurpose(String id, String answer) {
        String purpose = PurposeRules.validate(answer);
        JSONObject previous = find(id);
        String state = previous.optString("state"), kind = previous.optString("kind");
        boolean outgoing = PurposeRules.needsAnswer(state, kind, PaymentPrompts.operation(previous), "");
        if (previous.isNull("amount_minor") || (!outgoing && !(state.equals("recorded") && kind.equals("transfer") && !previous.optString("purpose", "").isEmpty())))
            throw new IllegalArgumentException("Операция изменилась. Проверь её в приложении.");
        ContentValues value = new ContentValues(); value.put("purpose", purpose);
        String category = PurposeRules.category(purpose);
        if (category.equals("Свои деньги")) {
            value.put("kind", "transfer"); value.put("state", "recorded"); value.put("category", "Перевод своих денег"); value.put("review_reason", "");
        } else if (kind.equals("expense")) {
            if (!category.isEmpty()) value.put("category", category);
        } else if (kind.equals("unknown") && PurposeRules.resolvedKind(kind, purpose).equals("expense")) {
            value.put("kind", "expense"); value.put("state", "recorded"); value.put("category", category); value.put("review_reason", "");
        } else if (kind.equals("unknown")) {
            value.put("review_reason", "Назначение записано. Уточни: расход или перевод своих денег.");
        }
        // Purpose applies to this payment, and does not train a merchant-wide category rule.
        revise(id, previous, value);
        PaymentPrompts.cancel(context, id);
    }
    public String manual(String amount, String currency, String kind, String date, String category, String description) {
        // Validate before creating an entry; a cancelled form leaves no records.
        Formats.amountMinor(amount); Formats.currency(currency); Formats.validateDate(date);
        if (!(kind.equals("expense") || kind.equals("income") || kind.equals("transfer")) || category.length() > 120 || description.length() > 500)
            throw new IllegalArgumentException("Проверь тип операции, категорию и описание.");
        long millis = System.currentTimeMillis();
        ContentValues value = base("manual", "Вручную", "manual", UUID.randomUUID().toString(), millis, "", description, description, 0);
        value.put("state", "review");
        String id = value.getAsString("id");
        getWritableDatabase().insertOrThrow("events", null, value);
        saveTransaction(id, amount, currency, kind, date, category, description);
        return id;
    }
    public void ignore(String id) {
        ContentValues value = new ContentValues(); value.put("state", "ignored");
        revise(id, find(id), value);
        PaymentPrompts.cancel(context, id);
    }
    private void revise(String id, JSONObject previous, ContentValues value) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues revision = new ContentValues();
            revision.put("event_id", id); revision.put("changed_at", Instant.now().toString()); revision.put("previous_json", previous.toString());
            db.insertOrThrow("revisions", null, revision);
            value.put("local_revision", previous.optLong("local_revision", 1) + 1);
            value.put("sync_conflict", "");
            if (db.update("events", value, "id = ?", new String[]{id}) != 1) throw new IllegalStateException("Не удалось сохранить запись.");
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        SyncJobs.queue(context);
    }
    public void exportFile(java.io.File file,boolean raw) throws Exception {
        SQLiteDatabase db=getReadableDatabase(); db.beginTransactionNonExclusive();
        try (java.io.BufferedWriter writer=java.nio.file.Files.newBufferedWriter(file.toPath(),java.nio.charset.StandardCharsets.UTF_8)) {
            if (raw) {
                writer.write("{\"version\":2,\"exportedAt\":"+JSONObject.quote(Instant.now().toString())+",\"timezone\":\"Asia/Tashkent\",\"events\":[");
                exportArray(writer,db.query("events",null,null,null,null,null,"received_at"));
                writer.write("],\"revisions\":["); exportArray(writer,db.query("revisions",null,null,null,null,null,"changed_at")); writer.write("]}");
            } else {
                writer.write("externalId,date,amount,currency,type,category,description\r\n");
                try (Cursor c=db.query("events",new String[]{"id","date","amount_minor","currency","kind","category","description","purpose"},"state='recorded'",null,null,null,"date DESC,time DESC,received_at DESC")) {
                    while (c.moveToNext()) {
                        String[] fields={c.getString(0),c.getString(1),Formats.amount(c.getLong(2)),c.getString(3),c.getString(4),c.getString(5),PurposeRules.exportDescription(c.isNull(6) ? "" : c.getString(6),c.getString(7))};
                        for (int i=0;i<fields.length;i++) { if (i>0) writer.write(','); writer.write(Formats.csv(fields[i]==null ? "" : fields[i])); }
                        writer.write("\r\n");
                    }
                }
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    private void exportArray(java.io.Writer writer,Cursor cursor) throws Exception {
        try (Cursor c=cursor) { boolean first=true; while (c.moveToNext()) { if (!first) writer.write(','); writer.write(row(c).toString()); first=false; } }
    }
    public int pendingSync() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM events WHERE local_revision > synced_revision", null)) { c.moveToFirst(); return c.getInt(0); }
    }
    public int syncConflicts() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM events WHERE sync_conflict != ''", null)) { c.moveToFirst(); return c.getInt(0); }
    }
    private String syncState(String name, String fallback) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT value FROM sync_state WHERE name=?", new String[]{name})) { return c.moveToFirst() ? c.getString(0) : fallback; }
    }
    private void putSyncState(String name, String text) {
        ContentValues value = new ContentValues(); value.put("name", name); value.put("value", text);
        getWritableDatabase().insertWithOnConflict("sync_state", null, value, SQLiteDatabase.CONFLICT_REPLACE);
    }
    public JSONObject syncRequest() {
        try {
            JSONObject request = new JSONObject(); request.put("cursor", Long.parseLong(syncState("cursor", "0"))); request.put("resolvedIds", new JSONArray(syncState("resolvedIds", "[]")));
            JSONArray changes = new JSONArray(); int bytes = 0;
            try (Cursor c = getReadableDatabase().rawQuery("SELECT * FROM events WHERE local_revision > synced_revision AND sync_conflict = '' ORDER BY received_at LIMIT 100", null)) {
                while (c.moveToNext()) {
                    JSONObject event = row(c), change = new JSONObject(); change.put("event", SyncData.canonical(event)); change.put("clientRevision", event.optLong("local_revision", 1)); change.put("baseVersion", event.optLong("server_version"));
                    JSONArray revisions = new JSONArray();
                    try (Cursor r = getReadableDatabase().rawQuery("SELECT * FROM revisions WHERE event_id=? ORDER BY changed_at DESC LIMIT 10", new String[]{event.getString("id")})) { while (r.moveToNext()) revisions.put(row(r)); }
                    change.put("revisions", revisions);
                    int size = change.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
                    if (changes.length() > 0 && bytes + size > 1000000) break;
                    bytes += size;
                    changes.put(change);
                }
            }
            request.put("changes", changes); return request;
        } catch (Exception error) { throw new IllegalStateException(error); }
    }
    public void syncResponse(JSONObject request, JSONObject response) {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            JSONArray acknowledgements = response.optJSONArray("acknowledgements");
            for (int i = 0; acknowledgements != null && i < acknowledgements.length(); i++) {
                JSONObject ack = acknowledgements.getJSONObject(i), current = find(ack.getString("id")), sent = null;
                JSONArray batch = request.getJSONArray("changes");
                for (int j = 0; j < batch.length(); j++) if (batch.getJSONObject(j).getJSONObject("event").getString("id").equals(ack.getString("id"))) sent = batch.getJSONObject(j).getJSONObject("event");
                JSONObject remote = ack.getJSONObject("event");
                if (sent != null) {
                    JSONObject merged = SyncData.mergeAfterAck(current, sent, remote);
                    ContentValues value = SyncData.values(merged);
                    value.put("synced_revision", ack.getLong("clientRevision")); value.put("server_version", ack.getLong("version")); value.put("server_base", remote.toString()); value.put("sync_conflict", "");
                    applySync(db, current, value);
                }
            }
            JSONArray conflicts = response.optJSONArray("conflicts");
            for (int i = 0; conflicts != null && i < conflicts.length(); i++) {
                JSONObject conflict = conflicts.getJSONObject(i), current = find(conflict.getString("id"));
                if (current.optLong("local_revision") != conflict.getLong("clientRevision")) continue;
                ContentValues value = new ContentValues(); value.put("sync_conflict", conflict.toString()); db.update("events", value, "id=?", new String[]{current.getString("id")});
            }
            JSONArray resolvedIds = new JSONArray(), resolutions = response.optJSONArray("resolutions");
            for (int i = 0; resolutions != null && i < resolutions.length(); i++) {
                JSONObject resolution = resolutions.getJSONObject(i), current = find(resolution.getString("id"));
                if (current.optLong("local_revision") == resolution.getLong("clientRevision") && !current.optString("sync_conflict").isEmpty()) {
                    JSONObject remote = resolution.getJSONObject("event"); ContentValues value = SyncData.values(remote);
                    value.put("synced_revision", current.optLong("local_revision")); value.put("server_version", resolution.getLong("version")); value.put("server_base", remote.toString()); value.put("sync_conflict", ""); applySync(db, current, value);
                }
                resolvedIds.put(resolution.getString("resolutionId"));
            }
            JSONArray changes = response.getJSONArray("changes");
            for (int i = 0; i < changes.length(); i++) {
                JSONObject change = changes.getJSONObject(i), remote = change.getJSONObject("event"); String id = remote.getString("id");
                JSONObject current = null; try { current = find(id); } catch (IllegalArgumentException ignored) { }
                if (current != null && current.optLong("server_version") >= change.getLong("version")) continue;
                if (current != null && !current.optString("sync_conflict").isEmpty()) continue;
                JSONObject merged = remote;
                if (current != null && current.optLong("local_revision") > current.optLong("synced_revision")) {
                    String base = current.optString("server_base"); if (base.isEmpty()) continue;
                    merged = SyncData.mergePending(new JSONObject(base), current, remote); if (merged == null) continue;
                }
                ContentValues value = SyncData.values(merged); value.put("server_version", change.getLong("version")); value.put("server_base", remote.toString());
                if (current == null) { value.put("local_revision", 1); value.put("synced_revision", 1); db.insertOrThrow("events", null, value); }
                else { if (current.optLong("local_revision") <= current.optLong("synced_revision")) value.put("synced_revision", current.optLong("local_revision")); applySync(db, current, value); }
                PaymentPrompts.cancel(context, id);
            }
            putSyncState("cursor", Long.toString(response.getLong("cursor"))); putSyncState("resolvedIds", resolvedIds.toString()); db.setTransactionSuccessful();
        } catch (Exception error) { throw new IllegalStateException("Не удалось применить синхронизацию; локальные записи сохранены.", error); }
        finally { db.endTransaction(); }
    }
    private void applySync(SQLiteDatabase db, JSONObject previous, ContentValues value) throws Exception {
        boolean changed = false;
        for (String key : SyncData.EDITABLE) if (value.containsKey(key) && !SyncData.equal(previous.opt(key), value.get(key))) changed = true;
        if (changed) { ContentValues revision = new ContentValues(); revision.put("event_id", previous.getString("id")); revision.put("changed_at", Instant.now().toString()); revision.put("previous_json", previous.toString()); db.insertOrThrow("revisions", null, revision); }
        db.update("events", value, "id=?", new String[]{previous.getString("id")});
    }
    public void resetSync() {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try { db.execSQL("UPDATE events SET synced_revision=0,server_version=0,server_base='',sync_conflict=''"); db.delete("sync_state", "name != ?", new String[]{"sms_history"}); db.setTransactionSuccessful(); }
        finally { db.endTransaction(); }
    }
    private static String categoryKey(String merchant) { return "category:" + Formats.fingerprint("merchant", "", "", merchant.trim().toLowerCase(Locale.ROOT), ""); }
}
