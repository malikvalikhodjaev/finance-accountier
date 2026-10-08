package uz.rhythm.money;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

public final class BankSms extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;
        String sender = messages[0].getOriginatingAddress();
        if (!CollectorConfig.acceptsSender(context, sender)) return;
        StringBuilder text = new StringBuilder();
        for (SmsMessage message : messages) {
            if (!sender.equals(message.getOriginatingAddress())) return;
            if (message.getMessageBody() != null) text.append(message.getMessageBody());
        }
        try (EventStore store = new EventStore(context)) {
            store.capture("sms", sender, sender, sender, messages[0].getTimestampMillis(), sender, text.toString());
        } catch (RuntimeException error) {
            CollectorConfig.prefs(context).edit().putString("lastError", "Не удалось сохранить SMS. Проверь свободное место.").apply();
        }
    }
}
