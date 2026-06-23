import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ArrowLeft, Truck, TrendingDown, Camera, Store } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL, normalizeProductKey } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/lists/$id")({
  component: ListDetail,
});

type Item = {
  id: string;
  product_name: string;
  product_key: string;
  quantity: number;
  unit: string;
};
type Market = { id: string; name: string; chain: string | null; color: string | null };
type PriceReport = {
  id: string;
  market_id: string;
  product_key: string;
  product_name: string;
  price: number;
  unit: string;
  created_at: string;
};

function ListDetail() {
  const { id } = Route.useParams();
  const [list, setList] = useState<{ id: string; name: string } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [prices, setPrices] = useState<PriceReport[]>([]);
  const [freight, setFreight] = useState<Record<string, number>>({});
  const [newItem, setNewItem] = useState("");
  const [newQty, setNewQty] = useState("1");

  const load = async () => {
    const [{ data: l }, { data: it }, { data: mk }] = await Promise.all([
      supabase.from("shopping_lists").select("id,name").eq("id", id).maybeSingle(),
      supabase.from("list_items").select("*").eq("list_id", id).order("created_at"),
      supabase.from("markets").select("id,name,chain,color").order("name"),
    ]);
    setList(l ?? null);
    setItems((it ?? []) as Item[]);
    setMarkets((mk ?? []) as Market[]);

    if (it && it.length > 0) {
      const keys = Array.from(new Set(it.map((i: any) => i.product_key)));
      const { data: pr } = await supabase
        .from("price_reports")
        .select("id,market_id,product_key,product_name,price,unit,created_at")
        .in("product_key", keys)
        .order("created_at", { ascending: false });
      setPrices((pr ?? []) as PriceReport[]);
    } else {
      setPrices([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.trim()) return;
    const qty = Math.max(1, Number(newQty) || 1);
    const { error } = await supabase.from("list_items").insert({
      list_id: id,
      product_name: newItem.trim(),
      product_key: normalizeProductKey(newItem),
      quantity: qty,
    });
    if (error) toast.error(error.message);
    else {
      setNewItem("");
      setNewQty("1");
      load();
    }
  };

  const removeItem = async (itemId: string) => {
    const { error } = await supabase.from("list_items").delete().eq("id", itemId);
    if (error) toast.error(error.message);
    else load();
  };

  // ---- comparison engine ----
  // For each item, find the most recent price per market.
  const comparison = useMemo(() => {
    const marketBest: Record<string, Record<string, { price: number; report: PriceReport } | null>> = {};
    // pick freshest price per (product_key, market_id)
    const freshest = new Map<string, PriceReport>();
    for (const p of prices) {
      const k = `${p.product_key}|${p.market_id}`;
      if (!freshest.has(k)) freshest.set(k, p);
    }
    for (const item of items) {
      const row: Record<string, { price: number; report: PriceReport } | null> = {};
      for (const m of markets) {
        const k = `${item.product_key}|${m.id}`;
        const p = freshest.get(k);
        row[m.id] = p ? { price: p.price, report: p } : null;
      }
      marketBest[item.id] = row;
    }

    // For each item, pick cheapest market
    const itemBest: Record<string, { marketId: string; price: number } | null> = {};
    for (const item of items) {
      let best: { marketId: string; price: number } | null = null;
      for (const m of markets) {
        const r = marketBest[item.id][m.id];
        if (r && (!best || r.price < best.price)) {
          best = { marketId: m.id, price: r.price };
        }
      }
      itemBest[item.id] = best;
    }

    // Build per-market split (optimized: each item at cheapest market)
    const split: Record<string, { items: { item: Item; price: number }[]; subtotal: number }> = {};
    for (const m of markets) split[m.id] = { items: [], subtotal: 0 };
    let optimizedTotal = 0;
    let totalMatched = 0;
    let totalItems = items.length;
    for (const item of items) {
      const best = itemBest[item.id];
      if (best) {
        split[best.marketId].items.push({ item, price: best.price });
        split[best.marketId].subtotal += best.price * item.quantity;
        optimizedTotal += best.price * item.quantity;
        totalMatched += 1;
      }
    }

    // Also calc: most expensive scenario (taking the most expensive available per item across markets) for "saved" reference
    let worstTotal = 0;
    for (const item of items) {
      let worst = 0;
      for (const m of markets) {
        const r = marketBest[item.id][m.id];
        if (r && r.price > worst) worst = r.price;
      }
      worstTotal += worst * item.quantity;
    }

    // Single-market totals (buy all available items at that one market)
    const singleMarketTotals = markets.map((m) => {
      let sub = 0;
      let covered = 0;
      for (const item of items) {
        const r = marketBest[item.id][m.id];
        if (r) {
          sub += r.price * item.quantity;
          covered += 1;
        }
      }
      return { market: m, subtotal: sub, covered };
    });

    // Add freight on top of split subtotals (only markets that have at least one item)
    const splitWithFreight = Object.entries(split)
      .filter(([, v]) => v.items.length > 0)
      .map(([marketId, v]) => ({
        market: markets.find((m) => m.id === marketId)!,
        ...v,
        freight: freight[marketId] || 0,
        total: v.subtotal + (freight[marketId] || 0),
      }))
      .sort((a, b) => b.subtotal - a.subtotal);

    const optimizedFreightTotal = splitWithFreight.reduce((s, x) => s + x.freight, 0);
    const optimizedGrandTotal = optimizedTotal + optimizedFreightTotal;

    // Best single-market option (subtotal + freight)
    const bestSingle = singleMarketTotals
      .filter((s) => s.covered > 0)
      .map((s) => ({ ...s, freight: freight[s.market.id] || 0, total: s.subtotal + (freight[s.market.id] || 0) }))
      .sort((a, b) => a.total - b.total)[0];

    const savedVsWorst = worstTotal > 0 ? worstTotal - optimizedTotal : 0;
    const savedVsBestSingle = bestSingle ? bestSingle.total - optimizedGrandTotal : 0;

    return {
      marketBest,
      itemBest,
      splitWithFreight,
      optimizedTotal,
      optimizedFreightTotal,
      optimizedGrandTotal,
      singleMarketTotals,
      bestSingle,
      savedVsWorst,
      savedVsBestSingle,
      totalMatched,
      totalItems,
    };
  }, [items, markets, prices, freight]);

  if (!list) {
    return <div className="text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <Link to="/lists" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Minhas listas
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold">{list.name}</h1>
      </div>

      {/* Add items */}
      <form onSubmit={addItem} className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-3 shadow-soft">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Adicionar item (ex: arroz 5kg)"
          className="min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Input
          type="number"
          min={1}
          value={newQty}
          onChange={(e) => setNewQty(e.target.value)}
          className="w-20"
        />
        <Button type="submit" className="rounded-full">
          <Plus className="mr-1 h-4 w-4" /> Adicionar
        </Button>
      </form>

      {/* Items grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 font-display text-xl font-bold">Itens da lista</h2>
          {items.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
              Adicione itens para começar a comparar.
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => {
                const best = comparison.itemBest[item.id];
                const bestMarket = best ? markets.find((m) => m.id === best.marketId) : null;
                return (
                  <li key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium">{item.product_name}</span>
                        <span className="text-xs text-muted-foreground">×{item.quantity}</span>
                      </div>
                      {best && bestMarket ? (
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="font-semibold text-success">{formatBRL(best.price)}</span>
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${bestMarket.color}20`, color: bestMarket.color ?? undefined }}>
                            <Store className="h-3 w-3" /> {bestMarket.name}
                          </span>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">Sem preço reportado ainda — <Link to="/report" className="text-primary underline">reportar</Link></p>
                      )}
                    </div>
                    <button onClick={() => removeItem(item.id)} className="rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Remover">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Sidebar: economia */}
        <aside className="space-y-4">
          <div className="rounded-3xl border border-border bg-gradient-to-br from-primary to-primary/70 p-6 text-primary-foreground shadow-glow">
            <div className="flex items-center gap-2 text-sm font-medium opacity-90">
              <TrendingDown className="h-4 w-4" /> Plano otimizado
            </div>
            <p className="mt-2 text-3xl font-bold tracking-tight">{formatBRL(comparison.optimizedGrandTotal)}</p>
            <p className="mt-1 text-xs opacity-80">
              {comparison.totalMatched}/{comparison.totalItems} itens com preço · frete {formatBRL(comparison.optimizedFreightTotal)}
            </p>
            {comparison.savedVsBestSingle > 0 && (
              <p className="mt-3 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                Você economiza {formatBRL(comparison.savedVsBestSingle)} vs. comprar tudo no melhor mercado único
              </p>
            )}
          </div>

          {comparison.bestSingle && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Melhor mercado único</p>
              <p className="mt-1 font-display text-lg font-bold">{comparison.bestSingle.market.name}</p>
              <p className="text-sm text-muted-foreground">
                {formatBRL(comparison.bestSingle.subtotal)} + frete {formatBRL(comparison.bestSingle.freight)} = <span className="font-semibold text-foreground">{formatBRL(comparison.bestSingle.total)}</span>
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Per-market split */}
      {comparison.splitWithFreight.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-xl font-bold">Sua lista, dividida pelos mercados</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {comparison.splitWithFreight.map(({ market, items: bucket, subtotal, freight: fr, total }) => (
              <div key={market.id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: market.color ?? "#6C5CE7" }} />
                    <h3 className="font-display text-lg font-bold">{market.name}</h3>
                  </div>
                  <span className="text-xs text-muted-foreground">{bucket.length} {bucket.length === 1 ? "item" : "itens"}</span>
                </div>
                <ul className="mt-3 divide-y divide-border">
                  {bucket.map(({ item, price }) => (
                    <li key={item.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="truncate">{item.product_name} <span className="text-xs text-muted-foreground">×{item.quantity}</span></span>
                      <span className="font-medium">{formatBRL(price * item.quantity)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center gap-2">
                  <Label htmlFor={`f-${market.id}`} className="flex items-center gap-1 text-xs text-muted-foreground"><Truck className="h-3 w-3" /> Frete</Label>
                  <Input
                    id={`f-${market.id}`}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0,00"
                    value={freight[market.id] ?? ""}
                    onChange={(e) => setFreight((f) => ({ ...f, [market.id]: Number(e.target.value) || 0 }))}
                    className="h-8 w-24 text-sm"
                  />
                </div>
                <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
                  <span className="text-sm text-muted-foreground">Subtotal {formatBRL(subtotal)} + frete {formatBRL(fr)}</span>
                  <span className="font-display text-xl font-bold">{formatBRL(total)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="rounded-2xl border border-dashed border-border bg-accent/30 p-5 text-sm">
        <div className="flex items-start gap-3">
          <Camera className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <p className="font-medium">Falta preço de algum item?</p>
            <p className="text-muted-foreground">Fotografe a etiqueta no mercado e a IA registra automaticamente. <Link to="/report" className="font-semibold text-primary">Reportar preço →</Link></p>
          </div>
        </div>
      </div>
    </div>
  );
}
