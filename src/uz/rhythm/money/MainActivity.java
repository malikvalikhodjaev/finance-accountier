package uz.rhythm.money;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class MainActivity extends Activity {
    private LinearLayout page;
    private EventStore store;
    private int period = 30;
    private boolean showIgnored = false;
    private Boolean expandSetup = true;
    private String section = "dashboard", webServer = "";
    private LinearLayout navigation, webContainer;
    private android.widget.FrameLayout body;
    private FinanceWebPanel webPanel;
    private boolean offline;
    private boolean exporting;
    private ScrollView nativeScroll;
    private volatile int renderGeneration;
    private final java.util.concurrent.ExecutorService reads = java.util.concurrent.Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) { section = state.getString("section", "dashboard"); period = state.getInt("period", 30); }
        store = new EventStore(this);
        PaymentPrompts.ensureChannel(this);
        SyncJobs.periodic(this);
        IncomeReminders.initialize(this);
        UIStyles.window(this);
        acceptShared(getIntent());
        render();
        openPurposeIntent(getIntent());
    }
    @Override public void onResume() { super.onResume(); BankNotifications.ensureConnected(this); if (store != null && (webPanel == null || !(section.equals("dashboard") || section.equals("table")))) render(); PromptOverlay.resume(this); }
    @Override public void onDestroy() { reads.shutdownNow(); resetWeb(); if (store != null) store.close(); super.onDestroy(); }
    @Override public void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); acceptShared(intent); render(); openPurposeIntent(intent); }
    private void openPurposeIntent(Intent intent) {
        String id = intent.getStringExtra(PaymentPrompts.EVENT_EXTRA);
        if (id == null || !id.matches("[a-f0-9-]{36}")) return;
        intent.removeExtra(PaymentPrompts.EVENT_EXTRA);
        try { purpose(store.find(id)); } catch (RuntimeException error) { toast(error.getMessage()); }
    }
    private void acceptShared(Intent intent) {
        if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text != null) {
                int count = store.capture("shared", "Поделиться", "shared", java.util.UUID.randomUUID().toString(), System.currentTimeMillis(), "", text.toString());
                toast(count > 0 ? "Добавлено записей: " + count : "Сообщение с признаками кода подтверждения не сохраняется.");
            }
        }
    }
    private void render() {
        final long started = android.os.SystemClock.elapsedRealtime();
        renderGeneration++;
        if (webPanel != null && (!SyncConfig.connected(this) || !webServer.equals(SyncConfig.url(this)))) resetWeb();
        if (body == null) createShell();
        renderNavigation();
        if (webContainer != null) webContainer.setVisibility(View.INVISIBLE);
        if (nativeScroll != null) nativeScroll.setVisibility(View.INVISIBLE);
        renderBody();
        final String selected = section; final int generation = renderGeneration;
        body.getViewTreeObserver().addOnPreDrawListener(new android.view.ViewTreeObserver.OnPreDrawListener() {
            public boolean onPreDraw() {
                if (body.getViewTreeObserver().isAlive()) body.getViewTreeObserver().removeOnPreDrawListener(this);
                if (generation == renderGeneration) android.util.Log.i("FinancePerf", "native tab=" + selected + " paint_ms=" + (android.os.SystemClock.elapsedRealtime() - started));
                return true;
            }
        });
    }
    private void createShell() {
        LinearLayout shell = vertical(); shell.setBackgroundColor(UIStyles.BACKGROUND);
        shell.setOnApplyWindowInsetsListener((view, insets) -> { shell.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom()); return insets; });
        setContentView(shell); shell.requestApplyInsets();
        LinearLayout identity = new LinearLayout(this); identity.setGravity(android.view.Gravity.CENTER_VERTICAL); identity.setPadding(dp(20), dp(10), dp(20), dp(10));
        android.widget.ImageView logo = new android.widget.ImageView(this); logo.setImageResource(getResources().getIdentifier("icon", "drawable", getPackageName()));
        LinearLayout.LayoutParams mark = new LinearLayout.LayoutParams(dp(36), dp(36)); mark.rightMargin = dp(10); identity.addView(logo, mark);
        LinearLayout name = vertical(); heading(name, "My Personal", 16); TextView subtitle = label(name, "Throughput Accounting", 12); subtitle.setPadding(0, 0, 0, 0);
        identity.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
        TextView owner = new TextView(this); owner.setText("МВ"); owner.setGravity(android.view.Gravity.CENTER); UIStyles.text(owner, 14);
        owner.setBackground(UIStyles.rounded(this, Color.rgb(232,232,236), 22, false)); owner.setContentDescription("Малик Валиходжаев · Настройки"); owner.setTooltipText("Малик Валиходжаев"); owner.setOnClickListener(v -> selectSection("settings"));
        identity.addView(owner, new LinearLayout.LayoutParams(dp(44), dp(44))); shell.addView(identity);
        body = new android.widget.FrameLayout(this); shell.addView(body, new LinearLayout.LayoutParams(-1, 0, 1));
        navigation = new LinearLayout(this); navigation.setGravity(android.view.Gravity.CENTER); navigation.setPadding(dp(8), dp(8), dp(8), dp(8));
        navigation.setBackgroundColor(Color.WHITE); navigation.setElevation(dp(8)); shell.addView(navigation);
    }
    private void renderBody() {
        if ((section.equals("dashboard") || section.equals("table")) && SyncConfig.connected(this) && !offline) {
            if (webContainer == null) {
                webContainer = vertical(); webContainer.setGravity(android.view.Gravity.CENTER);
                label(webContainer, "Открываю " + (section.equals("dashboard") ? "дашборды…" : "таблицы…"), 16);
                android.widget.ProgressBar loading = new android.widget.ProgressBar(this); webContainer.addView(loading, new LinearLayout.LayoutParams(dp(30), dp(30)));
                body.addView(webContainer, new android.widget.FrameLayout.LayoutParams(-1, -1));
            }
            webContainer.setVisibility(View.VISIBLE);
            if (webPanel == null) {
                webServer = SyncConfig.url(this);
                webPanel = new FinanceWebPanel(this, webContainer, section, new FinanceWebPanel.Host() {
                    public void unavailable() { offline = true; resetWeb(); if (section.equals("dashboard") || section.equals("table")) render(); }
                    public void selected(String tab) { if (section.equals("dashboard") || section.equals("table")) { section = tab; renderNavigation(); } }
                });
            }
            return;
        }
        if (nativeScroll == null) { nativeScroll = new ScrollView(this); nativeScroll.setFillViewport(true); body.addView(nativeScroll, new android.widget.FrameLayout.LayoutParams(-1, -1)); }
        nativeScroll.removeAllViews(); nativeScroll.setVisibility(View.VISIBLE);
        page = vertical(); page.setPadding(dp(20), dp(8), dp(20), dp(24)); nativeScroll.addView(page); nativeScroll.scrollTo(0, 0);
        if (section.equals("settings")) renderSettings(); else if (section.equals("data")) renderData();
        else if (section.equals("table")) renderLocalTable(); else renderLocalDashboard();
    }
    private void selectSection(String selected) {
        if (selected.equals(section)) return;
        boolean fromWeb = webPanel != null && (section.equals("dashboard") || section.equals("table"));
        section = selected;
        if (selected.equals("dashboard") || selected.equals("table")) {
            offline = false;
            if (fromWeb) { webPanel.select(selected); renderNavigation(); return; }
        }
        render(); if (webPanel != null && (section.equals("dashboard") || section.equals("table"))) webPanel.select(section);
    }
    private void renderNavigation() {
        navigation.removeAllViews();
        String[] tabs = {"dashboard", "table", "data", "settings"}, titles = {"Дашборды", "Таблицы", "Данные", "Настройки"};
        for (int i = 0; i < tabs.length; i++) {
            String tab = tabs[i]; boolean active = section.equals(tab);
            LinearLayout item = vertical(); item.setGravity(android.view.Gravity.CENTER); item.setPadding(dp(2), dp(6), dp(2), dp(6));
            if (active) { item.setBackground(UIStyles.rounded(this, UIStyles.BACKGROUND, 14, true)); item.setElevation(dp(2)); }
            item.addView(new NavigationIcon(this, tab, active), new LinearLayout.LayoutParams(dp(23), dp(23)));
            TextView text = new TextView(this); text.setText(titles[i]); UIStyles.text(text, 11); text.setTextColor(active ? UIStyles.INK : UIStyles.MUTED); text.setPadding(0, dp(5), 0, 0); item.addView(text);
            item.setContentDescription(titles[i]); text.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            item.setSelected(active); item.setFocusable(true); item.setOnClickListener(v -> selectSection(tab));
            LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(0, dp(64), 1); layout.setMargins(dp(2), 0, dp(2), 0); navigation.addView(item, layout);
        }
    }
    private void resetWeb() { if (webPanel != null) webPanel.destroy(); if (body != null && webContainer != null) body.removeView(webContainer); webPanel = null; webContainer = null; }
    private interface DataText { String read(EventStore database) throws Exception; }
    private void loadText(TextView target, DataText query) {
        final int generation = renderGeneration;
        reads.execute(() -> {
            if (generation != renderGeneration || reads.isShutdown()) return;
            String result;
            try (EventStore database = new EventStore(getApplicationContext())) { result = query.read(database); }
            catch (Exception error) { result = "Не удалось обновить сведения. Открой раздел ещё раз."; }
            final String text = result;
            runOnUiThread(() -> { if (!isFinishing() && !isDestroyed() && generation == renderGeneration && target.isAttachedToWindow()) { target.setText(text); target.setVisibility(text.isEmpty() ? View.GONE : View.VISIBLE); } });
        });
    }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); state.putString("section", section); state.putInt("period", period); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data); if (webPanel != null) webPanel.result(request, result, data);
    }
    @Override public void onBackPressed() {
        if (webPanel != null && (section.equals("dashboard") || section.equals("table")) && webPanel.back()) return;
        if (!section.equals("dashboard")) selectSection("dashboard"); else super.onBackPressed();
    }
    private void offlineNotice() {
        LinearLayout box = card(page);
        heading(box, SyncConfig.connected(this) ? "Локальный обзор" : "Данные на телефоне", 18);
        label(box, SyncConfig.connected(this) ? "ПК сейчас недоступен. Здесь — сохранённые операции телефона; общие дашборды откроются после соединения." : "Подключи компьютер в настройках, чтобы открыть общие таблицы и ТОС-дашборды.", 13);
        button(box, SyncConfig.connected(this) ? "Повторить соединение" : "Подключить компьютер", () -> {
            if (SyncConfig.connected(this)) { offline = false; resetWeb(); render(); } else selectSection("settings");
        });
    }
    private void periodControl() {
        label(page, "Период", 12); LinearLayout periods = new LinearLayout(this); page.addView(periods);
        int[] values = {7, 30, -1, 0}; String[] labels = {"7 дней", "30 дней", "Месяц", "Всё"};
        for (int i = 0; i < values.length; i++) {
            int days = values[i]; Button control = new Button(this); control.setText(labels[i]); UIStyles.button(control, days == period); control.setTextSize(12); control.setPadding(dp(4), dp(8), dp(4), dp(8));
            LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(0, dp(48), 1); layout.setMargins(dp(2), 0, dp(2), 0); periods.addView(control, layout); control.setOnClickListener(v -> { period = days; render(); });
        }
    }
    private String firstDate() { LocalDate today = LocalDate.now(Formats.ZONE); return period == 0 ? "0000-00-00" : period == -1 ? today.withDayOfMonth(1).toString() : today.minusDays(period - 1).toString(); }
    private void renderLocalDashboard() {
        heading(page, "Мои финансы", 28); periodControl();
        String first = firstDate();
        Map<String, long[]> totals = new LinkedHashMap<>();
        Map<String, Long> byCategory = new LinkedHashMap<>(), byMerchant = new LinkedHashMap<>();
        for (JSONObject row : store.summary(first)) {
            String code = row.optString("currency"), kind = row.optString("kind");
            long amount = row.optLong("amount_minor");
            long[] sums = totals.get(code); if (sums == null) { sums = new long[3]; totals.put(code, sums); }
            sums[kind.equals("expense") ? 0 : kind.equals("income") ? 1 : 2] += amount;
        }
        for (JSONObject row : store.breakdown(first, false)) byCategory.put(row.optString("label") + " · " + row.optString("currency"), row.optLong("amount_minor"));
        for (JSONObject row : store.breakdown(first, true)) byMerchant.put(row.optString("label") + " · " + row.optString("currency"), row.optLong("amount_minor"));
        LinearLayout summary = card(page);
        heading(summary, period == 0 ? "По всей истории" : period == -1 ? "Этот месяц" : "За " + period + " дней", 21);
        if (totals.isEmpty()) label(summary, "Нет учтённых операций за этот период.", 15);
        for (Map.Entry<String, long[]> total : totals.entrySet()) {
            label(summary, "Доходы · " + total.getKey(), 12);
            heading(summary, Formats.displayAmount(total.getValue()[1]), 25);
            label(summary, "Расходы · " + Formats.displayAmount(total.getValue()[0]) + " " + total.getKey(), 16);
            label(summary, "Перемещения денег · " + Formats.displayAmount(total.getValue()[2]), 13);
        }
        label(summary, "Это учёт по полученным сообщениям. Неясные поступления, списания и возможные повторы исключены из сумм.", 13);
        breakdown(page, "Куда уходят деньги", byCategory);
        breakdown(page, "Магазины и сервисы", byMerchant);

        button(page, "Добавить поступление", () -> startActivity(new Intent(this, IncomeActivity.class)));
        offlineNotice();
    }
    private void renderLocalTable() {
        heading(page, "Операции телефона", 28); periodControl();
        button(page, "Добавить операцию", () -> edit(null));
        String first = firstDate();
        heading(page, "Операции и уведомления", 21);
        button(page, showIgnored ? "Скрыть исключённые" : "Показать исключённые", () -> { showIgnored = !showIgnored; render(); });
        int shown = 0;
        for (JSONObject row : store.recent(first, showIgnored)) {
            String state = row.optString("state");
            if (state.equals("ignored") && !showIgnored) continue;
            String date = row.optString("date", Formats.date(row.optLong("event_millis")));
            if (state.equals("recorded") && date.compareTo(first) < 0) continue;
            if (++shown > 100) { label(page, "Показаны первые 100 записей. Экспорт включает всю историю.", 13); break; }
            LinearLayout box = card(page);
            String merchant = row.optString("merchant", "");
            heading(box, merchant.isEmpty() ? row.optString("source_name") : merchant, 17);
            label(box, date + " " + row.optString("time", "") + " · " + row.optString("source_type"), 12);
            if (!row.isNull("amount_minor")) label(box, Formats.displayAmount(row.optLong("amount_minor")) + " " + row.optString("currency"), 20);
            label(box, state.equals("recorded") ? kindLabel(row.optString("kind")) + " · " + row.optString("category") : state.equals("ignored") ? "Исключено из учёта. Можно восстановить через сохранение." : row.optString("review_reason"), 14);
            if (!row.optString("purpose", "").isEmpty()) label(box, "На что: " + row.optString("purpose"), 15);
            button(box, state.equals("recorded") ? "Открыть / исправить" : "Уточнить", () -> edit(row));
            if (PaymentPrompts.needsAnswer(row) || (!row.optString("purpose", "").isEmpty() && state.equals("recorded")))
                button(box, row.optString("purpose", "").isEmpty() ? "На что потратил?" : "Изменить назначение", () -> purpose(row));
            if (state.equals("recorded") && row.optString("kind").equals("expense")) button(box, "Категория продавца", () -> category(row));
        }
        if (shown == 0) label(page, "Здесь появятся сообщения после настройки сбора. Можно также поделиться банковским SMS в это приложение.", 15);

        offlineNotice();
    }
    private void renderSettings() {
        heading(page, "Настройки", 28); label(page, "МВ · Малик Валиходжаев", 14);
        LinearLayout setup = card(page);
        boolean access = notificationAccess(), enabled = CollectorConfig.enabled(this);
        heading(setup, enabled ? "Сбор включён" : "Сбор на паузе", 18);
        label(setup, "Приложений выбрано: " + CollectorConfig.apps(this).size() + " · Доступ к уведомлениям: " + (access ? "есть" : "нужен"), 13);
        label(setup, BankNotifications.status(this), 13);
        label(setup, CollectorConfig.apps(this).contains(UzumPushParser.PACKAGE) ? "Uzum Bank: уведомления включены" : "Uzum Bank не выбран — добавь его в «Окна и поступления»", 13);
        boolean smsReady = !CollectorConfig.prefs(this).getString("senders", "").trim().isEmpty() && checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
        label(setup, "Приём SMS: " + (smsReady ? "настроен" : "не настроен"), 13);
        boolean ready = smsReady || (access && !CollectorConfig.apps(this).isEmpty());
        boolean asks = CollectorConfig.prefs(this).getBoolean("askPurpose", true);
        boolean promptsAllowed = PaymentPrompts.allowed(this);
        label(setup, "«На что потратил?»: " + (!asks ? "выключено" : PromptOverlay.allowed(this) ? "окно поверх приложений" : promptsAllowed ? "уведомление · доступ поверх приложений не выдан" : "нужно разрешить показ вопросов"), 13);
        button(setup, "Окна и поступления", () -> startActivity(new Intent(this, PromptSettingsActivity.class)));
        if (asks && !promptsAllowed) button(setup, "Разрешить вопросы после оплаты", this::allowPromptNotifications);
        boolean expanded = expandSetup == null ? !ready : expandSetup;
        button(setup, expanded ? "Свернуть настройки" : "Настроить сбор", () -> { expandSetup = !expanded; render(); });
        if (expanded) {
            label(setup, "SMS принимаются только от заданных отправителей. Сообщения с признаками кода или пароля пропускаются.", 13);
            button(setup, "Выбрать Uzum, Payme и другие приложения", this::chooseApps);
            button(setup, "Дать доступ к уведомлениям", () -> openSettings(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
            button(setup, "SMS: задать отправителей", this::configureSms);
            button(setup, asks ? "Выключить вопросы после оплаты" : "Включить вопросы после оплаты", () -> {
                CollectorConfig.prefs(this).edit().putBoolean("askPurpose", !asks).apply();
                if (asks) {
                    PromptOverlay.paused(this);
                    android.app.NotificationManager manager = getSystemService(android.app.NotificationManager.class);
                    for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications())
                        if (notification.getTag() != null && notification.getTag().startsWith("purpose:")) manager.cancel(notification.getTag(), notification.getId());
                }
                else { if (!PaymentPrompts.allowed(this)) allowPromptNotifications(); BankNotifications.refresh(this); }
                render();
            });
            button(setup, enabled ? "Поставить сбор на паузу" : "Возобновить сбор", () -> { CollectorConfig.prefs(this).edit().putBoolean("enabled", !enabled).apply(); render(); });
        }
        String error = CollectorConfig.prefs(this).getString("lastError", "");
        if (!error.isEmpty()) label(setup, error, 13);
        String promptError = CollectorConfig.prefs(this).getString("promptError", "");
        if (!promptError.isEmpty() && asks) label(setup, promptError, 13);

        LinearLayout shared = card(page); heading(shared, "Связь с компьютером", 20);
        label(shared, SyncConfig.connected(this) ? "Общая база подключена" : "Общая база не подключена", 14);
        if (SyncConfig.connected(this)) {
            loadText(label(shared, "Проверяю синхронизацию…", 13), database -> "Ожидают отправки: " + database.pendingSync() + " · Конфликтов: " + database.syncConflicts());
            String lastSync = SyncConfig.prefs(this).getString("lastSync", "");
            if (!lastSync.isEmpty()) label(shared, "Последняя связь: " + java.time.Instant.parse(lastSync).atZone(Formats.ZONE).format(java.time.format.DateTimeFormatter.ofPattern("dd.MM HH:mm")), 13);
            String syncError = SyncConfig.prefs(this).getString("error", ""); if (!syncError.isEmpty()) label(shared, syncError, 13);
            button(shared, "Синхронизировать сейчас", this::syncNow);
        }
        button(shared, SyncConfig.connected(this) ? "Настроить связь с компьютером" : "Подключить компьютер", this::configureSync);
        label(page, "Версия " + BuildInfo.VERSION + " · Сборка " + BuildInfo.COMMIT, 12);
    }
    private void renderData() {
        heading(page, "Данные", 28); label(page, "Источники, загрузка истории и проверка операций", 14);
        LinearLayout quality = card(page); heading(quality, "Нужно проверить", 20);
        loadText(label(quality, "Проверяю операции…", 14), database -> { JSONObject stats = database.statistics(); return "На уточнение: " + stats.optInt("review") + " · Возможные повторы: " + stats.optInt("duplicates") + "\nБез категории: " + stats.optInt("categories") + " · Без ответа «На что?»: " + stats.optInt("unanswered"); });
        button(quality, "Открыть операции телефона", () -> { offline = true; section = "table"; render(); });
        LinearLayout statements = card(page); heading(statements, "Выписки и заказы", 20);
        button(statements, "Банковские выписки", () -> startActivity(new Intent(this, ImportActivity.class)));
        loadText(label(statements, "Проверяю полученные файлы…", 13), database -> "Полученных выписок: " + StatementInbox.list(getApplicationContext()).size());
        label(statements, "PDF банков и Excel Payme можно отправить сюда через «Поделиться».", 13);
        if (SyncConfig.connected(this)) button(statements, "Заказы сервисов", () -> openWeb("orders"));
        LinearLayout history = card(page); heading(history, "История банковских SMS", 20);
        label(history, "Забрать старые операции с телефона. Переводы и неясные поступления проверяются отдельно от расходов.", 14);
        loadText(label(history, "Проверяю историю импорта…", 13), database -> { JSONObject imported = database.historyState(); return imported.has("total") ? "Просмотрено SMS: " + imported.optInt("scanned") + " из " + imported.optInt("total") + " · Добавлено операций: " + imported.optInt("inserted") : ""; });
        button(history, "Импортировать старые SMS", () -> startActivity(new Intent(this, HistoryActivity.class)));
        button(history, "Проверить переводы между моими картами", () -> startActivity(new Intent(this, TransfersActivity.class)));

        LinearLayout exports = card(page); heading(exports, "Экспорт и резервная копия", 20);
        button(exports, "Экспорт операций · CSV", () -> export(false));
        button(exports, "Исходные сообщения · JSON", () -> export(true));
    }
    private void openWeb(String tab) { Intent intent = new Intent(this, WebActivity.class); intent.putExtra("tab", tab); startActivity(intent); }
    private void configureSync() {
        LinearLayout fields = vertical(); fields.setPadding(dp(20), dp(10), dp(20), dp(10));
        label(fields, "Открой My Personal Throughput Accounting на ПК → Подключение → Получить код. Телефон и компьютер должны быть в одной Wi-Fi-сети.", 14);
        EditText url = input(fields, "Адрес с компьютера", SyncConfig.url(this), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        EditText code = input(fields, "Шестизначный код", "", InputType.TYPE_CLASS_NUMBER);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Подключить общую таблицу").setView(fields).setPositiveButton("Подключить", null).setNegativeButton("Отмена", null).create();
        if (SyncConfig.connected(this)) {
            Button disconnect = new Button(this); disconnect.setText("Отключить синхронизацию"); disconnect.setAllCaps(false); fields.addView(disconnect);
            disconnect.setOnClickListener(v -> { SyncJobs.cancel(this); SyncConfig.prefs(this).edit().remove("token").remove("error").apply(); android.webkit.CookieManager.getInstance().removeAllCookies(null); resetWeb(); dialog.dismiss(); render(); });
        }
        dialog.setOnShowListener(v -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            String target = url.getText().toString(), pairingCode = code.getText().toString().trim();
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            new Thread(() -> { try {
                SyncEngine.pair(this, target, pairingCode);
                runOnUiThread(() -> { resetWeb(); dialog.dismiss(); render(); syncNow(); });
            } catch (Exception error) { runOnUiThread(() -> { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true); toast(error.getMessage()); }); } }, "rhythm-pair").start();
        })); dialog.show();
    }
    private void syncNow() {
        toast("Синхронизирую с общей базой…");
        new Thread(() -> { try { boolean more = SyncEngine.sync(this); if (more) SyncJobs.queue(this); runOnUiThread(() -> { if (!isFinishing()) { render(); toast("Общая база обновлена"); } }); }
            catch (Exception error) { runOnUiThread(() -> { if (!isFinishing()) { render(); toast("Нет связи с ПК. Локальные операции сохранены."); } }); } }, "rhythm-sync-now").start();
    }
    private void unchanged(JSONObject row) {
        JSONObject current = store.find(row.optString("id"));
        if (current.optLong("local_revision") != row.optLong("local_revision") || current.optLong("server_version") != row.optLong("server_version")) throw new IllegalArgumentException("Операция изменилась. Сохрани свой текст и открой карточку заново.");
    }
    private void allowPromptNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 20);
            return;
        }
        Intent settings = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
        settings.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()); settings.putExtra(Settings.EXTRA_CHANNEL_ID, PaymentPrompts.CHANNEL);
        try { startActivity(settings); } catch (RuntimeException error) { openSettings(Settings.ACTION_SETTINGS); }
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        render();
    }
    private void purpose(JSONObject entry) {
        JSONObject row = store.find(entry.optString("id"));
        if (!PaymentPrompts.needsAnswer(row) && (row.optString("purpose", "").isEmpty() || !row.optString("state").equals("recorded"))) {
            edit(row); return;
        }
        ScrollView scroll = new ScrollView(this); LinearLayout fields = vertical(); fields.setPadding(dp(20), dp(12), dp(20), dp(12)); scroll.addView(fields);
        heading(fields, Formats.displayAmount(row.optLong("amount_minor")) + " " + row.optString("currency"), 24);
        label(fields, row.optString("merchant", row.optString("source_name")), 15);
        label(fields, "Выбери категорию или напиши коротко. Например: обед, продукты на неделю, такси домой.", 14);
        EditText answer = input(fields, "На что?", row.optString("purpose", ""), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("На что потратил?").setView(scroll).setPositiveButton("Сохранить", null).setNegativeButton("Позже", null).create();
        for (int start = 0; start < PurposeRules.CHOICES.length; start += 2) {
            LinearLayout choices = new LinearLayout(this); choices.setOrientation(LinearLayout.HORIZONTAL); fields.addView(choices);
            for (int index = start; index < Math.min(start + 2, PurposeRules.CHOICES.length); index++) {
                String choice = PurposeRules.CHOICES[index];
                Button button = new Button(this); button.setText(choice); UIStyles.button(button, false);
                choices.addView(button, new LinearLayout.LayoutParams(0, -2, 1));
                button.setOnClickListener(v -> {
                    try { store.savePurpose(row.optString("id"), choice); dialog.dismiss(); render(); }
                    catch (RuntimeException error) { toast(error.getMessage()); }
                });
            }
        }
        dialog.setOnShowListener(v -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            try { store.savePurpose(row.optString("id"), answer.getText().toString()); dialog.dismiss(); render(); }
            catch (RuntimeException error) { toast(error.getMessage()); }
        })); dialog.show();
    }
    private void chooseApps() {
        Intent launcher = new Intent(Intent.ACTION_MAIN); launcher.addCategory(Intent.CATEGORY_LAUNCHER);
        Map<String, String> available = new LinkedHashMap<>();
        for (ResolveInfo item : getPackageManager().queryIntentActivities(launcher, 0)) {
            String packageName = item.activityInfo.packageName;
            if (!packageName.equals(getPackageName())) available.put(packageName, item.loadLabel(getPackageManager()).toString());
        }
        List<Map.Entry<String, String>> items = new ArrayList<>(available.entrySet());
        items.sort(Comparator.comparingInt((Map.Entry<String, String> e) -> bankCandidate(e.getValue()) ? 0 : 1).thenComparing(e -> e.getValue().toLowerCase(Locale.ROOT)));
        Set<String> selected = CollectorConfig.apps(this);
        String[] labels = new String[items.size()]; boolean[] checked = new boolean[items.size()];
        for (int i = 0; i < items.size(); i++) { labels[i] = items.get(i).getValue(); checked[i] = selected.contains(items.get(i).getKey()); }
        new AlertDialog.Builder(this).setTitle("Выбери банковские приложения")
            .setMultiChoiceItems(labels, checked, (dialog, which, value) -> checked[which] = value)
            .setPositiveButton("Сохранить", (dialog, which) -> {
                Set<String> result = new HashSet<>(); for (int i = 0; i < items.size(); i++) if (checked[i]) result.add(items.get(i).getKey());
                CollectorConfig.prefs(this).edit().putStringSet("apps", result).apply(); BankNotifications.refresh(this); render();
            }).setNegativeButton("Отмена", null).show();
    }
    private boolean bankCandidate(String label) { return label.toLowerCase(Locale.ROOT).matches(".*(uzum|payme|ipak|ипак).*"); }
    private void configureSms() {
        LinearLayout content = vertical(); content.setPadding(dp(20), dp(10), dp(20), dp(10));
        label(content, "Впиши точные имена банковских SMS-отправителей, по одному на строку. Имя видно в приложении SMS. Другие отправители не сохраняются. Старые SMS автоматически не читаются.", 14);
        EditText senders = input(content, "Отправители", CollectorConfig.prefs(this).getString("senders", ""), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        new AlertDialog.Builder(this).setTitle("Приём банковских SMS").setView(content).setPositiveButton("Сохранить", (dialog, which) -> {
            CollectorConfig.prefs(this).edit().putString("senders", senders.getText().toString()).apply();
            if (!senders.getText().toString().trim().isEmpty() && checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS}, 10);
            render();
        }).setNegativeButton("Отмена", null).show();
    }
    private void category(JSONObject row) {
        LinearLayout content = vertical(); content.setPadding(dp(20), dp(10), dp(20), dp(10));
        label(content, "Следующие покупки у этого продавца получат выбранную категорию. Уже сохранённые покупки можно исправить отдельно.", 14);
        EditText category = input(content, "Категория", row.optString("category"), InputType.TYPE_CLASS_TEXT);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle(row.optString("merchant", "Категория")).setView(content).setPositiveButton("Сохранить", null).setNegativeButton("Отмена", null).create();
        dialog.setOnShowListener(v -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            try {
                unchanged(row);
                store.saveTransaction(row.optString("id"), Formats.amount(row.optLong("amount_minor")), row.optString("currency"), row.optString("kind"), row.optString("date"), category.getText().toString(), row.optString("description"));
                dialog.dismiss(); render();
            } catch (RuntimeException error) { toast(error.getMessage()); }
        })); dialog.show();
    }
    private void edit(JSONObject entry) {
        boolean manual = entry == null;
        JSONObject row = manual ? new JSONObject() : store.find(entry.optString("id"));
        ScrollView scroll = new ScrollView(this); LinearLayout fields = vertical(); fields.setPadding(dp(20), dp(10), dp(20), dp(10)); scroll.addView(fields);
        if (!manual) {
            label(fields, row.optString("review_reason", ""), 14);
            TextView raw = label(fields, row.optString("raw_title", "") + "\n" + row.optString("raw_fragment", ""), 13); raw.setTextIsSelectable(true);
        }
        EditText amount = input(fields, "Сумма", row.isNull("amount_minor") ? "" : Formats.amount(row.optLong("amount_minor")), InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        EditText currency = input(fields, "Валюта", row.optString("currency", "UZS"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        Spinner kind = new Spinner(this); String[] kinds = {"Выбери назначение", "Расход", "Доход", "Перевод своих денег"};
        kind.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, kinds)); fields.addView(kind);
        String previousKind = row.optString("kind", manual ? "expense" : "unknown");
        kind.setSelection(previousKind.equals("expense") ? 1 : previousKind.equals("income") ? 2 : previousKind.equals("transfer") ? 3 : 0);
        EditText date = input(fields, "Дата YYYY-MM-DD", row.optString("date", Formats.date(System.currentTimeMillis())), InputType.TYPE_CLASS_TEXT);
        EditText category = input(fields, "Категория", row.optString("category", ""), InputType.TYPE_CLASS_TEXT);
        EditText description = input(fields, "Описание / магазин", row.optString("description", ""), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        AlertDialog.Builder builder = new AlertDialog.Builder(this).setTitle(manual ? "Добавить операцию" : "Проверить операцию").setView(scroll).setPositiveButton("Сохранить", null).setNegativeButton("Отмена", null);
        if (!manual) builder.setNeutralButton("Не учитывать", (dialog, which) -> { store.ignore(row.optString("id")); render(); });
        AlertDialog dialog = builder.create();
        dialog.setOnShowListener(v -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            try {
                int selected = kind.getSelectedItemPosition(); if (selected == 0) throw new IllegalArgumentException("Выбери: расход, доход или перевод своих денег.");
                String type = new String[]{"", "expense", "income", "transfer"}[selected];
                if (manual) store.manual(amount.getText().toString(), currency.getText().toString(), type, date.getText().toString(), category.getText().toString(), description.getText().toString());
                else { unchanged(row); store.saveTransaction(row.optString("id"), amount.getText().toString(), currency.getText().toString(), type, date.getText().toString(), category.getText().toString(), description.getText().toString()); }
                dialog.dismiss(); render();
            } catch (RuntimeException error) { toast(error.getMessage()); }
        })); dialog.show();
    }
    private void export(boolean raw) {
        if (exporting) { toast("Экспорт ещё готовится."); return; }
        exporting=true; toast("Готовлю экспорт всей истории…");
        new Thread(() -> { try {
            File folder = new File(getCacheDir(), "exports"); if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("Не удалось создать экспорт.");
            String name = (raw ? "notifications-" : "transactions-") + System.currentTimeMillis() + (raw ? ".json" : ".csv");
            try (EventStore exportStore=new EventStore(getApplicationContext())) { exportStore.exportFile(new File(folder,name),raw); }
            Uri uri = Uri.parse("content://uz.rhythm.money.exports/" + name);
            Intent share = new Intent(Intent.ACTION_SEND); share.setType(raw ? "application/json" : "text/csv"); share.putExtra(Intent.EXTRA_STREAM, uri);
            share.setClipData(ClipData.newRawUri("Экспорт", uri)); share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            runOnUiThread(() -> { exporting=false; if (!isFinishing()) startActivity(Intent.createChooser(share, raw ? "Резервная копия содержит исходные сообщения" : "Сохранить операции")); });
        } catch (Exception error) { runOnUiThread(() -> { exporting=false; toast("Не удалось экспортировать: " + error.getMessage()); }); }
        },"finance-export").start();
    }
    private void breakdown(LinearLayout target, String title, Map<String, Long> sums) {
        if (sums.isEmpty()) return;
        LinearLayout box = card(target); heading(box, title, 20);
        List<Map.Entry<String, Long>> entries = new ArrayList<>(sums.entrySet());
        entries.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
        for (Map.Entry<String, Long> item : entries) label(box, item.getKey() + "\n" + Formats.displayAmount(item.getValue()), 15);
    }
    private void add(Map<String, Long> sums, String key, long value) { Long old = sums.get(key); sums.put(key, (old == null ? 0 : old) + value); }
    private boolean notificationAccess() {
        String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        if (enabled == null) return false;
        ComponentName listener = new ComponentName(this, BankNotifications.class);
        for (String value : enabled.split(":")) if (listener.equals(ComponentName.unflattenFromString(value))) return true;
        return false;
    }
    private void openSettings(String action) { try { startActivity(new Intent(action)); } catch (Exception error) { toast("Открой настройки телефона и найди «Доступ к уведомлениям»."); } }
    private String kindLabel(String kind) { return kind.equals("expense") ? "Расход" : kind.equals("income") ? "Доход" : "Перемещение денег"; }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private LinearLayout vertical() { LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); return view; }
    private LinearLayout card(LinearLayout parent) {
        LinearLayout box = vertical(); box.setPadding(dp(20), dp(18), dp(20), dp(18));
        box.setBackground(UIStyles.rounded(this, Color.WHITE, 20, true));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.setMargins(0, dp(12), 0, dp(12)); parent.addView(box, params); return box;
    }
    private TextView label(LinearLayout parent, String text, int size) { TextView view = new TextView(this); view.setText(text); UIStyles.text(view, size); view.setPadding(0, dp(5), 0, dp(7)); parent.addView(view); return view; }
    private void heading(LinearLayout parent, String text, int size) { label(parent, text, size).setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL)); }
    private void button(LinearLayout parent, String text, Runnable action) { Button button = new Button(this); button.setText(text); UIStyles.button(button, text.equals("Мои дашборды") || text.equals("Добавить поступление")); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.setMargins(0, dp(5), 0, dp(5)); parent.addView(button, params); button.setOnClickListener(v -> action.run()); }
    private EditText input(LinearLayout parent, String title, String value, int type) { label(parent, title, 12); EditText input = new EditText(this); input.setInputType(type); input.setText(value); UIStyles.input(input); parent.addView(input, new LinearLayout.LayoutParams(-1, -2)); return input; }
    private void toast(String message) { Toast.makeText(this, message == null ? "Не удалось выполнить действие." : message, Toast.LENGTH_LONG).show(); }
}
