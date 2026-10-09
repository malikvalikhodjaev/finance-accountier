package uz.rhythm.money;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.List;

public final class TransfersActivity extends Activity {
    private EventStore store; private LinearLayout page; private int offset;
    @Override public void onCreate(Bundle saved) { super.onCreate(saved); UIStyles.window(this); store=new EventStore(this); load(); }
    @Override public void onDestroy() { store.close(); super.onDestroy(); }
    private void load() {
        ScrollView scroll=new ScrollView(this); page=new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setBackgroundColor(UIStyles.BACKGROUND); scroll.addView(page); setContentView(scroll);
        page.setOnApplyWindowInsetsListener((view,insets) -> { page.setPadding(28,28+insets.getSystemWindowInsetTop(),28,28+insets.getSystemWindowInsetBottom()); return insets; });
        text("Переводы между моими картами",24);
        text("Возможные пары: одинаковая сумма и валюта, разные карты, время отличается не более чем на 2 минуты, с каждой стороны только одно совпадение. Проверь отправителя и получателя. Комиссия и похожие суммы автоматически не подбираются.",15);
        TextView status=text("Ищу возможные пары…",16); button("Назад",this::finish);
        new Thread(() -> {
            try {
                List<OwnTransfers.Pair> pairs=store.transferCandidates();
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    if (offset>=pairs.size()) offset=0;
                    status.setText("Возможных пар: "+pairs.size()+". Подтверждённые пары исключены из расходов и доходов; обе записи сохраняются.");
                    for (int i=offset;i<Math.min(offset+20,pairs.size());i++) {
                        OwnTransfers.Pair pair=pairs.get(i);
                        text(Formats.displayAmount(pair.outgoing.amount)+" "+pair.outgoing.currency+"\n"+pair.outgoing.date+" "+pair.outgoing.time+" · ***"+pair.outgoing.card+" → ***"+pair.incoming.card+"\nСписание: "+pair.outgoing.merchant+"\nПоступление: "+pair.incoming.merchant,17);
                        button("Подтвердить: это перевод между моими картами",() -> {
                            try { store.confirmTransfer(pair); load(); }
                            catch (RuntimeException error) { status.setText(error.getMessage()); }
                        });
                    }
                    if (pairs.isEmpty()) text("Точных пар пока нет. Переводы с комиссией, неполной историей или несколькими совпадениями остаются на проверке в общей таблице.",15);
                    if (offset>0) button("Предыдущие 20",() -> { offset=Math.max(0,offset-20); load(); });
                    if (offset+20<pairs.size()) button("Следующие 20",() -> { offset+=20; load(); });
                });
            } catch (RuntimeException error) { runOnUiThread(() -> status.setText(error.getMessage())); }
        },"own-transfer-candidates").start();
    }
    private TextView text(String value,int size) { TextView view=new TextView(this); view.setText(value); UIStyles.text(view,size); view.setPadding(0,12,0,12); page.addView(view); return view; }
    private void button(String title,Runnable action) { Button view=new Button(this); view.setText(title); UIStyles.button(view,false); LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2); params.setMargins(0,UIStyles.dp(this,5),0,UIStyles.dp(this,5)); page.addView(view,params); view.setOnClickListener(v -> action.run()); }
}
