package uz.rhythm.money;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.Toast;
import java.io.File;
import java.nio.file.Files;

/** Shared dashboards inside the main app shell, without a second navigation bar. */
final class FinanceWebPanel {
    interface Host { void unavailable(); void selected(String tab); }
    private final Activity activity;
    private final Host host;
    private final LinearLayout container;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String selected;
    private boolean destroyed, failed, pending = true;

    FinanceWebPanel(Activity activity, LinearLayout container, String selected, Host host) {
        this.activity = activity; this.container = container; this.selected = selected; this.host = host;
        new Thread(() -> {
            try {
                String address = SyncEngine.browser(activity, selected) + "&embedded=1";
                activity.runOnUiThread(() -> create(address));
                SyncJobs.queue(activity);
            } catch (Exception error) { activity.runOnUiThread(this::unavailable); }
        }, "finance-home").start();
    }
    private void unavailable() {
        if (destroyed || failed || activity.isFinishing()) return;
        failed = true; host.unavailable();
    }
    private void create(String address) {
        if (destroyed || activity.isFinishing()) return;
        container.removeAllViews(); web = new WebView(activity);
        web.setBackgroundColor(UIStyles.BACKGROUND);
        container.addView(web, new LinearLayout.LayoutParams(-1, -1));
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(true);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !SyncConfig.sameOrigin(SyncConfig.url(activity), request.getUrl().toString());
            }
            @Override public void onPageFinished(WebView view, String url) { navigate(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) unavailable();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onReceivedTitle(WebView view, String title) {
                if (!SyncConfig.sameOrigin(SyncConfig.url(activity), view.getUrl())) return;
                String tab = Uri.parse(view.getUrl()).getQueryParameter("tab");
                if ("dashboard".equals(tab) || "table".equals(tab)) {
                    if (pending && !selected.equals(tab)) return;
                    pending = false; selected = tab; host.selected(tab);
                }
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!SyncConfig.sameOrigin(SyncConfig.url(activity), view.getUrl())) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent choose = new Intent(Intent.ACTION_OPEN_DOCUMENT); choose.addCategory(Intent.CATEGORY_OPENABLE);
                choose.setType("*/*"); choose.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
                try { activity.startActivityForResult(choose, 83); }
                catch (RuntimeException error) { fileCallback.onReceiveValue(null); fileCallback = null; toast("Не удалось открыть выбор файла."); }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> download(url)); web.loadUrl(address);
    }
    void select(String tab) { selected = tab; pending = true; navigate(); }
    private void navigate() {
        if (web != null && !destroyed && SyncConfig.sameOrigin(SyncConfig.url(activity), web.getUrl())) {
            String requested = selected;
            web.evaluateJavascript("window.financeNavigate?window.financeNavigate(" + org.json.JSONObject.quote(requested) + "):null", value -> {
                if (!destroyed && selected.equals(requested) && org.json.JSONObject.quote(requested).equals(value)) { pending = false; host.selected(requested); }
            });
        }
    }
    boolean result(int request, int result, Intent data) {
        if (request != 83 || fileCallback == null) return false;
        Uri selectedFile = result == Activity.RESULT_OK && data != null ? data.getData() : null;
        fileCallback.onReceiveValue(selectedFile != null && "content".equals(selectedFile.getScheme()) ? new Uri[]{selectedFile} : null);
        fileCallback = null; return true;
    }
    boolean back() {
        if (web != null && web.canGoBack()) { web.goBack(); return true; } return false;
    }
    private void download(String url) {
        if (!SyncConfig.sameOrigin(SyncConfig.url(activity), url)) return;
        Uri address = Uri.parse(url);
        if (!("/api/export".equals(address.getPath()) || "/api/backup".equals(address.getPath()))) return;
        String cookie = CookieManager.getInstance().getCookie(url);
        new Thread(() -> {
            try {
                boolean json = "/api/backup".equals(address.getPath()); File folder = new File(activity.getCacheDir(), "exports");
                if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException();
                String name = (json ? "notifications-" : "transactions-") + System.currentTimeMillis() + (json ? ".json" : ".csv");
                Files.write(new File(folder, name).toPath(), SyncTransport.bytes(activity, url, null, false, cookie));
                activity.runOnUiThread(() -> {
                    if (destroyed || activity.isFinishing()) return;
                    Uri uri = Uri.parse("content://uz.rhythm.money.exports/" + name); Intent share = new Intent(Intent.ACTION_SEND);
                    share.setType(json ? "application/json" : "text/csv"); share.putExtra(Intent.EXTRA_STREAM, uri);
                    share.setClipData(android.content.ClipData.newRawUri("Экспорт", uri)); share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    activity.startActivity(Intent.createChooser(share, "Сохранить таблицу"));
                });
            } catch (Exception error) { activity.runOnUiThread(() -> toast("Не удалось скачать файл. Проверь связь с ПК.")); }
        }, "finance-download").start();
    }
    private void toast(String text) { if (!destroyed) Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }
    void destroy() {
        destroyed = true;
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (web != null) { container.removeView(web); web.stopLoading(); web.destroy(); web = null; }
    }
}
