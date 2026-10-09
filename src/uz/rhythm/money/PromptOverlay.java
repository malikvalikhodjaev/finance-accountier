package uz.rhythm.money;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/** A real TYPE_APPLICATION_OVERLAY; it never launches the activity in the background. */
final class PromptOverlay {
    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static View window;
    private static Context owner;
    private static String currentPayment, currentIncome, waitingIncome;
    private static boolean test;
    private PromptOverlay() {}
    static boolean allowed(Context context) { return Settings.canDrawOverlays(context); }
    static boolean visible() { return window != null && window.isAttachedToWindow(); }
    private static Set<String> queue(Context context) { return new HashSet<>(CollectorConfig.prefs(context).getStringSet("overlayPayments", new HashSet<String>())); }
    static void offerPayment(Context context, String id) {
        synchronized (PromptOverlay.class) { Set<String> pending = queue(context); pending.add(id); CollectorConfig.prefs(context).edit().putStringSet("overlayPayments", pending).commit(); }
        resume(context);
    }
    static void offerIncome(Context context, String cycle) { handler.post(() -> { waitingIncome = cycle; showNext(context.getApplicationContext()); }); }
    static void resume(Context context) { handler.post(() -> showNext(context.getApplicationContext())); }
    private static void removePayment(Context context, String id) {
        synchronized (PromptOverlay.class) { Set<String> pending = queue(context); pending.remove(id); CollectorConfig.prefs(context).edit().putStringSet("overlayPayments", pending).commit(); }
    }
    private static boolean unlocked(Context context) { return context.getSystemService(PowerManager.class).isInteractive() && !context.getSystemService(KeyguardManager.class).isKeyguardLocked(); }
    private static void showNext(Context context) {
        if (window != null || !allowed(context) || !unlocked(context)) return;
        Context themed = new ContextThemeWrapper(context, android.R.style.Theme_Material_Light_NoActionBar);
        if (CollectorConfig.prefs(context).getBoolean("askPurpose", true)) {
            JSONObject next = null;
            try (EventStore store = new EventStore(context)) {
                for (String id : queue(context)) {
                    try {
                        JSONObject row = store.find(id);
                        if (!PaymentPrompts.needsAnswer(row) || !PurposeRules.notifyNow(row.optString("source_type"), row.optString("state"), row.optString("kind"), PaymentPrompts.operation(row), row.optString("purpose"), row.optString("date"), row.optLong("event_millis"), System.currentTimeMillis())) { removePayment(context, id); continue; }
                        if (next == null || row.optLong("event_millis") < next.optLong("event_millis")) next = row;
                    } catch (RuntimeException ignored) { removePayment(context, id); }
                }
            }
            if (next != null) { currentPayment = next.optString("id"); attach(context, paymentForm(themed, next)); return; }
        }
        if (waitingIncome != null && IncomeReminders.enabled(context) && IncomeReminders.pending(context, waitingIncome)) {
            currentIncome = waitingIncome; waitingIncome = null;
            attach(context, new IncomeForm(themed, currentIncome, UUID.randomUUID().toString(), () -> dismiss(true)));
        } else waitingIncome = null;
    }
    private static LinearLayout paymentForm(Context context, JSONObject row) {
        LinearLayout form = new LinearLayout(context); form.setOrientation(LinearLayout.VERTICAL); int pad = UIStyles.dp(context, 20); form.setPadding(pad, pad, pad, pad);
        label(form, "На что потратил?", 22);
        label(form, Formats.displayAmount(row.optLong("amount_minor")) + " " + row.optString("currency"), 22);
        label(form, row.optString("merchant", row.optString("source_name")), 14);
        EditText answer = new EditText(context); answer.setHint("Обед, такси домой, свои деньги…"); answer.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES); UIStyles.input(answer); form.addView(answer);
        for (int i = 0; i < PurposeRules.CHOICES.length; i += 2) {
            LinearLayout line = new LinearLayout(context); form.addView(line);
            for (int j = i; j < Math.min(i + 2, PurposeRules.CHOICES.length); j++) {
                String choice = PurposeRules.CHOICES[j]; Button button = new Button(context); button.setText(choice); UIStyles.button(button, false);
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1); params.setMargins(0, UIStyles.dp(context, 6), UIStyles.dp(context, 4), 0); line.addView(button, params); button.setOnClickListener(v -> answer.setText(choice));
            }
        }
        TextView error = label(form, "", 14); error.setTextColor(0xffb42318);
        button(form, "Сохранить", true, () -> {
            try (EventStore store = new EventStore(context)) {
                JSONObject now = store.find(row.optString("id"));
                if (now.optLong("local_revision") != row.optLong("local_revision") || now.optLong("server_version") != row.optLong("server_version")) throw new IllegalArgumentException("Операция изменилась. Открой её карточку в приложении.");
                store.savePurpose(row.optString("id"), answer.getText().toString()); Toast.makeText(context, "Назначение сохранено", Toast.LENGTH_SHORT).show(); dismiss(true);
            } catch (RuntimeException failure) { error.setText(failure.getMessage() == null ? "Не удалось сохранить" : failure.getMessage()); }
        });
        button(form, "Позже", false, () -> dismiss(true)); return form;
    }
    static void preview(Context context) {
        handler.post(() -> {
            if (window != null) { Toast.makeText(context, "Сначала закрой текущий вопрос", Toast.LENGTH_SHORT).show(); return; }
            if (!allowed(context)) { Toast.makeText(context, "Разреши показ поверх других приложений", Toast.LENGTH_LONG).show(); return; }
            Context themed = new ContextThemeWrapper(context.getApplicationContext(), android.R.style.Theme_Material_Light_NoActionBar);
            LinearLayout form = new LinearLayout(themed); form.setOrientation(LinearLayout.VERTICAL); int pad = UIStyles.dp(themed, 20); form.setPadding(pad, pad, pad, pad);
            label(form, "Проверка всплывающего окна", 22); label(form, "Открой любое обычное приложение: это окно останется поверх него. Финансовые записи при проверке не создаются.", 16);
            button(form, "Закрыть проверку", true, () -> dismiss(true)); test = true; attach(context.getApplicationContext(), form);
        });
    }
    private static void attach(Context context, View form) {
        owner = context;
        ScrollView scroll = new ScrollView(form.getContext()) {
            @Override protected void onMeasure(int width, int height) {
                int limit = Math.min(getResources().getDisplayMetrics().heightPixels * 3 / 4, View.MeasureSpec.getSize(height));
                super.onMeasure(width, View.MeasureSpec.makeMeasureSpec(limit, View.MeasureSpec.AT_MOST));
            }
        };
        scroll.setFillViewport(false); scroll.addView(form); scroll.setBackground(UIStyles.rounded(context, android.graphics.Color.WHITE, 20, true)); scroll.setElevation(UIStyles.dp(context, 12));
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(Math.min(context.getResources().getDisplayMetrics().widthPixels - UIStyles.dp(context, 32), UIStyles.dp(context, 440)), WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL, PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.CENTER; params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        try {
            context.getSystemService(WindowManager.class).addView(scroll, params); window = scroll;
            // Android 15 requires a visible overlay before the background FGS exemption applies.
            scroll.post(() -> {
                if (window != scroll) return;
                try { context.startForegroundService(new Intent(context, PromptOverlayService.class)); }
                catch (RuntimeException failure) { CollectorConfig.prefs(context).edit().putString("promptError", "Android остановил всплывающее окно. Вопрос остался в уведомлениях.").apply(); dismiss(false); }
            });
        } catch (RuntimeException failure) { window = null; owner = null; currentPayment = null; currentIncome = null; test = false; }
    }
    static void dismiss(boolean answeredOrLater) {
        if (Looper.myLooper() != Looper.getMainLooper()) { handler.post(() -> dismiss(answeredOrLater)); return; }
        Context context = owner;
        if (context == null) return;
        if (answeredOrLater && currentPayment != null) removePayment(context, currentPayment);
        if (window != null) { try { context.getSystemService(WindowManager.class).removeViewImmediate(window); } catch (RuntimeException ignored) { } }
        window = null; owner = null; currentPayment = null; currentIncome = null; test = false;
        context.stopService(new Intent(context, PromptOverlayService.class));
        if (answeredOrLater) handler.postDelayed(() -> showNext(context), 350);
    }
    static void dismissIncome() { handler.post(() -> { waitingIncome = null; if (currentIncome != null) dismiss(true); }); }
    static void dismissAnsweredIncome(String cycle) { if (cycle == null) return; handler.post(() -> { if (cycle.equals(waitingIncome)) waitingIncome = null; if (cycle.equals(currentIncome)) dismiss(true); }); }
    static void refreshPayment(Context context, String id) {
        handler.post(() -> {
            removePayment(context, id);
            if (id.equals(currentPayment)) dismiss(true);
        });
    }
    static void paused(Context context) {
        handler.post(() -> {
            CollectorConfig.prefs(context).edit().remove("overlayPayments").apply();
            if (currentPayment != null) dismiss(true);
        });
    }
    private static TextView label(LinearLayout form, String text, int size) {
        TextView label = new TextView(form.getContext()); label.setText(text); UIStyles.text(label, size); label.setPadding(0, 0, 0, UIStyles.dp(form.getContext(), 10)); form.addView(label); return label;
    }
    private static void button(LinearLayout form, String text, boolean primary, Runnable action) {
        Button button = new Button(form.getContext()); button.setText(text); UIStyles.button(button, primary); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = UIStyles.dp(form.getContext(), 10); form.addView(button, params); button.setOnClickListener(v -> action.run());
    }
}
