package uz.rhythm.money;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.widget.LinearLayout;
import android.widget.Button;
import android.widget.TextView;
import android.graphics.Color;
import android.widget.Toast;
import java.io.File;
import java.nio.file.Files;

public final class WebActivity extends Activity {
    private WebView web;
    private LinearLayout page;
    private ValueCallback<Uri[]> fileCallback;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setBackgroundColor(Color.WHITE); setContentView(page);
        getWindow().setStatusBarColor(Color.WHITE); getWindow().setNavigationBarColor(Color.WHITE); getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        page.setOnApplyWindowInsetsListener((view, insets) -> { page.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom()); return insets; });
        Button back = new Button(this); back.setText("К сборщику · Ритм деньги"); back.setAllCaps(false); back.setOnClickListener(v -> finish()); page.addView(back);
        TextView loading = new TextView(this); loading.setText("Открываю общую базу…"); loading.setTextSize(16); loading.setPadding(24, 24, 24, 24); page.addView(loading);
        new Thread(() -> {
            try {
                SyncEngine.sync(this);
                String target = SyncEngine.browser(this, "dashboard".equals(getIntent().getStringExtra("tab")) ? "dashboard" : "table");
                String importId = getIntent().getStringExtra("importId");
                if (importId != null && importId.matches("[a-f0-9-]{36}")) target += "&import=" + importId;
                final String address = target;
                runOnUiThread(() -> { page.removeView(loading); createWeb(address); });
            } catch (Exception error) { runOnUiThread(() -> loading.setText("Компьютер недоступен. Проверь Wi-Fi и запущен ли сервер на ПК. Операции продолжают сохраняться на телефоне.")); }
        }, "rhythm-web").start();
    }
    private void createWeb(String target) {
        if (isFinishing()) return;
        web = new WebView(this); page.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true); web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(true); web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW); CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !SyncConfig.sameOrigin(SyncConfig.url(WebActivity.this), request.getUrl().toString()); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) Toast.makeText(WebActivity.this, "Нет связи с ПК. Локальные операции сохранены.", Toast.LENGTH_LONG).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!SyncConfig.sameOrigin(SyncConfig.url(WebActivity.this), view.getUrl())) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent choose = new Intent(Intent.ACTION_OPEN_DOCUMENT); choose.addCategory(Intent.CATEGORY_OPENABLE); choose.setType("*/*"); choose.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
                try { startActivityForResult(choose, 83); }
                catch (Exception error) { fileCallback.onReceiveValue(null); fileCallback = null; Toast.makeText(WebActivity.this, "Не удалось открыть выбор PDF или Excel.", Toast.LENGTH_LONG).show(); }
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> download(url)); web.loadUrl(target);
    }
    private void download(String url) {
        if (!SyncConfig.sameOrigin(SyncConfig.url(this), url)) return;
        Uri address = Uri.parse(url); if (!(address.getPath().equals("/api/export") || address.getPath().equals("/api/backup"))) return;
        String cookie = CookieManager.getInstance().getCookie(url);
        new Thread(() -> { try {
            boolean json = address.getPath().equals("/api/backup"); File folder = new File(getCacheDir(), "exports"); if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException();
            String name = (json ? "notifications-" : "transactions-") + System.currentTimeMillis() + (json ? ".json" : ".csv");
            Files.write(new File(folder, name).toPath(), SyncTransport.bytes(this, url, null, false, cookie));
            runOnUiThread(() -> { Uri uri = Uri.parse("content://uz.rhythm.money.exports/" + name); Intent share = new Intent(Intent.ACTION_SEND); share.setType(json ? "application/json" : "text/csv"); share.putExtra(Intent.EXTRA_STREAM, uri); share.setClipData(android.content.ClipData.newRawUri("Экспорт", uri)); share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); startActivity(Intent.createChooser(share, "Сохранить таблицу")); });
        } catch (Exception error) { runOnUiThread(() -> Toast.makeText(this, "Не удалось скачать файл. Проверь связь с ПК.", Toast.LENGTH_LONG).show()); } }, "rhythm-download").start();
    }
    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 83 && fileCallback != null) {
            Uri selected = result == RESULT_OK && data != null ? data.getData() : null;
            fileCallback.onReceiveValue(selected != null && "content".equals(selected.getScheme()) ? new Uri[] { selected } : null); fileCallback = null;
        }
    }
    @Override public void onDestroy() { if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; } if (web != null) { page.removeView(web); web.destroy(); } super.onDestroy(); }
}
