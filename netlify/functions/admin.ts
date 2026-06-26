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

const planDefaults: Record<string, { max_devices: number; max_apps: number; monthly_message_limit: number }> = {
  starter: { max_devices: 1, max_apps: 1, monthly_message_limit: 1000 },
  pro: { max_devices: 3, max_apps: 3, monthly_message_limit: 5000 },
  agency: { max_devices: 10, max_apps: 10, monthly_message_limit: 25000 }
};

async function adminRows() {
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
  return { data: rows, summary: { tenants: rows.length, active: rows.filter((row: any) => ["active", "trial"].includes(String(row.subscription?.status || row.status))).length } };
}

async function updateTenant(req: Request) {
  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.tenantId || "").trim();
  if (!tenantId) return json({ error: "Cliente obrigatório" }, 400);
  const planCode = String(body.planCode || "starter").toLowerCase();
  const status = String(body.status || "trial").toLowerCase();
  if (!Object.keys(planDefaults).includes(planCode)) return json({ error: "Plano inválido" }, 400);
  if (!["trial", "active", "past_due", "suspended", "cancelled"].includes(status)) return json({ error: "Status inválido" }, 400);
  const defaults = planDefaults[planCode];
  const maxDevices = Math.max(0, Number(body.maxDevices ?? defaults.max_devices));
  const maxApps = Math.max(0, Number(body.maxApps ?? defaults.max_apps));
  const monthlyMessageLimit = Math.max(0, Number(body.monthlyMessageLimit ?? defaults.monthly_message_limit));
  const tenantPatch = {
    plan_code: planCode,
    status,
    max_devices: maxDevices,
    max_apps: maxApps,
    monthly_message_limit: monthlyMessageLimit,
    updated_at: new Date().toISOString()
  };
  await supabase(`tenants?id=eq.${encodeURIComponent(tenantId)}`, { method: "PATCH", body: JSON.stringify(tenantPatch) });
  const existing = await supabase(`tenant_subscriptions?tenant_id=eq.${encodeURIComponent(tenantId)}&select=id&limit=1`);
  const subscriptionPatch = {
    tenant_id: tenantId,
    plan_code: planCode,
    status,
    current_period_started_at: status === "active" ? new Date().toISOString() : null,
    current_period_ends_at: body.currentPeriodEndsAt || null,
    cancelled_at: ["cancelled", "suspended"].includes(status) ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  };
  if (existing?.length) {
    await supabase(`tenant_subscriptions?id=eq.${existing[0].id}`, { method: "PATCH", body: JSON.stringify(subscriptionPatch) });
  } else {
    await supabase("tenant_subscriptions", { method: "POST", body: JSON.stringify({ ...subscriptionPatch, trial_started_at: new Date().toISOString(), trial_ends_at: new Date(Date.now() + 3 * 86400000).toISOString() }) });
  }
  return json(await adminRows());
}

export default async (req: Request) => {
  try {
    const { user } = await requireTenantUser(req);
    if (!isPlatformAdmin(user.email)) return json({ error: "Acesso restrito ao administrador da plataforma" }, 403);
    if (req.method === "GET") return json(await adminRows());
    if (req.method === "PATCH") return updateTenant(req);
    return json({ error: "Método não permitido" }, 405);
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    console.error("Admin overview error", error);
    return json({ error: "Não foi possível carregar o painel admin" }, 500);
  }
};

export const config: Config = { path: "/api/admin/overview" };
