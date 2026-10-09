package uz.rhythm.money;

import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.ImageView;
import android.widget.LinearLayout;

final class UIStyles {
    static final int INK = Color.rgb(29, 29, 31);
    static final int MUTED = Color.rgb(110, 110, 115);
    static final int BACKGROUND = Color.rgb(245, 245, 247);
    static final int ACCENT = Color.rgb(0, 122, 255);
    static final int LINE = Color.rgb(229, 229, 234);

    private UIStyles() {}
    static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }
    static void window(Activity activity) {
        activity.getWindow().setStatusBarColor(BACKGROUND);
        activity.getWindow().setNavigationBarColor(BACKGROUND);
        activity.getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }
    static GradientDrawable rounded(Context context, int color, int radius, boolean stroke) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(color);
        background.setCornerRadius(dp(context, radius));
        if (stroke) background.setStroke(dp(context, 1), LINE);
        return background;
    }
    static void text(TextView view, int size) {
        view.setTextColor(size <= 14 ? MUTED : INK);
        view.setTextSize(size);
        view.setTypeface(Typeface.create(size >= 19 ? "sans-serif-medium" : "sans-serif", Typeface.NORMAL));
        view.setLineSpacing(dp(view.getContext(), 2), 1.05f);
    }
    static void button(Button view, boolean primary) {
        Context context = view.getContext();
        view.setAllCaps(false);
        view.setTextSize(16);
        view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        view.setTextColor(new ColorStateList(new int[][] { new int[] { -android.R.attr.state_enabled }, new int[] {} }, new int[] { MUTED, primary ? Color.WHITE : ACCENT }));
        view.setMinHeight(dp(context, 48));
        view.setMinimumHeight(dp(context, 48));
        view.setMinWidth(0);
        view.setMinimumWidth(0);
        view.setPadding(dp(context, 16), dp(context, 12), dp(context, 16), dp(context, 12));
        view.setBackground(new RippleDrawable(ColorStateList.valueOf(primary ? 0x33ffffff : 0x1a007aff), rounded(context, primary ? ACCENT : Color.rgb(239, 245, 255), 12, false), null));
        view.setStateListAnimator(null);
        view.setElevation(0);
    }
    static void input(EditText view) {
        text(view, 16);
        Context context = view.getContext();
        view.setMinHeight(dp(context, 48));
        view.setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10));
        view.setBackground(rounded(context, Color.WHITE, 10, true));
    }
    static void identity(LinearLayout parent) {
        Context context = parent.getContext();
        LinearLayout row = new LinearLayout(context); row.setGravity(android.view.Gravity.CENTER_VERTICAL);
        ImageView mark = new ImageView(context); mark.setImageResource(context.getResources().getIdentifier("icon", "drawable", context.getPackageName()));
        LinearLayout.LayoutParams icon = new LinearLayout.LayoutParams(dp(context, 36), dp(context, 36)); icon.rightMargin = dp(context, 12); row.addView(mark, icon);
        TextView owner = new TextView(context); owner.setText("МВ · Малик Валиходжаев"); text(owner, 14); row.addView(owner, new LinearLayout.LayoutParams(0, -2, 1));
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2); layout.bottomMargin = dp(context, 12); parent.addView(row, layout);
    }
}
