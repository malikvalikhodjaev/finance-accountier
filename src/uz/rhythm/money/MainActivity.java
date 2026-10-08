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
import android.graphics.drawable.GradientDrawable;
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
    private Boolean expandSetup;
    private int topInset, bottomInset;
    private final int ink = Color.rgb(27, 42, 36), green = Color.rgb(22, 100, 79);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        store = new EventStore(this);
        PaymentPrompts.ensureChannel(this);
        getWindow().setStatusBarColor(Color.rgb(244, 247, 244));
        getWindow().setNavigationBarColor(Color.rgb(244, 247, 244));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        acceptShared(getIntent());
        render();
        openPurposeIntent(getIntent());
    }
    @Override public void onResume() { super.onResume(); if (store != null) render(); }
    @Override public void onDestroy() { if (store != null) store.close(); super.onDestroy(); }
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
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true); scroll.setBackgroundColor(Color.rgb(244, 247, 244));
        page = vertical(); page.setPadding(dp(20), dp(20) + topInset, dp(20), dp(24) + bottomInset);
        scroll.addView(page);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            topInset = insets.getSystemWindowInsetTop(); bottomInset = insets.getSystemWindowInsetBottom();
            page.setPadding(dp(20), dp(20) + topInset, dp(20), dp(24) + bottomInset);
            return insets;
        });
        setContentView(scroll);
        heading(page, "Деньги", 30);
        label(page, "После оплаты — короткий вопрос «На что?». Сумма и магазин уже записаны.", 15);
        LinearLayout setup = card(page);
        boolean access = notificationAccess(), enabled = CollectorConfig.enabled(this);
        heading(setup, enabled ? "Сбор включён" : "Сбор на паузе", 18);
        label(setup, "Приложений выбрано: " + CollectorConfig.apps(this).size() + " · Доступ к уведомлениям: " + (access ? "есть" : "нужен"), 13);
        boolean smsReady = !CollectorConfig.prefs(this).getString("senders", "").trim().isEmpty() && checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
        label(setup, "Приём SMS: " + (smsReady ? "настроен" : "не настроен"), 13);
        boolean ready = smsReady || (access && !CollectorConfig.apps(this).isEmpty());
        boolean asks = CollectorConfig.prefs(this).getBoolean("askPurpose", true);
        boolean promptsAllowed = PaymentPrompts.allowed(this);
        label(setup, "«На что потратил?»: " + (!asks ? "выключено" : promptsAllowed ? "включено" : "нужно разрешить уведомления"), 13);
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
                if (asks) getSystemService(android.app.NotificationManager.class).cancelAll();
                else if (!PaymentPrompts.allowed(this)) allowPromptNotifications();
                render();
            });
            button(setup, enabled ? "Поставить сбор на паузу" : "Возобновить сбор", () -> { CollectorConfig.prefs(this).edit().putBoolean("enabled", !enabled).apply(); render(); });
        }
        String error = CollectorConfig.prefs(this).getString("lastError", "");
        if (!error.isEmpty()) label(setup, error, 13);
        String promptError = CollectorConfig.prefs(this).getString("promptError", "");
        if (!promptError.isEmpty() && !promptsAllowed && asks) label(setup, promptError, 13);
        List<JSONObject> all = store.all();
        int pending = 0, duplicates = 0, categories = 0, unanswered = 0;
        for (JSONObject row : all) {
            if (row.optString("state").equals("review")) pending++;
            if (row.optString("state").equals("duplicate")) duplicates++;
            if (row.optString("state").equals("recorded") && row.optString("kind").equals("expense") && row.optString("category").equals("Без категории")) categories++;
            if (PaymentPrompts.needsAnswer(row)) unanswered++;
        }
        label(page, "Уточнить назначение: " + pending + " · Возможные повторы: " + duplicates + " · Без категории: " + categories, 14);
        label(page, "Без ответа «На что?»: " + unanswered + ". Можно дополнить в карточке операции.", 14);
        button(page, "Добавить наличные или другую операцию", () -> edit(null));
        LinearLayout periods = new LinearLayout(this); periods.setOrientation(LinearLayout.HORIZONTAL); page.addView(periods);
        for (int days : new int[]{7, 30, 0}) {
            Button b = new Button(this); b.setText(days == 0 ? "Вся история" : days + " дней"); b.setTextColor(days == period ? green : ink);
            periods.addView(b, new LinearLayout.LayoutParams(0, dp(52), 1));
            b.setOnClickListener(v -> { period = days; render(); });
        }
        String first = period == 0 ? "0000-00-00" : LocalDate.now(Formats.ZONE).minusDays(period - 1).toString();
        Map<String, long[]> totals = new LinkedHashMap<>();
        Map<String, Long> byCategory = new LinkedHashMap<>(), byMerchant = new LinkedHashMap<>();
        for (JSONObject row : all) if (row.optString("state").equals("recorded") && row.optString("date").compareTo(first) >= 0) {
            String code = row.optString("currency"), kind = row.optString("kind");
            long amount = row.optLong("amount_minor");
            long[] sums = totals.get(code); if (sums == null) { sums = new long[3]; totals.put(code, sums); }
            sums[kind.equals("expense") ? 0 : kind.equals("income") ? 1 : 2] += amount;
            if (kind.equals("expense")) {
                add(byCategory, row.optString("category", "Без категории") + " · " + code, amount);
                String merchant = row.optString("merchant", ""); if (merchant.isEmpty()) merchant = row.optString("description", "Вручную");
                add(byMerchant, merchant + " · " + code, amount);
            }
        }
        LinearLayout summary = card(page);
        heading(summary, period == 0 ? "По всей истории" : "За " + period + " дней", 21);
        if (totals.isEmpty()) label(summary, "Нет учтённых операций за этот период.", 15);
        for (Map.Entry<String, long[]> total : totals.entrySet()) {
            heading(summary, Formats.displayAmount(total.getValue()[0]) + " " + total.getKey(), 25);
            label(summary, "Расходы · Доходы: " + Formats.displayAmount(total.getValue()[1]) + " · Перемещения денег: " + Formats.displayAmount(total.getValue()[2]), 13);
        }
        label(summary, "Это учёт по полученным сообщениям. Неясные поступления, списания и возможные повторы исключены из сумм.", 13);
        breakdown(page, "Куда уходят деньги", byCategory);
        breakdown(page, "Магазины и сервисы", byMerchant);
        heading(page, "Операции и уведомления", 21);
        button(page, showIgnored ? "Скрыть исключённые" : "Показать исключённые", () -> { showIgnored = !showIgnored; render(); });
        int shown = 0;
        for (JSONObject row : all) {
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
        button(page, "Обновить", this::render);
        button(page, "Экспорт операций в «Ритм» · CSV", () -> export(false));
        button(page, "Резервная копия с исходными сообщениями · JSON", () -> export(true));
        label(page, "Версия 0.2 · Хранение на телефоне. Ответ «На что?» относится к конкретной оплате. Автоматической отправки в Telegram пока нет.", 12);
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
                Button button = new Button(this); button.setText(choice); button.setAllCaps(false); button.setTextColor(green);
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
                CollectorConfig.prefs(this).edit().putStringSet("apps", result).apply(); render();
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
                else store.saveTransaction(row.optString("id"), amount.getText().toString(), currency.getText().toString(), type, date.getText().toString(), category.getText().toString(), description.getText().toString());
                dialog.dismiss(); render();
            } catch (RuntimeException error) { toast(error.getMessage()); }
        })); dialog.show();
    }
    private void export(boolean raw) {
        try {
            File folder = new File(getCacheDir(), "exports"); if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("Не удалось создать экспорт.");
            String name = (raw ? "notifications-" : "transactions-") + System.currentTimeMillis() + (raw ? ".json" : ".csv");
            Files.write(new File(folder, name).toPath(), (raw ? store.rawExport() : store.csvExport()).getBytes(StandardCharsets.UTF_8));
            Uri uri = Uri.parse("content://uz.rhythm.money.exports/" + name);
            Intent share = new Intent(Intent.ACTION_SEND); share.setType(raw ? "application/json" : "text/csv"); share.putExtra(Intent.EXTRA_STREAM, uri);
            share.setClipData(ClipData.newRawUri("Экспорт", uri)); share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(share, raw ? "Резервная копия содержит исходные сообщения" : "Сохранить операции"));
        } catch (Exception error) { toast("Не удалось экспортировать: " + error.getMessage()); }
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
        LinearLayout box = vertical(); box.setPadding(dp(16), dp(12), dp(16), dp(14));
        GradientDrawable background = new GradientDrawable(); background.setColor(Color.WHITE); background.setCornerRadius(dp(16)); box.setBackground(background);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.setMargins(0, dp(12), 0, dp(12)); parent.addView(box, params); return box;
    }
    private TextView label(LinearLayout parent, String text, int size) { TextView view = new TextView(this); view.setText(text); view.setTextColor(ink); view.setTextSize(size); view.setPadding(0, dp(5), 0, dp(7)); parent.addView(view); return view; }
    private void heading(LinearLayout parent, String text, int size) { label(parent, text, size).setTypeface(Typeface.DEFAULT, Typeface.BOLD); }
    private void button(LinearLayout parent, String text, Runnable action) { Button button = new Button(this); button.setText(text); button.setAllCaps(false); button.setTextColor(green); parent.addView(button, new LinearLayout.LayoutParams(-1, -2)); button.setOnClickListener(v -> action.run()); }
    private EditText input(LinearLayout parent, String title, String value, int type) { label(parent, title, 12); EditText input = new EditText(this); input.setInputType(type); input.setText(value); input.setTextSize(16); parent.addView(input, new LinearLayout.LayoutParams(-1, -2)); return input; }
    private void toast(String message) { Toast.makeText(this, message == null ? "Не удалось выполнить действие." : message, Toast.LENGTH_LONG).show(); }
}
