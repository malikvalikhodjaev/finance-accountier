package uz.rhythm.money;

import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

public final class PurposeReply extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        android.net.Uri data = intent.getData();
        if (data == null || !"rhythm-money".equals(data.getScheme()) || !"purpose".equals(data.getHost()) || data.getPathSegments().size() != 2) return;
        // Read identity from the pre-bound intent URI; mutable reply extras cannot redirect the answer.
        String id = data.getPathSegments().get(0);
        if (id == null || !id.matches("[a-f0-9-]{36}")) return;
        String answer = intent.getStringExtra(PaymentPrompts.QUICK_EXTRA);
        Bundle remote = RemoteInput.getResultsFromIntent(intent);
        if (remote != null) {
            CharSequence text = remote.getCharSequence(PaymentPrompts.REPLY_KEY);
            if (text != null) answer = text.toString();
        }
        try (EventStore store = new EventStore(context)) {
            store.savePurpose(id, answer);
            PaymentPrompts.cancel(context, id);
            Toast.makeText(context, "Назначение сохранено", Toast.LENGTH_SHORT).show();
        } catch (RuntimeException error) {
            Toast.makeText(context, error.getMessage() == null ? "Не удалось сохранить. Открой операцию в приложении." : error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}
