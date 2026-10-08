package uz.rhythm.money;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class HistoryActivity extends Activity {
    private final Handler handler = new Handler();
    private TextView status; private Button resume, start, pause;
    private EventStore store; private LinearLayout page; private boolean scanning;
    private final Runnable refresh = new Runnable() { public void run() { update(); handler.postDelayed(this,1000); } };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); store=new EventStore(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        ScrollView scroll=new ScrollView(this); page=new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setPadding(28,60,28,60); page.setBackgroundColor(Color.rgb(244,247,244)); scroll.addView(page); setContentView(scroll);
        page.setOnApplyWindowInsetsListener((view,insets) -> { page.setPadding(28,28+insets.getSystemWindowInsetTop(),28,28+insets.getSystemWindowInsetBottom()); return insets; });
        text("История банковских SMS",24);
        text("Импортируются входящие SMS выбранных банков. Исходный текст сохраняется без изменений. Коды подтверждения и служебные сообщения пропускаются. Старые операции не вызывают вопросы «На что?».",15);
        text("Переводы, пополнения и возможные повторы исключены из расходов до проверки. Сам факт списания с твоей карты не доказывает перевод на свою карту.",15);
        status=text("",16);
        resume=button("Продолжить импорт и синхронизацию",() -> SmsHistory.start(this,new ArrayList<>(),true));
        pause=button("Приостановить",SmsHistory::pause);
        button("Вернуться к операциям",this::finish);
        button("Проверить переводы между моими картами",() -> startActivity(new android.content.Intent(this,TransfersActivity.class)));
        if (checkSelfPermission(Manifest.permission.READ_SMS)!=PackageManager.PERMISSION_GRANTED)
            button("Разрешить чтение SMS",() -> requestPermissions(new String[]{Manifest.permission.READ_SMS},42));
        else scan();
    }
    @Override public void onResume() { super.onResume(); handler.post(refresh); }
    @Override public void onPause() { handler.removeCallbacks(refresh); super.onPause(); }
    @Override public void onDestroy() { store.close(); super.onDestroy(); }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(request,permissions,results);
        if (request==42 && results.length>0 && results[0]==PackageManager.PERMISSION_GRANTED) scan();
        else text("Без разрешения старые SMS прочитать нельзя. Новые операции и общая база продолжают работать.",15);
    }
    private void scan() {
        if (scanning) return; scanning=true;
        TextView preview=text("Считаю SMS и банковских отправителей…",15);
        new Thread(() -> {
            try {
                SmsHistory.Preview result=SmsHistory.preview(this);
                runOnUiThread(() -> {
                    preview.setText("Входящих SMS на телефоне: "+result.inbox+". Выбери источники истории:");
                    List<CheckBox> boxes=new ArrayList<>();
                    for (Map.Entry<String,Integer> sender : result.senders.entrySet()) {
                        CheckBox box=new CheckBox(this); box.setText(sender.getKey()+" · "+sender.getValue()+" SMS"); box.setTag(sender.getKey()); box.setChecked(HistoryRules.bankSender(sender.getKey())); page.addView(box); boxes.add(box);
                    }
                    text("Если банка нет в списке, укажи точное имя или номер отправителя SMS:",14);
                    EditText extra=new EditText(this); extra.setHint("Отправитель, по одному на строку"); page.addView(extra);
                    start=button("Импортировать выбранные SMS",() -> {
                        List<String> selected=new ArrayList<>();
                        for (CheckBox box : boxes) if (box.isChecked()) selected.add(box.getTag().toString());
                        for (String value : extra.getText().toString().split("[\\n,;]+")) if (!value.trim().isEmpty() && !selected.contains(value.trim())) selected.add(value.trim());
                        if (selected.isEmpty()) { preview.setText("Выбери Uzcard/Humo или укажи банковского отправителя."); return; }
                        SmsHistory.start(this,selected,false); update();
                    }); update();
                });
            } catch (Exception error) { runOnUiThread(() -> preview.setText("Не удалось прочитать список SMS: "+error.getMessage())); }
        },"sms-history-preview").start();
    }
    private void update() {
        if (store==null || isFinishing()) return;
        JSONObject state=store.historyState(); boolean running=SmsHistory.running();
        resume.setEnabled(!running && state.has("senders") && checkSelfPermission(Manifest.permission.READ_SMS)==PackageManager.PERMISSION_GRANTED);
        pause.setEnabled(running); if (start!=null) start.setEnabled(!running);
        if (!state.has("total")) { status.setText("История ещё не импортирована."); return; }
        String phase=state.optString("phase"), label=phase.equals("importing") ? running ? "Читаю историю" : "Можно продолжить после прерывания" : phase.equals("syncing") ? "Отправляю в общую базу" : phase.equals("done") ? "Импорт завершён" : "Импорт приостановлен";
        JSONObject statistics=store.statistics();
        status.setText(label+"\nSMS: "+state.optInt("scanned")+" / "+state.optInt("total")+"\nДобавлено операций: "+state.optInt("inserted")+" · Уже были: "+state.optInt("same")+"\nПропущено кодов: "+state.optInt("otp")+" · Служебных: "+state.optInt("other")+"\nВ базе: "+statistics.optInt("total")+" · Уточнить: "+statistics.optInt("review")+" · Возможные повторы: "+statistics.optInt("duplicates")+"\nОжидают отправки на ПК: "+store.pendingSync()+ (state.optString("error").isEmpty() ? "" : "\n"+state.optString("error")));
    }
    private TextView text(String value,int size) { TextView view=new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(Color.rgb(27,42,36)); view.setPadding(0,10,0,14); page.addView(view); return view; }
    private Button button(String title,Runnable action) { Button view=new Button(this); view.setText(title); view.setAllCaps(false); page.addView(view); view.setOnClickListener(v -> action.run()); return view; }
}
