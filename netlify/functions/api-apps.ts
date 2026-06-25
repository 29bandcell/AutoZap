import type { Config, Context } from "@netlify/functions";
import { json } from "./_shared/http.ts";
import { authError, requireTenantUser } from "./_shared/auth.ts";
import { supabase } from "./_shared/supabase.ts";
import { hashSecret, randomSecret } from "./_shared/secrets.ts";

export default async (req: Request, context: Context) => {
  try {
    const { profile } = await requireTenantUser(req);
    const tenantId = profile.tenant_id;
    if (req.method === "GET") {
      const apps = await supabase(`api_apps?tenant_id=eq.${tenantId}&select=id,name,device_id,app_key_prefix,status,last_used_at,created_at&order=created_at.desc`);
      return json({ data: apps });
    }
    if (req.method === "DELETE" && context.params.id) {
      await supabase(`api_apps?id=eq.${encodeURIComponent(context.params.id)}&tenant_id=eq.${tenantId}`, { method: "PATCH", body: JSON.stringify({ status: "revoked" }) });
      return json({ ok: true });
    }
    if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
    const body = await req.json();
    const name = String(body.name || "").trim().slice(0, 80);
    const deviceId = String(body.deviceId || "");
    if (name.length < 3 || !deviceId) return json({ error: "Nome e dispositivo são obrigatórios" }, 400);
    const [tenant] = await supabase(`tenants?id=eq.${tenantId}&select=status,max_apps&limit=1`);
    if (!tenant || !["trial", "active"].includes(tenant.status)) return json({ error: "Conta sem permissão para criar aplicativos" }, 403);
    const devices = await supabase(`devices?id=eq.${encodeURIComponent(deviceId)}&tenant_id=eq.${tenantId}&select=id&limit=1`);
    if (!devices?.length) return json({ error: "Dispositivo inválido" }, 400);
    const existing = await supabase(`api_apps?tenant_id=eq.${tenantId}&status=eq.active&select=id`);
    if ((existing?.length || 0) >= tenant.max_apps) return json({ error: "Limite de aplicativos do plano atingido" }, 409);
    const appKey = randomSecret("az_app");
    const authKey = randomSecret("az_auth");
    const [created] = await supabase("api_apps", { method: "POST", body: JSON.stringify({ tenant_id: tenantId, device_id: deviceId, name, app_key_prefix: appKey.slice(0, 20), app_key_hash: await hashSecret(appKey), auth_key_hash: await hashSecret(authKey) }) });
    return json({ ok: true, data: { id: created.id, name: created.name, appKey, authKey }, warning: "Estas chaves serão exibidas somente uma vez." }, 201);
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    console.error("API apps error", error);
    return json({ error: "Não foi possível processar o aplicativo" }, 500);
  }
};
export const config: Config = { path: ["/api/apps", "/api/apps/:id"], method: ["GET", "POST", "DELETE"] };
