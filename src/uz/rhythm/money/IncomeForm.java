package uz.rhythm.money;

import android.content.Context;
import android.text.InputType;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.DatePicker;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import java.time.LocalDate;

final class IncomeForm extends LinearLayout {
    private final String cycle, token;
    private final Runnable done;
    private final EditText amount, source, date;
    private final Spinner currency;
    private final TextView error;
    IncomeForm(Context context, String cycle, String token, Runnable done) {
        super(context); this.cycle = cycle; this.token = token; this.done = done;
        setOrientation(VERTICAL); setPadding(dp(20), dp(20), dp(20), dp(20));
        label("Поступление · заработок", 22);
        if (cycle != null) label("Вопрос за " + cycle + ". Сколько нового заработка ещё не записано? 0 — новых поступлений нет.", 14);
        else label("Запиши заработок, которого ещё нет в таблице. Перевод между своими картами добавляй как перевод.", 14);
        amount = field(this, "Сумма в UZS", "", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        error = label("", 14); error.setTextColor(0xffb42318); error.setVisibility(GONE);
        LinearLayout details = new LinearLayout(context); details.setOrientation(VERTICAL); addView(details); details.setVisibility(GONE);
        button(this, "Дата, валюта и источник", false, () -> { details.setVisibility(details.getVisibility() == GONE ? VISIBLE : GONE); });
        source = field(details, "Источник: зарплата, проект… (необязательно)", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        date = field(details, "Дата поступления · YYYY-MM-DD", Formats.date(System.currentTimeMillis()), InputType.TYPE_CLASS_DATETIME | InputType.TYPE_DATETIME_VARIATION_DATE);
        currency = new Spinner(context); currency.setAdapter(new ArrayAdapter<String>(context, android.R.layout.simple_spinner_dropdown_item, new String[]{"UZS", "USD", "EUR"})); details.addView(currency);
        currency.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            public void onNothingSelected(android.widget.AdapterView<?> parent) { }
            public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) { amount.setHint("Сумма в " + currency.getSelectedItem()); }
        });
        Button save = button(this, "Сохранить", true, () -> { });
        save.setOnClickListener(v -> {
            save.setEnabled(false);
            try {
                String id = IncomeReminders.save(context, token, cycle, amount.getText().toString(), currency.getSelectedItem().toString(), date.getText().toString(), source.getText().toString());
                Toast.makeText(context, id.isEmpty() ? "Ответ принят: новых поступлений нет" : "Поступление сохранено · отправится в общую таблицу", Toast.LENGTH_LONG).show();
                PromptOverlay.dismissAnsweredIncome(cycle); done.run();
            } catch (RuntimeException failure) { showError(failure); save.setEnabled(true); }
        });
        if (cycle != null) {
            LinearLayout postponement = new LinearLayout(context); postponement.setOrientation(VERTICAL); addView(postponement); postponement.setVisibility(GONE);
            button(this, "Отложить до даты", false, () -> { postponement.setVisibility(postponement.getVisibility() == GONE ? VISIBLE : GONE); });
            label(postponement, "Напоминание вернётся в " + String.format(java.util.Locale.ROOT, "%02d:00", IncomeReminders.startHour(context)) + " по Ташкенту. Другие даты 5-го и 20-го сохраняются.", 14);
            DatePicker picker = new DatePicker(context); LocalDate tomorrow = LocalDate.now(Formats.ZONE).plusDays(1);
            picker.init(tomorrow.getYear(), tomorrow.getMonthValue() - 1, tomorrow.getDayOfMonth(), null); postponement.addView(picker);
            button(postponement, "Отложить", true, () -> {
                try {
                    String chosen = LocalDate.of(picker.getYear(), picker.getMonth() + 1, picker.getDayOfMonth()).toString();
                    IncomeReminders.snooze(context, cycle, chosen);
                    Toast.makeText(context, "Отложено до " + chosen, Toast.LENGTH_LONG).show(); PromptOverlay.dismissAnsweredIncome(cycle); done.run();
                } catch (RuntimeException failure) { showError(failure); }
            });
        }
        button(this, cycle == null ? "Отмена" : "Закрыть · напомнить позже", false, done);
    }
    private int dp(int n) { return UIStyles.dp(getContext(), n); }
    private void showError(RuntimeException failure) { error.setText(failure.getMessage() == null ? "Не удалось сохранить. Попробуй ещё раз." : failure.getMessage()); error.setVisibility(VISIBLE); }
    private TextView label(String text, int size) { return label(this, text, size); }
    private TextView label(LinearLayout parent, String text, int size) {
        TextView view = new TextView(getContext()); view.setText(text); UIStyles.text(view, size); view.setPadding(0, 0, 0, dp(12)); parent.addView(view); return view;
    }
    private EditText field(LinearLayout parent, String hint, String value, int type) {
        EditText view = new EditText(getContext()); view.setHint(hint); view.setText(value); view.setSingleLine(true); view.setInputType(type); UIStyles.input(view);
        LayoutParams layout = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT); layout.bottomMargin = dp(10); parent.addView(view, layout); return view;
    }
    private Button button(LinearLayout parent, String text, boolean primary, Runnable action) {
        Button button = new Button(getContext()); button.setText(text); UIStyles.button(button, primary);
        LayoutParams layout = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT); layout.topMargin = dp(8); parent.addView(button, layout); button.setOnClickListener(v -> action.run()); return button;
    }
    void saveState(android.os.Bundle state) {
        state.putString("income-amount", amount.getText().toString()); state.putString("income-source", source.getText().toString());
        state.putString("income-date", date.getText().toString()); state.putInt("income-currency", currency.getSelectedItemPosition());
    }
    void restoreState(android.os.Bundle state) {
        if (state == null) return;
        amount.setText(state.getString("income-amount", "")); source.setText(state.getString("income-source", ""));
        date.setText(state.getString("income-date", Formats.date(System.currentTimeMillis()))); currency.setSelection(state.getInt("income-currency", 0));
    }
}
