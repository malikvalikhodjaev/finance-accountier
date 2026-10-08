package uz.rhythm.money;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.text.InputType;
import org.json.JSONObject;

public final class ImportActivity extends Activity {
    private LinearLayout page;
    private String selected, status = "";
    private boolean busy;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.WHITE); getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (state != null) { selected = state.getString("selected"); status = state.getString("status", ""); }
        render();
        if (state == null && Intent.ACTION_SEND.equals(getIntent().getAction())) {
            busy = true; status = "Сохраняю исходный файл на телефоне…"; render();
            new Thread(() -> { try {
                String id = StatementInbox.receive(this, getIntent());
                runOnUiThread(() -> { selected = id; busy = false; status = "Файл сохранён на телефоне."; render(); if (!isFinishing()) chooseSource(id); });
            } catch (Exception error) { runOnUiThread(() -> { busy = false; status = "Не удалось принять выписку: " + error.getMessage(); render(); }); } }, "rhythm-receive-pdf").start();
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); state.putString("selected", selected); state.putString("status", status); }
    private void render() {
        if (isFinishing() || isDestroyed()) return;
        ScrollView scroll = new ScrollView(this); page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setPadding(28, 28, 28, 28); page.setBackgroundColor(Color.WHITE); scroll.addView(page);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> { page.setPadding(28, 28 + insets.getSystemWindowInsetTop(), 28, 28 + insets.getSystemWindowInsetBottom()); return insets; }); setContentView(scroll);
        text("Выписки", 26);
        text("Отправь PDF банка или Excel Payme через «Поделиться → Ритм · деньги». Поддерживаются выписка Uzum на английском, история Ipak Yuli и XLSX Payme. Выбери источник, затем проверь операции.", 16);
        if (!status.isEmpty()) text(status, 16);
        if (busy) text("Подожди завершения. Операции ещё не добавляются в таблицу.", 14);
        boolean found = false;
        for (JSONObject item : StatementInbox.list(this)) {
            String id = item.optString("id"); if (id.equals(selected)) found = true;
            text(item.optString("filename"), 19);
            text(item.has("importId") ? "Файл сохранён на ПК. Можно продолжить проверку." : "Файл сохранён на телефоне. Для проверки нужен домашний ПК и Wi-Fi.", 14);
            action(item.has("importId") ? "Продолжить проверку" : "Отправить на проверку", () -> { selected = id; if (item.has("importId")) upload(); else chooseSource(id); });
            action("Убрать копию из Ритма", () -> new AlertDialog.Builder(this).setMessage("Убрать только сохранённую копию из Ритма? Исходный файл и операции в общей базе сохранятся.").setNegativeButton("Оставить", null).setPositiveButton("Убрать", (dialog, which) -> { try { StatementInbox.remove(this, id); if (id.equals(selected)) selected = null; status = "Копия убрана из Ритма."; } catch (RuntimeException error) { status = error.getMessage(); } render(); }).show());
        }
        if (selected != null && !found) selected = null;
        if (StatementInbox.list(this).isEmpty() && !busy) text("Полученных выписок пока нет.", 16);
        action("К сборщику", () -> { startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)); finish(); }, true);
    }
    private void text(String value, int size) { TextView label = new TextView(this); label.setText(value); label.setTextSize(size); label.setTextColor(Color.rgb(27,42,36)); label.setPadding(8,18,8,18); page.addView(label); }
    private void action(String label, Runnable action) { action(label, action, false); }
    private void action(String label, Runnable action, boolean always) { Button button = new Button(this); button.setText(label); button.setAllCaps(false); button.setEnabled(always || !busy); button.setOnClickListener(view -> { try { action.run(); } catch (RuntimeException error) { status = error.getMessage(); render(); } }); page.addView(button); }
    private void chooseSource(String id) {
        LinearLayout fields = new LinearLayout(this); fields.setOrientation(LinearLayout.VERTICAL); fields.setPadding(28, 16, 28, 16);
        Spinner bank = new Spinner(this); bank.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{"Uzum Bank · выписка на английском", "Ipak Yuli · история", "Payme · Excel"})); fields.addView(bank);
        EditText card = new EditText(this); card.setHint("Свои карты: последние 4 цифры через запятую"); card.setInputType(InputType.TYPE_CLASS_TEXT); card.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(120)}); fields.addView(card);
        for (JSONObject saved : StatementInbox.list(this)) if (id.equals(saved.optString("id"))) { bank.setSelection(saved.optString("bank").equals("payme") ? 2 : saved.optString("bank").equals("ipak") ? 1 : 0); card.setText(saved.optString("cardSuffix")); }
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Источник выписки").setView(fields).setNegativeButton("Позже", null).setPositiveButton("Проверить", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try { StatementInbox.options(this, id, bank.getSelectedItemPosition() == 2 ? "payme" : bank.getSelectedItemPosition() == 1 ? "ipak" : "uzum", card.getText().toString().trim()); selected = id; dialog.dismiss(); upload(); }
            catch (Exception error) { card.setError(error.getMessage()); }
        })); dialog.show();
    }
    private void upload() {
        if (busy || selected == null) return;
        String id = selected; busy = true; status = "Передаю файл в общую базу для проверки…"; render();
        new Thread(() -> { try {
            JSONObject preview = StatementInbox.prepare(this, id);
            boolean committed = preview.optBoolean("committed"); if (committed) StatementInbox.remove(this, id);
            runOnUiThread(() -> {
                busy = false; status = committed ? "Эта выписка уже добавлена в общую базу." : "Файл сохранён на ПК. Проверь операции перед добавлением."; render();
                if (isFinishing() || isDestroyed()) return;
                Intent web = new Intent(this, WebActivity.class); web.putExtra("tab", "table"); if (!committed) web.putExtra("importId", preview.optString("id")); startActivityForResult(web, 94);
            });
        } catch (Exception error) { runOnUiThread(() -> { busy = false; status = "Файл сохранён на телефоне. " + error.getMessage() + "\nКогда ПК будет доступен, нажми «Отправить на проверку» или «Продолжить проверку»."; render(); }); } }, "rhythm-upload-pdf").start();
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 94 && selected != null && !busy) {
            String id = selected; busy = true; render();
            new Thread(() -> { boolean committed = false; try { committed = StatementInbox.prepare(this, id).optBoolean("committed"); if (committed) StatementInbox.remove(this, id); } catch (Exception ignored) { /* The local copy remains available for retry. */ }
                boolean done = committed; runOnUiThread(() -> { busy = false; if (done) { selected = null; status = "Выписка добавлена. Операции доступны в общей таблице."; } else status = "Файл сохранён. Проверку можно продолжить позже."; render(); });
            }, "rhythm-check-import").start();
        }
    }
}
