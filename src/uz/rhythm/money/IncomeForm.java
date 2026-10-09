package uz.rhythm.money;

import android.app.DatePickerDialog;
import android.content.Context;
import android.text.InputType;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import java.time.LocalDate;

final class IncomeForm extends LinearLayout {
    private final String cycle, token;
    private final Runnable done;
    private final EditText amount, other;
    private final Spinner currency, type;
    private final TextView error;
    private final Button date;
    private LocalDate selectedDate = LocalDate.now(Formats.ZONE);
    private DatePickerDialog calendar;
    IncomeForm(Context context, String cycle, String token, Runnable done) {
        super(context); this.cycle = cycle; this.token = token; this.done = done;
        setOrientation(VERTICAL); setPadding(dp(20), dp(20), dp(20), dp(20));
        UIStyles.identity(this);
        label("Поступление · заработок", 22);
        if (cycle != null) label("Вопрос за " + cycle + ". Сколько нового заработка ещё не записано? 0 — новых поступлений нет.", 14);
        else label("Запиши заработок, которого ещё нет в таблице. Перевод между своими картами добавляй как перевод.", 14);
        amount = field("Сумма", "", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        currency = selection(new String[]{"UZS", "USD", "EUR"}, "Валюта");
        currency.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            public void onNothingSelected(android.widget.AdapterView<?> parent) { }
            public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) { amount.setHint("Сумма в " + currency.getSelectedItem()); }
        });
        label("Тип поступления", 14);
        type = selection(IncomeTypes.CHOICES, "Тип поступления");
        other = field("Какой источник поступления?", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        other.setVisibility(GONE);
        type.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            public void onNothingSelected(android.widget.AdapterView<?> parent) { }
            public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                other.setVisibility(position == IncomeTypes.OTHER ? VISIBLE : GONE);
                if (position != IncomeTypes.OTHER && other.hasFocus()) { other.clearFocus(); hideKeyboard(); }
            }
        });
        label("Дата поступления", 14);
        date = button("", false, this::pickDate);
        updateDateLabel();
        button("Сегодня", false, () -> { selectedDate = LocalDate.now(Formats.ZONE); updateDateLabel(); hideKeyboard(); });
        error = label("", 14); error.setTextColor(0xffb42318); error.setVisibility(GONE);
        Button save = button("Сохранить", true, () -> { });
        save.setOnClickListener(v -> {
            save.setEnabled(false);
            try {
                String value = amount.getText().toString();
                long minor = IncomeReminderRules.amount(value, cycle != null);
                String source = minor == 0 ? "" : IncomeTypes.source(type.getSelectedItemPosition(), other.getText().toString());
                String id = IncomeReminders.save(context, token, cycle, value, currency.getSelectedItem().toString(), selectedDate.toString(), source);
                Toast.makeText(context, id.isEmpty() ? "Ответ принят: новых поступлений нет" : "Поступление сохранено · отправится в общую таблицу", Toast.LENGTH_LONG).show();
                PromptOverlay.dismissAnsweredIncome(cycle); done.run();
            } catch (RuntimeException failure) { showError(failure); save.setEnabled(true); }
        });
        if (cycle != null) button("Отложить до даты", false, () -> {
            hideKeyboard(); closeCalendar();
            calendar = IncomeCalendar.open(context, LocalDate.now(Formats.ZONE).plusDays(1), true, chosen -> {
                try {
                    IncomeReminders.snooze(context, cycle, chosen.toString());
                    Toast.makeText(context, "Отложено до " + IncomeCalendar.display(chosen), Toast.LENGTH_LONG).show(); PromptOverlay.dismissAnsweredIncome(cycle); done.run();
                } catch (RuntimeException failure) { showError(failure); }
            }, () -> calendar = null);
        });
        button(cycle == null ? "Отмена" : "Закрыть · напомнить позже", false, done);
    }
    private void updateDateLabel() { date.setText(IncomeCalendar.display(selectedDate) + "  ·  Выбрать"); }
    private void pickDate() {
        hideKeyboard(); closeCalendar();
        calendar = IncomeCalendar.open(getContext(), selectedDate, false, chosen -> { selectedDate = chosen; updateDateLabel(); }, () -> calendar = null);
    }
    private void hideKeyboard() { getContext().getSystemService(InputMethodManager.class).hideSoftInputFromWindow(getWindowToken(), 0); }
    private void closeCalendar() { if (calendar != null) { DatePickerDialog current = calendar; calendar = null; current.dismiss(); } }
    @Override protected void onDetachedFromWindow() { closeCalendar(); super.onDetachedFromWindow(); }
    private int dp(int n) { return UIStyles.dp(getContext(), n); }
    private void showError(RuntimeException failure) { error.setText(failure.getMessage() == null ? "Не удалось сохранить. Попробуй ещё раз." : failure.getMessage()); error.setVisibility(VISIBLE); }
    private TextView label(String text, int size) {
        TextView view = new TextView(getContext()); view.setText(text); UIStyles.text(view, size); view.setPadding(0, dp(8), 0, dp(8)); addView(view); return view;
    }
    private EditText field(String hint, String value, int inputType) {
        EditText view = new EditText(getContext()); view.setHint(hint); view.setText(value); view.setSingleLine(true); view.setInputType(inputType); UIStyles.input(view);
        LayoutParams layout = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT); layout.bottomMargin = dp(8); addView(view, layout); return view;
    }
    private Spinner selection(String[] choices, String description) {
        Spinner view = new Spinner(getContext()); view.setAdapter(new ArrayAdapter<String>(getContext(), android.R.layout.simple_spinner_dropdown_item, choices));
        view.setContentDescription(description); view.setMinimumHeight(dp(48)); view.setBackground(UIStyles.rounded(getContext(), android.graphics.Color.WHITE, 10, true));
        LayoutParams layout = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT); layout.bottomMargin = dp(8); addView(view, layout); return view;
    }
    private Button button(String text, boolean primary, Runnable action) {
        Button button = new Button(getContext()); button.setText(text); UIStyles.button(button, primary);
        LayoutParams layout = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT); layout.topMargin = dp(8); addView(button, layout); button.setOnClickListener(v -> action.run()); return button;
    }
    void saveState(android.os.Bundle state) {
        state.putString("income-amount", amount.getText().toString()); state.putString("income-other", other.getText().toString()); state.putInt("income-type", type.getSelectedItemPosition());
        state.putString("income-date", selectedDate.toString()); state.putInt("income-currency", currency.getSelectedItemPosition());
    }
    void restoreState(android.os.Bundle state) {
        if (state == null) return;
        amount.setText(state.getString("income-amount", ""));
        if (state.containsKey("income-type")) { type.setSelection(state.getInt("income-type", 0)); other.setText(state.getString("income-other", "")); }
        else {
            String previous = state.getString("income-source", ""); int selection = IncomeTypes.selection(previous);
            type.setSelection(selection); if (selection == IncomeTypes.OTHER) other.setText(previous);
        }
        try { selectedDate = LocalDate.parse(state.getString("income-date", selectedDate.toString())); } catch (RuntimeException ignored) { }
        updateDateLabel(); currency.setSelection(state.getInt("income-currency", 0));
    }
}
