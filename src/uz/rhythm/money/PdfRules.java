package uz.rhythm.money;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.util.Locale;

public final class PdfRules {
    public static final int MAX_BYTES = 5 * 1024 * 1024;
    private PdfRules() {}
    public static String filename(String input) {
        String name = input == null ? "" : input.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "").trim();
        if (name.isEmpty() || name.equals(".") || name.equals("..")) name = "Выписка.pdf";
        if (name.length() > 190) name = name.substring(0, 190);
        if (!(name.toLowerCase(Locale.ROOT).endsWith(".pdf") || name.toLowerCase(Locale.ROOT).endsWith(".xlsx"))) name += ".pdf";
        return name;
    }
    public static int copy(InputStream input, OutputStream output) throws IOException {
        return copy(input, output, false);
    }
    public static int copy(InputStream input, OutputStream output, boolean excel) throws IOException {
        byte[] header = new byte[5]; int received = 0;
        while (received < header.length) {
            int value = input.read();
            if (value < 0) throw new IOException("Файл пустой или не является PDF.");
            header[received++] = (byte)value;
        }
        boolean valid = excel ? header[0] == 'P' && header[1] == 'K' && header[2] == 3 && header[3] == 4 : header[0] == '%' && header[1] == 'P' && header[2] == 'D' && header[3] == 'F' && header[4] == '-';
        if (!valid) throw new IOException("Выбери исходный PDF банка или XLSX Payme.");
        output.write(header); int size = header.length; byte[] buffer = new byte[8192]; int read;
        while ((read = input.read(buffer)) != -1) {
            if (size + read > MAX_BYTES) throw new IOException("Файл больше 5 МБ. Выгрузи меньший период.");
            output.write(buffer, 0, read); size += read;
        }
        return size;
    }
}
