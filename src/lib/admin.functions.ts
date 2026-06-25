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
