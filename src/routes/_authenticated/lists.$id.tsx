import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ArrowLeft, Truck, TrendingDown, Camera, Store, MapPin, History, TrendingUp, Minus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useGeolocation } from "@/hooks/use-geolocation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShareListDialog } from "@/components/ShareListDialog";
import { PriceSparkline } from "@/components/PriceSparkline";
import { CatalogPicker } from "@/components/CatalogPicker";
import { formatBRL, normalizeProductKey, CATEGORIES, getCategory, suggestCategory, haversineKm, type CategoryValue } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/lists/$id")({
  component: ListDetail,
});

type Item = {
  id: string;
  product_name: string;
  product_key: string;
  quantity: number;
  unit: string;
  category: string | null;
};
type Market = {
  id: string;
  name: string;
  chain: string | null;
  color: string | null;
  latitude: number | null;
  longitude: number | null;
};
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
  const { user } = useAuth();
  const geo = useGeolocation();
  const [list, setList] = useState<{ id: string; name: string; user_id: string } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [prices, setPrices] = useState<PriceReport[]>([]);
  const [freight, setFreight] = useState<Record<string, number>>({});
  const [newItem, setNewItem] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newCategory, setNewCategory] = useState<CategoryValue>("outros");
  const [historyFor, setHistoryFor] = useState<Item | null>(null);

  const isOwner = !!user && !!list && list.user_id === user.id;

  const load = async () => {
    const [{ data: l }, { data: it }, { data: mk }] = await Promise.all([
      supabase.from("shopping_lists").select("id,name,user_id").eq("id", id).maybeSingle(),
      supabase.from("list_items").select("*").eq("list_id", id).order("created_at"),
      supabase.from("markets").select("id,name,chain,color,latitude,longitude").order("name"),
    ]);
    setList(l ?? null);
    setItems((it ?? []) as Item[]);
    setMarkets((mk ?? []) as Market[]);

    if (it && it.length > 0) {
      const keys = Array.from(new Set(it.map((i: { product_key: string }) => i.product_key)));
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

  // suggest category from product name typed
  useEffect(() => {
    if (newItem.trim()) setNewCategory(suggestCategory(newItem));
  }, [newItem]);

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.trim()) return;
    const qty = Math.max(1, Number(newQty) || 1);
    const { error } = await supabase.from("list_items").insert({
      list_id: id,
      product_name: newItem.trim(),
      product_key: normalizeProductKey(newItem),
      quantity: qty,
      category: newCategory,
    });
    if (error) toast.error(error.message);
    else {
      setNewItem("");
      setNewQty("1");
      setNewCategory("outros");
      load();
    }
  };

  const removeItem = async (itemId: string) => {
    const { error } = await supabase.from("list_items").delete().eq("id", itemId);
    if (error) toast.error(error.message);
    else load();
  };

  // ---- comparison engine ----
  const comparison = useMemo(() => {
    const freshest = new Map<string, PriceReport>();
    for (const p of prices) {
      const k = `${p.product_key}|${p.market_id}`;
      if (!freshest.has(k)) freshest.set(k, p);
    }
    const marketBest: Record<string, Record<string, { price: number; report: PriceReport } | null>> = {};
    for (const item of items) {
      const row: Record<string, { price: number; report: PriceReport } | null> = {};
      for (const m of markets) {
        const k = `${item.product_key}|${m.id}`;
        const p = freshest.get(k);
        row[m.id] = p ? { price: p.price, report: p } : null;
      }
      marketBest[item.id] = row;
    }

    const itemBest: Record<string, { marketId: string; price: number } | null> = {};
    for (const item of items) {
      let best: { marketId: string; price: number } | null = null;
      for (const m of markets) {
        const r = marketBest[item.id][m.id];
        if (r && (!best || r.price < best.price)) best = { marketId: m.id, price: r.price };
      }
      itemBest[item.id] = best;
    }

    const split: Record<string, { items: { item: Item; price: number }[]; subtotal: number }> = {};
    for (const m of markets) split[m.id] = { items: [], subtotal: 0 };
    let optimizedTotal = 0;
    let totalMatched = 0;
    for (const item of items) {
      const best = itemBest[item.id];
      if (best) {
        split[best.marketId].items.push({ item, price: best.price });
        split[best.marketId].subtotal += best.price * item.quantity;
        optimizedTotal += best.price * item.quantity;
        totalMatched += 1;
      }
    }

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

    const bestSingle = singleMarketTotals
      .filter((s) => s.covered > 0)
      .map((s) => ({ ...s, freight: freight[s.market.id] || 0, total: s.subtotal + (freight[s.market.id] || 0) }))
      .sort((a, b) => a.total - b.total)[0];

    const savedVsBestSingle = bestSingle ? bestSingle.total - optimizedGrandTotal : 0;

    return {
      marketBest,
      itemBest,
      splitWithFreight,
      optimizedTotal,
      optimizedFreightTotal,
      optimizedGrandTotal,
      bestSingle,
      savedVsBestSingle,
      totalMatched,
      totalItems: items.length,
    };
  }, [items, markets, prices, freight]);

  // Group items by category (preserving creation order inside each group)
  const itemsByCategory = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      const c = item.category ?? "outros";
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(item);
    }
    return Array.from(map.entries())
      .map(([cat, list]) => ({ category: getCategory(cat), items: list }))
      .sort((a, b) => a.category.order - b.category.order);
  }, [items]);

  // Distance per market when user location is known
  const marketDistance = (m: Market) => {
    if (!geo.position || m.latitude == null || m.longitude == null) return null;
    return haversineKm(geo.position.lat, geo.position.lng, m.latitude, m.longitude);
  };

  if (!list) {
    return <div className="text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/lists" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Minhas listas
          </Link>
          <h1 className="mt-2 font-display text-3xl font-bold">{list.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {geo.position ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
              <MapPin className="h-3 w-3" /> Localização ativa
            </span>
          ) : (
            <Button onClick={geo.request} disabled={geo.requesting} variant="outline" size="sm" className="rounded-full">
              <MapPin className="mr-1.5 h-4 w-4" />
              {geo.requesting ? "Localizando..." : "Usar minha localização"}
            </Button>
          )}
          <ShareListDialog listId={list.id} isOwner={isOwner} />
        </div>
      </div>

      {/* Add items with category */}
      <form onSubmit={addItem} className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-3 shadow-soft">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Adicionar item (ex: arroz 5kg)"
          className="min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <select
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value as CategoryValue)}
          className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Categoria"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
          ))}
        </select>
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

      {/* Items grouped by category + savings sidebar */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <h2 className="font-display text-xl font-bold">Itens da lista</h2>
          {items.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
              Adicione itens para começar a comparar.
            </div>
          ) : (
            itemsByCategory.map(({ category, items: bucket }) => (
              <section key={category.value}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <span aria-hidden>{category.emoji}</span> {category.label}
                  <span className="text-xs font-normal normal-case text-muted-foreground/70">· {bucket.length} {bucket.length === 1 ? "item" : "itens"}</span>
                </h3>
                <ul className="space-y-2">
                  {bucket.map((item) => {
                    const best = comparison.itemBest[item.id];
                    const bestMarket = best ? markets.find((m) => m.id === best.marketId) : null;
                    const history = prices
                      .filter((p) => p.product_key === item.product_key)
                      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                    const first = history[0]?.price;
                    const last = history[history.length - 1]?.price;
                    const delta = first && last && first !== last ? ((last - first) / first) * 100 : 0;
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
                              {history.length >= 2 && (
                                <span className={`inline-flex items-center gap-1 font-medium ${delta < 0 ? "text-success" : delta > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                                  {delta < 0 ? <TrendingDown className="h-3 w-3" /> : delta > 0 ? <TrendingUp className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                                  {delta === 0 ? "estável" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`}
                                </span>
                              )}
                            </div>
                          ) : (
                            <p className="mt-1 text-xs text-muted-foreground">Sem preço reportado ainda — <Link to="/report" className="text-primary underline">reportar</Link></p>
                          )}
                        </div>
                        {history.length >= 2 && (
                          <button
                            onClick={() => setHistoryFor(item)}
                            className="hidden sm:block"
                            aria-label="Ver histórico"
                            title="Ver histórico de preços"
                          >
                            <PriceSparkline data={history.map((h) => ({ price: h.price, created_at: h.created_at }))} />
                          </button>
                        )}
                        {history.length >= 1 && (
                          <button
                            onClick={() => setHistoryFor(item)}
                            className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                            aria-label="Histórico"
                            title="Histórico de preços"
                          >
                            <History className="h-4 w-4" />
                          </button>
                        )}
                        <button onClick={() => removeItem(item.id)} className="rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Remover">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
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
            {comparison.splitWithFreight.map(({ market, items: bucket, subtotal, freight: fr, total }) => {
              const dist = marketDistance(market);
              return (
                <div key={market.id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: market.color ?? "#6C5CE7" }} />
                      <h3 className="font-display text-lg font-bold">{market.name}</h3>
                    </div>
                    <span className="text-xs text-muted-foreground">{bucket.length} {bucket.length === 1 ? "item" : "itens"}</span>
                  </div>
                  {dist !== null && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" /> {dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`} de você
                    </p>
                  )}
                  <ul className="mt-3 divide-y divide-border">
                    {bucket.map(({ item, price }) => (
                      <li key={item.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="truncate">
                          <span aria-hidden className="mr-1">{getCategory(item.category).emoji}</span>
                          {item.product_name} <span className="text-xs text-muted-foreground">×{item.quantity}</span>
                        </span>
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
              );
            })}
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

      {/* Price history dialog */}
      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Histórico de preço — {historyFor?.product_name}</DialogTitle>
          </DialogHeader>
          {historyFor && <HistoryView item={historyFor} prices={prices} markets={markets} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryView({ item, prices, markets }: { item: Item; prices: PriceReport[]; markets: Market[] }) {
  const history = prices
    .filter((p) => p.product_key === item.product_key)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  if (history.length === 0) return <p className="text-sm text-muted-foreground">Sem reportes ainda.</p>;
  const chrono = [...history].reverse();
  const min = Math.min(...history.map((h) => h.price));
  const max = Math.max(...history.map((h) => h.price));
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Menor: <strong className="text-success">{formatBRL(min)}</strong></span>
          <span>Maior: <strong className="text-destructive">{formatBRL(max)}</strong></span>
        </div>
        <div className="mt-2">
          <PriceSparkline data={chrono.map((h) => ({ price: h.price, created_at: h.created_at }))} width={420} height={80} />
        </div>
      </div>
      <ul className="max-h-72 divide-y divide-border overflow-y-auto">
        {history.map((h) => {
          const m = markets.find((x) => x.id === h.market_id);
          return (
            <li key={h.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium">{formatBRL(h.price)}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {m?.name ?? "Mercado"} · {new Date(h.created_at).toLocaleDateString("pt-BR")}
                </span>
              </div>
              {h.price === min && <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">menor</span>}
              {h.price === max && h.price !== min && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">maior</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
