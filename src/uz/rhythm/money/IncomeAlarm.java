package uz.rhythm.money;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class IncomeAlarm extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        try {
            BankNotifications.ensureConnected(context);
            if (IncomeReminders.ALARM.equals(intent.getAction())) IncomeReminders.fire(context);
            else IncomeReminders.initialize(context);
        } catch (RuntimeException error) {
            CollectorConfig.prefs(context).edit().putString("incomeAlarmError", "Не удалось обновить напоминание. Открой настройки поступлений.").apply();
        }
    }
}
