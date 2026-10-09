package uz.rhythm.money;

import android.app.Activity;
import android.os.Bundle;
import android.widget.ScrollView;
import android.widget.Toast;
import java.util.UUID;

public final class IncomeActivity extends Activity {
    private IncomeForm form;
    private String token;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); UIStyles.window(this);
        String cycle = getIntent().getStringExtra(IncomeReminders.CYCLE_EXTRA);
        if (cycle != null && !IncomeReminders.pending(this, cycle)) { Toast.makeText(this, "На это напоминание уже ответили", Toast.LENGTH_SHORT).show(); finish(); return; }
        token = state == null ? UUID.randomUUID().toString() : state.getString("income-token", UUID.randomUUID().toString());
        form = new IncomeForm(this, cycle, token, this::finish); form.restoreState(state);
        ScrollView scroll = new ScrollView(this); scroll.addView(form); setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> { scroll.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom()); return insets; });
    }
    @Override public void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); state.putString("income-token", token); if (form != null) form.saveState(state); }
}
