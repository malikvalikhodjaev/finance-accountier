package uz.rhythm.money;

import android.app.Activity;
import android.app.DatePickerDialog;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.DialogInterface;
import android.view.ContextThemeWrapper;
import android.view.WindowManager;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Calendar;
import java.util.Locale;
import java.util.function.Consumer;

final class IncomeCalendar {
    private IncomeCalendar() {}
    static String display(LocalDate day) { return day.format(DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.forLanguageTag("ru-RU"))); }
    private static long deviceDay(LocalDate day) { return day.atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(); }
    private static boolean activity(Context context) {
        while (context instanceof ContextWrapper) {
            if (context instanceof Activity) return true;
            Context base = ((ContextWrapper) context).getBaseContext(); if (base == context) break; context = base;
        }
        return context instanceof Activity;
    }
    static DatePickerDialog open(Context context, LocalDate selected, boolean future, Consumer<LocalDate> answer, Runnable closed) {
        int theme = context.getResources().getIdentifier("IncomeCalendarTheme", "style", context.getPackageName());
        Context themed = new ContextThemeWrapper(context, theme);
        DatePickerDialog dialog = new DatePickerDialog(themed, (picker, year, month, day) -> answer.accept(LocalDate.of(year, month + 1, day)), selected.getYear(), selected.getMonthValue() - 1, selected.getDayOfMonth());
        dialog.setTitle(future ? "Отложить до даты" : "Дата поступления");
        dialog.getDatePicker().setFirstDayOfWeek(Calendar.MONDAY);
        if (future) dialog.getDatePicker().setMinDate(deviceDay(LocalDate.now(Formats.ZONE).plusDays(1)));
        else {
            dialog.getDatePicker().setMaxDate(deviceDay(LocalDate.now(Formats.ZONE)));
            dialog.setButton(DialogInterface.BUTTON_NEUTRAL, "Сегодня", (ignored, which) -> answer.accept(LocalDate.now(Formats.ZONE)));
        }
        dialog.setButton(DialogInterface.BUTTON_NEGATIVE, "Отмена", (ignored, which) -> dialog.cancel());
        dialog.setOnDismissListener(ignored -> closed.run());
        if (!activity(context)) dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY);
        dialog.show();
        for (int which : new int[]{DialogInterface.BUTTON_POSITIVE, DialogInterface.BUTTON_NEGATIVE, DialogInterface.BUTTON_NEUTRAL}) {
            android.widget.Button button = dialog.getButton(which);
            if (button != null) { button.setAllCaps(false); button.setTextColor(UIStyles.ACCENT); }
        }
        dialog.getButton(DialogInterface.BUTTON_POSITIVE).setText("Выбрать");
        return dialog;
    }
}
