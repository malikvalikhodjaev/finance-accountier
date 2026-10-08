package uz.rhythm.money;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Arrays;

public final class PdfTests {
    private static int checks;
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError("PDF check " + checks); }
    private static void rejected(byte[] bytes) throws Exception {
        try { PdfRules.copy(new ByteArrayInputStream(bytes), new ByteArrayOutputStream()); throw new AssertionError("Invalid PDF accepted"); }
        catch (IOException expected) { checks++; }
    }
    public static void main(String[] args) throws Exception {
        byte[] original = new byte[]{'%', 'P', 'D', 'F', '-', '1', '.', '7', '\n', 0, (byte)255, (byte)128};
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        check(PdfRules.copy(new ByteArrayInputStream(original), output) == original.length);
        check(Arrays.equals(original, output.toByteArray()));
        rejected(new byte[0]); rejected(new byte[]{'%', 'P'}); rejected(new byte[]{'n','o','t','p','d','f'});
        byte[] limit = new byte[PdfRules.MAX_BYTES]; System.arraycopy(original, 0, limit, 0, original.length);
        check(PdfRules.copy(new ByteArrayInputStream(limit), new ByteArrayOutputStream()) == PdfRules.MAX_BYTES);
        rejected(Arrays.copyOf(limit, PdfRules.MAX_BYTES + 1));
        check(PdfRules.filename("../../bank\\Мои операции.PDF").equals("Мои операции.PDF"));
        check(PdfRules.filename("\n\r").equals("Выписка.pdf"));
        check(PdfRules.filename("выписка").equals("выписка.pdf"));
        check(PdfRules.filename(new String(new char[300]).replace('\0', 'a')).length() <= 200);
        System.out.println("PDF sharing checks: " + checks);
    }
}
