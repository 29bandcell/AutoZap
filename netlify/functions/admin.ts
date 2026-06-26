import type { Config } from "@netlify/functions";
import { json } from "./_shared/http.ts";
import { authError, requireTenantUser } from "./_shared/auth.ts";
import { supabase } from "./_shared/supabase.ts";

const isPlatformAdmin = (email?: string) => {
  const allowed = (Netlify.env.get("AUTOZAP_ADMIN_EMAILS") || "")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allowed.includes(email.toLowerCase());
};

const monthStartIso = () => {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
};

export default async (req: Request) => {
  try {
    if (req.method !== "GET") return json({ error: "Método não permitido" }, 405);
    const { user } = await requireTenantUser(req);
    if (!isPlatformAdmin(user.email)) return json({ error: "Acesso restrito ao administrador da plataforma" }, 403);
    const monthStart = monthStartIso();
    const [tenants, subscriptions, profiles, devices, events] = await Promise.all([
      supabase("tenants?select=id,name,slug,status,plan_code,trial_ends_at,max_devices,max_apps,monthly_message_limit,created_at&order=created_at.desc&limit=200"),
      supabase("tenant_subscriptions?select=tenant_id,plan_code,status,trial_started_at,trial_ends_at,current_period_ends_at,cancelled_at"),
      supabase("profiles?select=id,tenant_id,full_name,role"),
      supabase("devices?select=id,tenant_id,status,created_at"),
      supabase(`message_events?created_at=gte.${encodeURIComponent(monthStart)}&select=id,tenant_id,direction,status,created_at&limit=10000`)
    ]);
    const subByTenant = new Map((subscriptions || []).map((item: any) => [item.tenant_id, item]));
    const rows = (tenants || []).map((tenant: any) => {
      const tenantDevices = (devices || []).filter((item: any) => item.tenant_id === tenant.id);
      const tenantProfiles = (profiles || []).filter((item: any) => item.tenant_id === tenant.id);
      const tenantEvents = (events || []).filter((item: any) => item.tenant_id === tenant.id);
      const outbound = tenantEvents.filter((item: any) => item.direction === "outbound" && item.status === "sent").length;
      const failed = tenantEvents.filter((item: any) => item.status === "failed").length;
      return {
        ...tenant,
        subscription: subByTenant.get(tenant.id) || null,
        users: tenantProfiles.length,
        devices: tenantDevices.length,
        connectedDevices: tenantDevices.filter((item: any) => ["open", "connected"].includes(String(item.status).toLowerCase())).length,
        messagesThisMonth: outbound,
        failuresThisMonth: failed
      };
    });
    return json({ data: rows, summary: { tenants: rows.length, active: rows.filter((row: any) => ["active", "trial"].includes(String(row.subscription?.status || row.status))).length } });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    console.error("Admin overview error", error);
    return json({ error: "Não foi possível carregar o painel admin" }, 500);
  }
};

export const config: Config = { path: "/api/admin/overview", method: "GET" };
