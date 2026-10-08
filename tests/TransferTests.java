package uz.rhythm.money;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class TransferTests {
    private static int checks;
    private static void check(boolean condition,String name) { checks++; if (!condition) throw new AssertionError(name); }
    private static OwnTransfers.Item item(String id,String card,String currency,long amount,String day,String time,boolean incoming) {
        return new OwnTransfers.Item(id,card,currency,amount,day,time,incoming ? "Popolnenie scheta" : "Spisanie c karty",incoming ? "TEST BANK" : "TEST P2P",1,0);
    }
    public static void main(String[] args) {
        OwnTransfers.Item out=item("out","1234","UZS",50000000,"2024-01-22","10:00",false),in=item("in","5678","UZS",50000000,"2024-01-22","10:01",true);
        List<OwnTransfers.Pair> pairs=OwnTransfers.candidates(Arrays.asList(out,in));
        check(pairs.size()==1 && pairs.get(0).outgoing==out && pairs.get(0).incoming==in,"Unique two-sided transfer suggested");
        check(OwnTransfers.candidates(Arrays.asList(out,item("fee","5678","UZS",49500000,"2024-01-22","10:01",true))).isEmpty(),"Commission is not guessed");
        check(OwnTransfers.candidates(Arrays.asList(out,item("usd","5678","USD",50000000,"2024-01-22","10:01",true))).isEmpty(),"Currencies never mixed");
        check(OwnTransfers.candidates(Arrays.asList(out,item("same","1234","UZS",50000000,"2024-01-22","10:01",true))).isEmpty(),"Different own cards required");
        check(OwnTransfers.candidates(Arrays.asList(out,item("late","5678","UZS",50000000,"2024-01-22","10:03",true))).isEmpty(),"Outside time window remains review");
        check(OwnTransfers.candidates(Arrays.asList(out,in,item("in2","9012","UZS",50000000,"2024-01-22","10:01",true))).isEmpty(),"Multiple matching receipts remain review");
        check(OwnTransfers.candidates(Arrays.asList(out,in,item("out2","9012","UZS",50000000,"2024-01-22","10:00",false))).isEmpty(),"Multiple matching debits remain review");
        check(OwnTransfers.candidates(Arrays.asList(new OwnTransfers.Item("purchase","1234","UZS",50000000,"2024-01-22","10:00","Pokupka","TEST SHOP",1,0),in)).isEmpty(),"Purchase cannot become transfer suggestion");
        check(OwnTransfers.candidates(Arrays.asList(item("night-out","1234","UZS",500,"2024-01-22","23:59",false),item("night-in","5678","UZS",500,"2024-01-23","00:00",true))).size()==1,"Window spans midnight");
        List<OwnTransfers.Item> many=new ArrayList<>();
        for (int i=0;i<37000;i++) many.add(item("id"+i,i%2==0 ? "1234" : "5678","UZS",500,"2024-01-22","10:00",i%2==1));
        check(OwnTransfers.candidates(many).isEmpty(),"37000 ambiguous same-amount messages do not generate false pairs");
        check(out.operation.equals("Spisanie c karty") && in.operation.equals("Popolnenie scheta"),"Suggestion search does not rewrite operation data");
        System.out.println("Passed "+checks+" own-transfer checks.");
    }
}
