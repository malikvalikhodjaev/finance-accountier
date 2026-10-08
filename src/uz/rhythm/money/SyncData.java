package uz.rhythm.money;

import android.content.ContentValues;
import org.json.JSONObject;

public final class SyncData {
    public static final String[] KEYS = "id fingerprint signature source_type source_name source_ref received_at event_millis raw_title raw_text raw_fragment state amount_minor currency kind date time merchant card_suffix balance_minor category description review_reason purpose bank_operation".split(" ");
    public static final String[] EDITABLE = "state amount_minor currency kind date time merchant category description review_reason purpose".split(" ");
    private SyncData() {}
    public static JSONObject canonical(JSONObject input) throws Exception {
        JSONObject result = new JSONObject(); for (String key : KEYS) result.put(key, input.has(key) ? input.get(key) : JSONObject.NULL); return result;
    }
    public static boolean equal(Object a, Object b) {
        if (a == JSONObject.NULL) a = null; if (b == JSONObject.NULL) b = null;
        return a == null ? b == null : b != null && a.toString().equals(b.toString());
    }
    public static ContentValues values(JSONObject event) throws Exception {
        ContentValues value = new ContentValues();
        for (String key : KEYS) {
            if (event.isNull(key)) value.putNull(key);
            else if (key.equals("amount_minor") || key.equals("balance_minor") || key.equals("event_millis")) value.put(key, event.getLong(key));
            else value.put(key, event.getString(key));
        }
        return value;
    }
    public static JSONObject mergeAfterAck(JSONObject current, JSONObject sent, JSONObject remote) throws Exception {
        JSONObject merged = canonical(remote);
        for (String key : EDITABLE) if (!equal(current.opt(key), sent.opt(key))) merged.put(key, current.opt(key));
        return merged;
    }
    public static JSONObject mergePending(JSONObject base, JSONObject current, JSONObject remote) throws Exception {
        JSONObject merged = canonical(remote);
        for (String key : EDITABLE) if (!equal(current.opt(key), base.opt(key))) {
            if (!equal(remote.opt(key), base.opt(key)) && !equal(remote.opt(key), current.opt(key))) return null;
            merged.put(key, current.opt(key));
        }
        return merged;
    }
}
