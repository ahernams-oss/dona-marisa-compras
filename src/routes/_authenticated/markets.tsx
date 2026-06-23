import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/markets")({
  component: MarketsPage,
});

type Market = { id: string; name: string; chain: string | null; city: string | null; color: string | null };
type Report = { market_id: string; price: number; product_name: string; created_at: string };

function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: r }] = await Promise.all([
        supabase.from("markets").select("*").order("name"),
        supabase.from("price_reports").select("market_id,price,product_name,created_at").order("created_at", { ascending: false }).limit(200),
      ]);
      setMarkets((m ?? []) as Market[]);
      setReports((r ?? []) as Report[]);
    })();
  }, []);

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Mercados</h1>
      <p className="mt-1 text-sm text-muted-foreground">Veja o que a comunidade já reportou em cada mercado.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {markets.map((m) => {
          const mr = reports.filter((r) => r.market_id === m.id);
          return (
            <div key={m.id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{ background: m.color ?? "#6C5CE7" }}>
                    <Store className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-lg font-bold leading-tight">{m.name}</h3>
                    <p className="text-xs text-muted-foreground">{m.city ?? "—"}</p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{mr.length} {mr.length === 1 ? "preço" : "preços"}</span>
              </div>
              {mr.length > 0 && (
                <ul className="mt-4 divide-y divide-border">
                  {mr.slice(0, 5).map((r, i) => (
                    <li key={i} className="flex items-center justify-between py-2 text-sm">
                      <span className="truncate">{r.product_name}</span>
                      <span className="font-semibold">{formatBRL(r.price)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
