import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function isAdmin(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

async function assertAdmin(_supabase: any, userId: string) {
  if (!(await isAdmin(userId))) throw new Response("Forbidden", { status: 403 });
}

export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { isAdmin: await isAdmin(context.userId) };
  });

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (authErr) throw new Error(authErr.message);

    const { data: roles, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role");
    if (rolesErr) throw new Error(rolesErr.message);

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, city");

    const rolesByUser = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });
    const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    return authData.users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      full_name: (profileById.get(u.id) as any)?.full_name ?? null,
      city: (profileById.get(u.id) as any)?.city ?? null,
      roles: rolesByUser.get(u.id) ?? [],
    }));
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["admin", "user"]),
        grant: z.boolean(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.userId === context.userId && data.role === "admin" && !data.grant) {
      throw new Response("Você não pode remover seu próprio acesso de admin", { status: 400 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.grant) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.userId, role: data.role });
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const listPricesByMarket = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: markets, error: mErr } = await supabaseAdmin
      .from("markets")
      .select("id, name, city, state, neighborhood, address")
      .order("name");
    if (mErr) throw new Error(mErr.message);

    const { data: prices, error: pErr } = await supabaseAdmin
      .from("price_reports")
      .select(
        "id, market_id, reporter_id, product_name, brand, price, unit, category, photo_url, created_at",
      )
      .order("created_at", { ascending: false });
    if (pErr) throw new Error(pErr.message);

    const reporterIds = Array.from(new Set((prices ?? []).map((p: any) => p.reporter_id)));
    const { data: profiles } = reporterIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", reporterIds)
      : { data: [] as any[] };
    const nameById = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));

    const byMarket = new Map<string, any[]>();
    (prices ?? []).forEach((p: any) => {
      const arr = byMarket.get(p.market_id) ?? [];
      arr.push({ ...p, reporter_name: nameById.get(p.reporter_id) ?? null });
      byMarket.set(p.market_id, arr);
    });

    return (markets ?? []).map((m: any) => ({
      ...m,
      prices: byMarket.get(m.id) ?? [],
    }));
  });

/**
 * Aggregate every distinct product_key that appears in price_reports or
 * list_items, with usage counts and whether it exists in the catalog.
 * Used by admin to identify divergent entries (e.g. "arroz-5kg" vs
 * "arroz-5kg-tio-joao") and merge them.
 */
export const listProductKeysUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: reports, error: rErr }, { data: items, error: iErr }, { data: catalog, error: cErr }] =
      await Promise.all([
        supabaseAdmin.from("price_reports").select("product_key, product_name, category, unit"),
        supabaseAdmin.from("list_items").select("product_key, product_name, category, unit"),
        supabaseAdmin.from("product_catalog").select("id, product_key, name, category, unit").order("name"),
      ]);
    if (rErr) throw new Error(rErr.message);
    if (iErr) throw new Error(iErr.message);
    if (cErr) throw new Error(cErr.message);

    const catalogKeys = new Set((catalog ?? []).map((c: any) => c.product_key));
    type Row = {
      product_key: string;
      sample_name: string;
      category: string | null;
      unit: string | null;
      reports: number;
      list_items: number;
      in_catalog: boolean;
    };
    const map = new Map<string, Row>();
    const bump = (key: string, name: string, cat: string | null, unit: string | null, kind: "r" | "i") => {
      const cur = map.get(key) ?? {
        product_key: key,
        sample_name: name,
        category: cat,
        unit,
        reports: 0,
        list_items: 0,
        in_catalog: catalogKeys.has(key),
      };
      if (kind === "r") cur.reports += 1;
      else cur.list_items += 1;
      map.set(key, cur);
    };
    (reports ?? []).forEach((r: any) => bump(r.product_key, r.product_name, r.category, r.unit, "r"));
    (items ?? []).forEach((r: any) => bump(r.product_key, r.product_name, r.category, r.unit, "i"));

    return {
      rows: Array.from(map.values()).sort((a, b) => {
        if (a.in_catalog !== b.in_catalog) return a.in_catalog ? 1 : -1;
        return b.reports + b.list_items - (a.reports + a.list_items);
      }),
      catalog: (catalog ?? []).map((c: any) => ({
        id: c.id,
        product_key: c.product_key,
        name: c.name,
        category: c.category,
        unit: c.unit,
      })),
    };
  });

/**
 * Replace every reference to `from` product_key with the catalog entry
 * identified by `toCatalogId` across price_reports and list_items.
 */
export const mergeProductKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        from: z.string().min(1),
        toCatalogId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target, error: tErr } = await supabaseAdmin
      .from("product_catalog")
      .select("product_key, name, category, unit")
      .eq("id", data.toCatalogId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!target) throw new Response("Produto destino não encontrado", { status: 404 });
    if (target.product_key === data.from) {
      throw new Response("Origem e destino são o mesmo produto", { status: 400 });
    }

    const payload = {
      product_key: target.product_key,
      product_name: target.name,
      category: target.category,
      unit: target.unit,
    };

    const { error: rErr, count: rCount } = await supabaseAdmin
      .from("price_reports")
      .update(payload, { count: "exact" })
      .eq("product_key", data.from);
    if (rErr) throw new Error(rErr.message);

    const { error: iErr, count: iCount } = await supabaseAdmin
      .from("list_items")
      .update(payload, { count: "exact" })
      .eq("product_key", data.from);
    if (iErr) throw new Error(iErr.message);

    return { ok: true, reportsUpdated: rCount ?? 0, itemsUpdated: iCount ?? 0 };
  });

/**
 * Promote an orphan product_key (free-text) to the curated catalog so future
 * reports can pick it up.
 */
export const promoteToCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        product_key: z.string().min(1),
        name: z.string().min(1),
        category: z.string().min(1),
        unit: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("product_catalog").insert({
      product_key: data.product_key,
      name: data.name,
      category: data.category,
      unit: data.unit,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

