import type { Config, Context } from "@netlify/functions";
import { json, requiredEnv } from "./_shared/http.ts";
import { authError, requireTenantUser } from "./_shared/auth.ts";
import { supabase } from "./_shared/supabase.ts";

const baseUrl = () => requiredEnv("EVOLUTION_API_URL").replace(/\/$/, "");
async function evolution(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl()}${path}`, { ...init, headers: { apikey: requiredEnv("EVOLUTION_API_KEY"), "content-type": "application/json", ...init.headers } });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data?.message || `Evolution API respondeu ${response.status}`);
  return data;
}
const safeName = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32);

export default async (req: Request, context: Context) => {
  try {
    const { profile } = await requireTenantUser(req);
    const tenantId = profile.tenant_id;
    const id = context.params.id;
    if (req.method === "GET" && !id) {
      return json({ data: await supabase(`devices?tenant_id=eq.${tenantId}&select=id,name,provider,instance_name,phone,status,chatbot_enabled,transcription_enabled,reject_calls_enabled,last_seen_at,created_at&order=created_at.desc`) });
    }
    if (req.method === "GET" && id) {
      const devices = await supabase(`devices?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}&select=id,instance_name&limit=1`);
      if (!devices?.length) return json({ error: "Dispositivo não encontrado" }, 404);
      const stateData = await evolution(`/instance/connectionState/${encodeURIComponent(devices[0].instance_name)}`);
      const state = stateData?.instance?.state || stateData?.state || "unknown";
      await supabase(`devices?id=eq.${devices[0].id}`, { method: "PATCH", body: JSON.stringify({ status: state === "open" ? "open" : state === "close" ? "close" : "connecting", last_seen_at: new Date().toISOString() }) });
      return json({ ok: true, state });
    }
    if (req.method === "DELETE" && id) {
      const devices = await supabase(`devices?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}&select=id,instance_name&limit=1`);
      if (!devices?.length) return json({ error: "Dispositivo não encontrado" }, 404);
      await evolution(`/instance/delete/${encodeURIComponent(devices[0].instance_name)}`, { method: "DELETE" });
      await supabase(`devices?id=eq.${devices[0].id}`, { method: "DELETE" });
      return json({ ok: true });
    }
    if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
    const body = await req.json();
    const name = String(body.name || "").trim().slice(0, 80);
    const normalizedName = safeName(name);
    if (normalizedName.length < 3) return json({ error: "Informe um nome com pelo menos 3 caracteres" }, 400);
    const [tenant] = await supabase(`tenants?id=eq.${tenantId}&select=id,slug,status,max_devices&limit=1`);
    if (!tenant || !["trial", "active"].includes(tenant.status)) return json({ error: "Conta sem permissão para criar dispositivos" }, 403);
    const existing = await supabase(`devices?tenant_id=eq.${tenantId}&select=id`);
    if ((existing?.length || 0) >= tenant.max_devices) return json({ error: "Limite de dispositivos do plano atingido" }, 409);
    const instanceName = `${safeName(tenant.slug)}-${normalizedName}-${crypto.randomUUID().slice(0, 8)}`;
    let created: any;
    try {
      created = await evolution("/instance/create", { method: "POST", body: JSON.stringify({ instanceName, integration: Netlify.env.get("EVOLUTION_INTEGRATION") || "WHATSAPP-BAILEYS", qrcode: true, rejectCall: false, groupsIgnore: true, alwaysOnline: true, readMessages: false, readStatus: false }) });
      const [device] = await supabase("devices", { method: "POST", body: JSON.stringify({ tenant_id: tenantId, name, instance_name: instanceName, status: "connecting" }) });
      let connection = created;
      if (!created?.qrcode?.base64 && !created?.qrcode?.code && !created?.base64) connection = await evolution(`/instance/connect/${encodeURIComponent(instanceName)}`);
      return json({ ok: true, id: device.id, instanceName, state: created?.instance?.status || created?.instance?.state || "connecting", qrCode: connection?.qrcode?.base64 || connection?.qrcode?.code || connection?.base64 || connection?.code || null }, 201);
    } catch (error) {
      if (created) { try { await evolution(`/instance/delete/${encodeURIComponent(instanceName)}`, { method: "DELETE" }); } catch {} }
      throw error;
    }
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    console.error("Evolution device error", error);
    return json({ error: "Não foi possível processar o dispositivo" }, 502);
  }
};
export const config: Config = { path: ["/api/devices", "/api/devices/:id", "/api/devices/:id/state"], method: ["GET", "POST", "DELETE"] };
