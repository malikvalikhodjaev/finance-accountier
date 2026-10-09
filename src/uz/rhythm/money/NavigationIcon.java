package uz.rhythm.money;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.View;

/** Small monochrome outline icons; labels remain visible and accessible. */
final class NavigationIcon extends View {
    private final String name;
    private final Paint pen = new Paint(Paint.ANTI_ALIAS_FLAG);
    NavigationIcon(Context context, String name, boolean active) {
        super(context); this.name = name; pen.setColor(active ? UIStyles.INK : UIStyles.MUTED);
        pen.setStyle(Paint.Style.STROKE); pen.setStrokeWidth(1.65f); pen.setStrokeCap(Paint.Cap.ROUND); pen.setStrokeJoin(Paint.Join.ROUND);
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
    }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas); canvas.save(); canvas.scale(getWidth() / 24f, getHeight() / 24f);
        if (name.equals("dashboard")) {
            canvas.drawRoundRect(3, 12, 7, 21, 1, 1, pen); canvas.drawRoundRect(10, 7, 14, 21, 1, 1, pen); canvas.drawRoundRect(17, 3, 21, 21, 1, 1, pen);
        } else if (name.equals("table")) {
            canvas.drawRoundRect(3, 4, 21, 20, 2, 2, pen); canvas.drawLine(3, 10, 21, 10, pen); canvas.drawLine(3, 15, 21, 15, pen); canvas.drawLine(10, 4, 10, 20, pen);
        } else if (name.equals("data")) {
            canvas.drawOval(3, 3, 21, 9, pen); canvas.drawArc(3, 9, 21, 15, 0, 180, false, pen); canvas.drawArc(3, 15, 21, 21, 0, 180, false, pen);
            canvas.drawLine(3, 6, 3, 18, pen); canvas.drawLine(21, 6, 21, 18, pen);
        } else {
            Path gear = new Path();
            for (int i = 0; i < 32; i++) {
                double angle = i * Math.PI / 16 - Math.PI / 2; float radius = i % 4 == 0 || i % 4 == 3 ? 9 : 7;
                float x = 12 + radius * (float)Math.cos(angle), y = 12 + radius * (float)Math.sin(angle);
                if (i == 0) gear.moveTo(x, y); else gear.lineTo(x, y);
            }
            gear.close(); canvas.drawPath(gear, pen); canvas.drawCircle(12, 12, 3, pen);
        }
        canvas.restore();
    }
}
