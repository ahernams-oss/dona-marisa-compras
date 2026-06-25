import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, Sparkles, Upload, Loader2, Info, Check, ChevronsUpDown, Store } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn, normalizeProductKey, formatBRL, CATEGORIES, suggestCategory, type CategoryValue } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/report")({
  component: ReportPage,
});

type Market = { id: string; name: string; color: string | null; chain: string | null; city: string | null; state: string | null };

function ReportPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketId, setMarketId] = useState("");
  const [marketPickerOpen, setMarketPickerOpen] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [productName, setProductName] = useState("");
  const [brand, setBrand] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("un");
  const [category, setCategory] = useState<CategoryValue>("outros");
  const selectedMarket = markets.find((m) => m.id === marketId);

  useEffect(() => {
    supabase.from("markets").select("id,name,color,chain,city,state").order("name").then(({ data }) => {
      setMarkets((data ?? []) as Market[]);
      if (data && data.length > 0) setMarketId(data[0].id);
    });
  }, []);

  const onFile = async (file: File) => {
    setPhoto(file);
    const url = URL.createObjectURL(file);
    setPhotoPreview(url);
    // Auto-extract using AI
    setExtracting(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/extract-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 }),
      });
      if (!res.ok) throw new Error("Falha ao ler etiqueta");
      const data = await res.json();
      if (data.product_name) {
        setProductName(data.product_name);
        setCategory(suggestCategory(data.product_name));
      }
      if (data.brand) setBrand(data.brand);
      if (data.price) setPrice(String(data.price));
      if (data.unit) setUnit(data.unit);
      toast.success("IA leu a etiqueta — confira e ajuste se precisar 💜");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui ler a etiqueta — preencha à mão");
    } finally {
      setExtracting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !marketId || !productName || !price) {
      toast.error("Preencha mercado, produto e preço.");
      return;
    }
    setSubmitting(true);
    try {
      let photoUrl: string | null = null;
      if (photo) {
        const ext = photo.name.split(".").pop() || "jpg";
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("price-photos").upload(path, photo);
        if (upErr) throw upErr;
        photoUrl = path;
      }
      const { error } = await supabase.from("price_reports").insert({
        market_id: marketId,
        reporter_id: user.id,
        product_name: productName,
        product_key: normalizeProductKey(productName),
        brand: brand || null,
        price: Number(price),
        unit,
        category,
        photo_url: photoUrl,
      });
      if (error) throw error;
      toast.success(`Preço de ${productName} (${formatBRL(Number(price))}) reportado!`);
      navigate({ to: "/lists" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-3xl font-bold">Reportar preço</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tire foto da etiqueta — a IA identifica o produto e o valor pra você.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-6 rounded-3xl border border-border bg-card p-6 shadow-soft">
        {/* Photo */}
        <div>
          <Label>Foto da etiqueta</Label>
          <div className="mt-2">
            {photoPreview ? (
              <div className="relative overflow-hidden rounded-2xl border border-border">
                <img src={photoPreview} alt="Prévia" className="aspect-video w-full object-cover" />
                {extracting && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-foreground/70 text-background">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-sm font-medium">IA lendo a etiqueta...</span>
                  </div>
                )}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="grid w-full place-items-center gap-2 rounded-2xl border-2 border-dashed border-border bg-accent/30 p-8 text-center transition hover:border-primary hover:bg-accent"
                >
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-primary">
                    <Camera className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-medium">Tirar foto da etiqueta</p>
                  <p className="text-xs text-muted-foreground">A IA lê o nome e o preço automaticamente</p>
                </button>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Info className="h-3 w-3 shrink-0" />
                  No celular, tocar aqui abre a câmera automaticamente. No computador, você pode escolher uma foto da galeria.
                </p>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            {photoPreview && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Upload className="h-3 w-3" /> Trocar foto
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="market">Mercado</Label>
            <Popover open={marketPickerOpen} onOpenChange={setMarketPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="market"
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={marketPickerOpen}
                  className="mt-1.5 h-10 w-full justify-between font-normal"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {selectedMarket ? (
                      <>
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: selectedMarket.color ?? "hsl(var(--primary))" }}
                        />
                        <span className="truncate">{selectedMarket.name}</span>
                        {(selectedMarket.city || selectedMarket.state) && (
                          <span className="truncate text-xs text-muted-foreground">
                            · {[selectedMarket.city, selectedMarket.state].filter(Boolean).join("/")}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Selecione um mercado…</span>
                    )}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                <Command
                  filter={(value, search) => {
                    const v = value.toLowerCase();
                    const s = search.toLowerCase().trim();
                    if (!s) return 1;
                    return s.split(/\s+/).every((tok) => v.includes(tok)) ? 1 : 0;
                  }}
                >
                  <CommandInput placeholder="Buscar por nome, rede ou cidade…" />
                  <CommandList>
                    <CommandEmpty>
                      <div className="flex flex-col items-center gap-2 py-4 text-sm text-muted-foreground">
                        <Store className="h-6 w-6 opacity-50" />
                        Nenhum mercado encontrado
                      </div>
                    </CommandEmpty>
                    <CommandGroup>
                      {markets.map((m) => {
                        const loc = [m.city, m.state].filter(Boolean).join("/");
                        const haystack = [m.name, m.chain, m.city, m.state].filter(Boolean).join(" ");
                        return (
                          <CommandItem
                            key={m.id}
                            value={`${haystack} ${m.id}`}
                            onSelect={() => {
                              setMarketId(m.id);
                              setMarketPickerOpen(false);
                            }}
                            className="gap-2"
                          >
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ background: m.color ?? "hsl(var(--primary))" }}
                            />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate font-medium">{m.name}</span>
                              {(m.chain || loc) && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {[m.chain, loc].filter(Boolean).join(" · ")}
                                </span>
                              )}
                            </div>
                            <Check
                              className={cn(
                                "h-4 w-4 shrink-0",
                                marketId === m.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {markets.length} {markets.length === 1 ? "mercado cadastrado" : "mercados cadastrados"} — busque por nome, rede ou cidade.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="product">
              Produto {extracting && <Sparkles className="ml-1 inline h-3 w-3 text-primary" />}
            </Label>
            <Input
              id="product"
              value={productName}
              onChange={(e) => {
                setProductName(e.target.value);
                if (e.target.value && category === "outros") setCategory(suggestCategory(e.target.value));
              }}
              placeholder="Ex: Arroz Tio João 5kg"
              className="mt-1.5"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="category">Categoria (corredor)</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryValue)}
              className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="brand">Marca (opcional)</Label>
            <Input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="unit">Unidade</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger id="unit" className="mt-1.5 w-full">
                <SelectValue placeholder="Selecione a unidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="un">Un</SelectItem>
                <SelectItem value="kg">Kg</SelectItem>
                <SelectItem value="gr">Gr</SelectItem>
                <SelectItem value="L">L</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="price">Preço (R$)</Label>
            <Input id="price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" className="mt-1.5 text-lg font-semibold" required />
          </div>
        </div>

        <Button type="submit" disabled={submitting || extracting} className="w-full rounded-full" size="lg">
          {submitting ? "Salvando..." : "Reportar preço"}
        </Button>
      </form>
    </div>
  );
}
