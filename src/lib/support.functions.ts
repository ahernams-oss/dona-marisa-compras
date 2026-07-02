import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function isStaff(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "moderator"]);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export const sendSupportMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        subject: z.string().trim().min(1, "Assunto obrigatório").max(120),
        body: z.string().trim().min(1, "Mensagem obrigatória").max(500, "Máximo 500 caracteres"),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("support_messages").insert({
      user_id: context.userId,
      subject: data.subject,
      body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMySupportMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("support_messages")
      .select("id, subject, body, status, staff_reply, replied_at, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listAllSupportMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({ status: z.enum(["open", "in_progress", "resolved", "all"]).default("open") })
      .parse(data ?? {}),
  )
  .handler(async ({ context, data }) => {
    if (!(await isStaff(context.userId))) {
      throw new Response("Forbidden", { status: 403 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("support_messages")
      .select(
        "id, user_id, subject, body, status, staff_reply, replied_by, replied_at, created_at",
      )
      .order("created_at", { ascending: false });
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const userIds = Array.from(
      new Set([
        ...(rows ?? []).map((r: any) => r.user_id),
        ...(rows ?? []).map((r: any) => r.replied_by).filter(Boolean),
      ]),
    );
    const { data: profiles } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", userIds)
      : { data: [] as any[] };
    const nameById = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));

    const { data: authList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const emailById = new Map((authList?.users ?? []).map((u) => [u.id, u.email ?? ""]));

    return (rows ?? []).map((r: any) => ({
      ...r,
      user_name: nameById.get(r.user_id) ?? null,
      user_email: emailById.get(r.user_id) ?? null,
      replied_by_name: r.replied_by ? nameById.get(r.replied_by) ?? null : null,
    }));
  });

export const replySupportMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        id: z.string().uuid(),
        reply: z.string().trim().min(1).max(2000).optional(),
        status: z.enum(["open", "in_progress", "resolved"]),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    if (!(await isStaff(context.userId))) {
      throw new Response("Forbidden", { status: 403 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = { status: data.status };
    if (data.reply !== undefined) {
      patch.staff_reply = data.reply;
      patch.replied_by = context.userId;
      patch.replied_at = new Date().toISOString();
    }
    const { error } = await supabaseAdmin.from("support_messages").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
