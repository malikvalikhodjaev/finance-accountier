package uz.rhythm.money;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Exact, unique matches are suggestions. Only the owner can confirm that both legs are theirs. */
public final class OwnTransfers {
    private static final long WINDOW=120000L;
    private OwnTransfers() {}
    public static final class Item {
        public final String id, card, currency, operation, merchant, date, time;
        public final long amount, millis, revision, serverVersion;
        public Item(String id,String card,String currency,long amount,String date,String time,String operation,String merchant,long revision,long serverVersion) {
            this.id=id; this.card=card; this.currency=currency; this.amount=amount; this.date=date; this.time=time; this.operation=operation == null ? "" : operation; this.merchant=merchant == null ? "" : merchant; this.revision=revision; this.serverVersion=serverVersion;
            this.millis=LocalDateTime.parse(date+"T"+time).atZone(Formats.ZONE).toInstant().toEpochMilli();
        }
    }
    public static final class Pair {
        public final Item outgoing,incoming;
        Pair(Item outgoing,Item incoming) { this.outgoing=outgoing; this.incoming=incoming; }
    }
    private static final class Group {
        final Map<String,List<Item>> outgoing=new HashMap<>(),incoming=new HashMap<>();
    }
    public static List<Pair> candidates(List<Item> items) {
        Map<String,Group> groups=new HashMap<>();
        for (Item item : items) {
            if (!item.card.matches("\\d{4}") || item.amount<=0) continue;
            String op=item.operation.toLowerCase(Locale.ROOT), seller=item.merchant.toLowerCase(Locale.ROOT);
            boolean in=op.startsWith("popolnenie scheta") || op.startsWith("perevod na kartu");
            boolean out=op.startsWith("spisanie ") || op.equals("platezh") && (seller.contains("p2p") || seller.startsWith("frb "));
            if (!in && !out) continue;
            Group group=groups.computeIfAbsent(item.currency+":"+item.amount,key -> new Group());
            Map<String,List<Item>> side=in ? group.incoming : group.outgoing;
            side.computeIfAbsent(item.card,key -> new ArrayList<>()).add(item);
        }
        List<Pair> result=new ArrayList<>();
        for (Group group : groups.values()) {
            for (List<Item> list : group.incoming.values()) list.sort(Comparator.comparingLong(item -> item.millis));
            for (List<Item> list : group.outgoing.values()) list.sort(Comparator.comparingLong(item -> item.millis));
            for (List<Item> list : group.outgoing.values()) for (Item out : list) {
                Item in=unique(group.incoming,out);
                if (in!=null) { Item reverse=unique(group.outgoing,in); if (reverse!=null && reverse.id.equals(out.id)) result.add(new Pair(out,in)); }
            }
        }
        result.sort((a,b) -> Long.compare(b.outgoing.millis,a.outgoing.millis)); return result;
    }
    private static Item unique(Map<String,List<Item>> side,Item item) {
        Item match=null;
        for (Map.Entry<String,List<Item>> card : side.entrySet()) if (!card.getKey().equals(item.card)) {
            List<Item> rows=card.getValue(); int from=lower(rows,item.millis-WINDOW),to=lower(rows,item.millis+WINDOW+1);
            if (to-from>1 || to>from && match!=null) return null;
            if (to>from) match=rows.get(from);
        }
        return match;
    }
    private static int lower(List<Item> rows,long millis) {
        int low=0,high=rows.size();
        while (low<high) { int mid=(low+high)/2; if (rows.get(mid).millis<millis) low=mid+1; else high=mid; }
        return low;
    }
}
