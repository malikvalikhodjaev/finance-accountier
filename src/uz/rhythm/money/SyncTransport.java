package uz.rhythm.money;

import android.content.Context;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public final class SyncTransport {
    private SyncTransport() {}
    public static JSONObject request(Context context, String url, JSONObject body, boolean authenticated) throws Exception {
        return new JSONObject(new String(bytes(context, url, body, authenticated, null), StandardCharsets.UTF_8));
    }
    public static JSONObject statement(Context context, String path, JSONObject body) throws Exception {
        return new JSONObject(new String(bytes(context, SyncConfig.url(context) + path, body, true, null, 120000), StandardCharsets.UTF_8));
    }
    public static byte[] bytes(Context context, String url, JSONObject body, boolean authenticated, String cookie) throws Exception {
        return bytes(context, url, body, authenticated, cookie, 20000);
    }
    private static byte[] bytes(Context context, String url, JSONObject body, boolean authenticated, String cookie, int timeout) throws Exception {
        HttpURLConnection connection = (HttpURLConnection)new URL(url).openConnection();
        connection.setConnectTimeout(8000); connection.setReadTimeout(timeout); connection.setInstanceFollowRedirects(false); connection.setRequestProperty("Accept", "application/json");
        if (authenticated) connection.setRequestProperty("Authorization", "Bearer " + SyncConfig.prefs(context).getString("token", ""));
        if (cookie != null) connection.setRequestProperty("Cookie", cookie);
        try {
            if (body != null) { connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); byte[] input = body.toString().getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(input.length); try (java.io.OutputStream output = connection.getOutputStream()) { output.write(input); } }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            byte[] result;
            try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (input != null) { byte[] buffer = new byte[8192]; int read; while ((read = input.read(buffer)) != -1) { if (output.size() + read > 20000000) throw new IllegalStateException("Ответ сервера слишком большой."); output.write(buffer, 0, read); } } result = output.toByteArray();
            }
            if (status < 200 || status >= 300) { String message = "Сервер вернул " + status; try { message = new JSONObject(new String(result, StandardCharsets.UTF_8)).optString("error", message); } catch (Exception ignored) { } throw new IllegalStateException(message); }
            return result;
        } finally { connection.disconnect(); }
    }
}
