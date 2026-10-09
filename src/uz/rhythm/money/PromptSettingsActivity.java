package uz.rhythm.money;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

public final class PromptSettingsActivity extends Activity {
    private LinearLayout page;
    @Override public void onCreate(Bundle state) { super.onCreate(state); UIStyles.window(this); IncomeReminders.initialize(this); }
    @Override public void onResume() { super.onResume(); IncomeReminders.schedule(this); render(); }
    private void render() {
        ScrollView scroll = new ScrollView(this); page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); int pad = UIStyles.dp(this, 20); page.setPadding(pad, pad, pad, pad); scroll.addView(page); setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> { scroll.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom()); return insets; });
        label("Окна и поступления", 26);
        label("Окно после оплаты", 20);
        label(PromptOverlay.allowed(this) ? "Показ поверх приложений разрешён" : "Нужно разрешить показ поверх других приложений", 16);
        label("Вопрос открывается после нового сообщения об оплате. На заблокированном экране остаётся уведомление; банковский защищённый экран может скрывать чужие окна.", 14);
        button("Разрешить поверх приложений", false, () -> settings(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))));
        button("Проверить всплывающее окно", true, () -> PromptOverlay.preview(this));
        boolean asks = CollectorConfig.prefs(this).getBoolean("askPurpose", true);
        button(asks ? "Выключить вопросы после оплаты" : "Включить вопросы после оплаты", false, () -> {
            CollectorConfig.prefs(this).edit().putBoolean("askPurpose", !asks).commit();
            if (asks) { PromptOverlay.paused(this); clearPaymentNotifications(); }
            render();
        });
        label("Поступления", 20);
        button("Добавить поступление", true, () -> startActivity(new Intent(this, IncomeActivity.class)));
        label(IncomeReminders.summary(this), 16);
        label("Одна сумма заработка, которой ещё нет в таблице. 0 закрывает вопрос без операции. Отсрочка сохраняется после перезапуска; новые даты 5-го и 20-го остаются отдельными напоминаниями.", 14);
        LinearLayout hours = new LinearLayout(this); hours.setOrientation(LinearLayout.HORIZONTAL); page.addView(hours);
        String[] starts = new String[24], ends = new String[24];
        for (int i = 0; i < 24; i++) { starts[i] = String.format(java.util.Locale.ROOT, "%02d:00", i); ends[i] = String.format(java.util.Locale.ROOT, "%02d:00", i + 1); }
        Spinner start = new Spinner(this), end = new Spinner(this);
        start.setAdapter(new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, starts)); end.setAdapter(new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, ends));
        start.setSelection(IncomeReminders.startHour(this)); end.setSelection(IncomeReminders.endHour(this) - 1);
        hours.addView(start, new LinearLayout.LayoutParams(0, -2, 1)); hours.addView(end, new LinearLayout.LayoutParams(0, -2, 1));
        button("Сохранить часы · Ташкент", false, () -> {
            try { IncomeReminders.configure(this, IncomeReminders.enabled(this), start.getSelectedItemPosition(), end.getSelectedItemPosition() + 1); render(); }
            catch (RuntimeException error) { Toast.makeText(this, error.getMessage(), Toast.LENGTH_LONG).show(); }
        });
        boolean active = IncomeReminders.enabled(this);
        button(active ? "Приостановить напоминания" : "Включить напоминания", false, () -> { IncomeReminders.configure(this, !active, IncomeReminders.startHour(this), IncomeReminders.endHour(this)); render(); });
        if (Build.VERSION.SDK_INT >= 31) {
            label(IncomeReminders.exactAllowed(this) ? "Точные напоминания разрешены" : "Для повторов каждые 10 минут нужен доступ «Будильники и напоминания». Без него Android может задерживать вопрос.", 14);
            button("Разрешить точные напоминания", false, () -> settings(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()))));
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            button("Разрешить уведомления", false, () -> requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 81));
        button("Настройки уведомлений", false, () -> settings(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())));
        long alarm = CollectorConfig.prefs(this).getLong("incomeNextAlarm", 0);
        if (active && alarm > 0) label("Следующее напоминание: " + IncomeReminders.displayTime(alarm), 14);
        String error = CollectorConfig.prefs(this).getString("incomeAlarmError", ""); if (!error.isEmpty()) label(error, 14);
        try (EventStore store = new EventStore(this); Cursor c = store.getReadableDatabase().rawQuery("SELECT cycle,due_at FROM income_reminders WHERE status='pending' ORDER BY cycle LIMIT 10", null)) {
            while (c.moveToNext()) {
                String cycle = c.getString(0); label("Вопрос за " + cycle + " · " + IncomeReminders.displayTime(c.getLong(1)), 14);
                button("Ответить или отложить · " + cycle, false, () -> startActivity(new Intent(this, IncomeActivity.class).putExtra(IncomeReminders.CYCLE_EXTRA, cycle)));
            }
        }
        button("Назад", false, this::finish);
    }
    private void clearPaymentNotifications() {
        android.app.NotificationManager manager = getSystemService(android.app.NotificationManager.class);
        for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications())
            if (notification.getTag() != null && notification.getTag().startsWith("purpose:")) manager.cancel(notification.getTag(), notification.getId());
    }
    private void settings(Intent intent) {
        try { startActivity(intent); } catch (RuntimeException error) { Toast.makeText(this, "Открой разрешения Personal Throughput Accounting в настройках телефона", Toast.LENGTH_LONG).show(); }
    }
    private void label(String text, int size) { TextView view = new TextView(this); view.setText(text); UIStyles.text(view, size); view.setPadding(0, UIStyles.dp(this, 14), 0, UIStyles.dp(this, 8)); page.addView(view); }
    private void button(String text, boolean primary, Runnable action) {
        Button button = new Button(this); button.setText(text); UIStyles.button(button, primary); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = UIStyles.dp(this, 10); page.addView(button, params); button.setOnClickListener(v -> action.run());
    }
}
