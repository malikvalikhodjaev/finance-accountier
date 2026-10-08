package uz.rhythm.money;

import android.content.Context;
import android.content.SharedPreferences;
import java.net.URI;

public final class SyncConfig {
    private SyncConfig() {}
    public static SharedPreferences prefs(Context context) { return context.getSharedPreferences("webSync", Context.MODE_PRIVATE); }
    public static boolean connected(Context context) { return !prefs(context).getString("token", "").isEmpty(); }
    public static String url(Context context) { return prefs(context).getString("url", ""); }
    public static String validateUrl(String input) {
        try {
            String text = input.trim(); if (!text.contains("://")) text = "http://" + text;
            URI uri = new URI(text);
            if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))) throw new IllegalArgumentException();
            String host = uri.getHost(); boolean privateAddress = host.matches("(?:10\\.[0-9.]+|192\\.168\\.[0-9.]+|172\\.(?:1[6-9]|2[0-9]|3[01])\\.[0-9.]+)");
            if (!(uri.getScheme().equals("https") || uri.getScheme().equals("http") && privateAddress)) throw new IllegalArgumentException();
            if (uri.getPort() < -1 || uri.getPort() == 0 || uri.getPort() > 65535) throw new IllegalArgumentException();
            return uri.getScheme() + "://" + host + (uri.getPort() == -1 ? "" : ":" + uri.getPort());
        } catch (Exception error) { throw new IllegalArgumentException("Введи адрес с компьютера, например http://192.168.100.83:8788."); }
    }
    public static boolean sameOrigin(String base, String target) {
        try { URI a = new URI(base), b = new URI(target); return a.getScheme().equals(b.getScheme()) && a.getHost().equals(b.getHost()) && a.getPort() == b.getPort() && b.getUserInfo() == null; }
        catch (Exception error) { return false; }
    }
}
