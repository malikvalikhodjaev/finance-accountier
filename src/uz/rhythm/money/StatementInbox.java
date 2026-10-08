package uz.rhythm.money;

import android.content.Context;
import android.content.Intent;
import android.content.ClipData;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public final class StatementInbox {
    private StatementInbox() {}
    private static File folder(Context context) {
        File folder = new File(context.getFilesDir(), "statements");
        if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("Не удалось сохранить выписку на телефоне.");
        return folder;
    }
    private static File file(Context context, String id, String extension) {
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Выписка не найдена.");
        return new File(folder(context), id + extension);
    }
    private static JSONObject metadata(Context context, String id) throws Exception {
        byte[] bytes = new AtomicFile(file(context, id, ".json")).readFully();
        return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
    }
    private static void metadata(Context context, String id, JSONObject value) throws Exception {
        AtomicFile target = new AtomicFile(file(context, id, ".json")); FileOutputStream stream = null;
        try { stream = target.startWrite(); stream.write(value.toString().getBytes(StandardCharsets.UTF_8)); target.finishWrite(stream); }
        catch (Exception error) { if (stream != null) target.failWrite(stream); throw error; }
    }
    public static List<JSONObject> list(Context context) {
        List<JSONObject> items = new ArrayList<>(); File[] files = folder(context).listFiles();
        if (files != null) for (File entry : files) {
            if (!entry.getName().matches("[a-f0-9-]{36}\\.json")) continue;
            String id = entry.getName().substring(0, 36);
            try { if (file(context, id, ".pdf").isFile()) items.add(metadata(context, id)); }
            catch (Exception ignored) { /* An incomplete receipt never imports financial rows. */ }
        }
        items.sort((a, b) -> b.optString("createdAt").compareTo(a.optString("createdAt")));
        return items;
    }
    public static synchronized String receive(Context context, Intent intent) throws Exception {
        if (!Intent.ACTION_SEND.equals(intent.getAction()) || !"application/pdf".equals(intent.getType())) throw new IllegalArgumentException("Отправь одну PDF-выписку через «Поделиться».");
        Object extra = intent.getParcelableExtra(Intent.EXTRA_STREAM); Uri uri = extra instanceof Uri ? (Uri)extra : null;
        ClipData clip = intent.getClipData();
        if (clip != null && clip.getItemCount() > 1) throw new IllegalArgumentException("Отправь одну PDF-выписку за раз.");
        if (uri == null && clip != null && clip.getItemCount() == 1) uri = clip.getItemAt(0).getUri();
        if (uri == null || !"content".equals(uri.getScheme())) throw new IllegalArgumentException("Файл недоступен. Выбери его в банке или файловом менеджере через «Поделиться».");
        if (list(context).size() >= 10) throw new IllegalStateException("Сохранено 10 выписок. Заверши импорт или убери ненужную копию из «Полученных выписок».");
        String name = "Выписка.pdf";
        try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME); if (column >= 0) name = PdfRules.filename(cursor.getString(column));
                column = cursor.getColumnIndex(OpenableColumns.SIZE); if (column >= 0 && !cursor.isNull(column) && cursor.getLong(column) > PdfRules.MAX_BYTES) throw new IllegalArgumentException("PDF больше 5 МБ. Выгрузи меньший период.");
            }
        }
        String id = UUID.randomUUID().toString(); File partial = file(context, id, ".part"), target = file(context, id, ".pdf");
        try {
            int size;
            try (InputStream input = context.getContentResolver().openInputStream(uri); FileOutputStream output = new FileOutputStream(partial)) {
                if (input == null) throw new IllegalStateException("Не удалось прочитать PDF.");
                size = PdfRules.copy(input, output); output.getFD().sync();
            }
            if (!partial.renameTo(target)) throw new IllegalStateException("Не удалось сохранить PDF.");
            JSONObject value = new JSONObject(); value.put("id", id); value.put("filename", PdfRules.filename(name)); value.put("bytes", size); value.put("sha256", digest(Files.readAllBytes(target.toPath()))); value.put("createdAt", Instant.now().toString());
            metadata(context, id, value); return id;
        } catch (Exception error) { partial.delete(); target.delete(); throw error; }
    }
    private static String digest(byte[] bytes) throws Exception {
        StringBuilder result = new StringBuilder(); for (byte value : MessageDigest.getInstance("SHA-256").digest(bytes)) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255)); return result.toString();
    }
    public static synchronized JSONObject prepare(Context context, String id) throws Exception {
        if (!SyncConfig.connected(context)) throw new IllegalStateException("PDF сохранён. Подключи общую базу в «Ритме», затем открой «Полученные выписки».");
        JSONObject saved = metadata(context, id); String server = SyncConfig.prefs(context).getString("serverId", "");
        String prepared = saved.optString("importId"); JSONObject preview;
        if (prepared.matches("[a-f0-9-]{36}") && server.equals(saved.optString("serverId"))) preview = SyncTransport.statement(context, "/api/mobile/imports/" + prepared, null);
        else {
            File source = file(context, id, ".pdf"); if (source.length() > PdfRules.MAX_BYTES) throw new IllegalStateException("PDF больше 5 МБ.");
            byte[] bytes = Files.readAllBytes(source.toPath()); if (!digest(bytes).equals(saved.getString("sha256"))) throw new IllegalStateException("Сохранённая копия изменилась. Отправь исходную выписку ещё раз.");
            JSONObject input = new JSONObject(); input.put("filename", saved.getString("filename")); input.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            preview = SyncTransport.statement(context, "/api/mobile/imports/preview", input);
        }
        if (!server.equals(SyncConfig.prefs(context).getString("serverId", ""))) throw new IllegalStateException("Подключение изменилось. Повтори импорт.");
        if (!preview.optString("id").matches("[a-f0-9-]{36}") || !saved.getString("sha256").equals(preview.optString("sha256"))) throw new IllegalStateException("Сервер не подтвердил сохранение исходного PDF.");
        saved.put("importId", preview.getString("id")); saved.put("serverId", server); metadata(context, id, saved);
        return preview;
    }
    public static void remove(Context context, String id) {
        File pdf = file(context, id, ".pdf"); if (pdf.exists() && !pdf.delete()) throw new IllegalStateException("Не удалось убрать копию выписки.");
        new AtomicFile(file(context, id, ".json")).delete();
    }
}
