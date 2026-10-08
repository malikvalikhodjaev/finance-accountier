package uz.rhythm.money;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public final class CollectorConfig {
    private CollectorConfig() {}
    public static SharedPreferences prefs(Context context) { return context.getSharedPreferences("collector", Context.MODE_PRIVATE); }
    public static boolean enabled(Context context) { return prefs(context).getBoolean("enabled", true); }
    public static Set<String> apps(Context context) { return new HashSet<>(prefs(context).getStringSet("apps", new HashSet<String>())); }
    public static boolean acceptsApp(Context context, String packageName) { return enabled(context) && apps(context).contains(packageName); }
    public static boolean acceptsSender(Context context, String sender) {
        if (!enabled(context) || sender == null) return false;
        String normalized = sender.trim().toLowerCase(Locale.ROOT);
        for (String configured : prefs(context).getString("senders", "").split("[\\n,;]+"))
            if (!configured.trim().isEmpty() && configured.trim().toLowerCase(Locale.ROOT).equals(normalized)) return true;
        return false;
    }
}
