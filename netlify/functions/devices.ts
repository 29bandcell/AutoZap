import type { Config, Context } from "@netlify/functions";
import { json, requiredEnv } from "./_shared/http.ts";
import { authError, requireTenantUser } from "./_shared/auth.ts";
import { supabase } from "./_shared/supabase.ts";

const baseUrl = () => requiredEnv("EVOLUTION_API_URL").replace(/\/$/, "");
const integration = () => Netlify.env.get("EVOLUTION_INTEGRATION") || "WHATSAPP-BAILEYS";

function evolutionErrorMessage(path: string, status: number, data: any) {
  const raw = data?.message || data?.error || data?.response?.message || data?.data?.message || JSON.stringify(data || {});
  const message = String(raw || `HTTP ${status}`).slice(0, 500);
  if (status === 401 || status === 403) return `Evolution API recusou a autenticação em ${path}. Confira EVOLUTION_API_KEY no Netlify.`;
  if (status === 404) return `Endpoint não encontrado na Evolution API: ${path}. Confira EVOLUTION_API_URL e a versão da Evolution.`;
  return `Evolution API falhou em ${path}: ${message}`;
}

async function evolution(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { apikey: requiredEnv("EVOLUTION_API_KEY"), "content-type": "application/json", ...init.headers }
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!response.ok) throw new Error(evolutionErrorMessage(path, response.status, data));
  return data;
}

function extractQr(data: any): string | null {
  if (!data) return null;
  const value = data?.qrcode?.base64 || data?.qrcode?.code || data?.qrcode || data?.base64 || data?.code || data?.qr || data?.data?.qrcode?.base64 || data?.data?.qrcode?.code || data?.data?.base64 || data?.data?.code;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function createEvolutionInstance(instanceName: string) {
  const payloads = [
    { instanceName, integration: integration(), qrcode: true, rejectCall: false, groupsIgnore: true, alwaysOnline: true, readMessages: false, readStatus: false },
    { instanceName, qrcode: true, rejectCall: false, groupsIgnore: true },
    { instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true }
  ];
  let lastError: unknown;
  for (const payload of payloads) {
    try {
      return await evolution("/instance/create", { method: "POST", body: JSON.stringify(payload) });
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message.toLowerCase() : "";
      if (msg.includes("autentica") || msg.includes("401") || msg.includes("403") || msg.includes("not found") || msg.includes("endpoint")) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Não foi possível criar a instância na Evolution API");
}

async function getQrCode(instanceName: string, created: any) {
  const fromCreate = extractQr(created);
  if (fromCreate) return fromCreate;
  const data = await evolution(`/instance/connect/${encodeURIComponent(instanceName)}`);
  const qr = extractQr(data);
  if (qr) return qr;
  throw new Error("A Evolution respondeu ao /instance/connect, mas não devolveu QR Code. Exclua este dispositivo pendente e crie outro para gerar um QR novo.");
}

async function tryDeleteEvolutionInstance(instanceName: string) {
  const encoded = encodeURIComponent(instanceName);
  const attempts: Array<[string, RequestInit]> = [
    [`/instance/delete/${encoded}`, { method: "DELETE" }],
    [`/instance/logout/${encoded}`, { method: "DELETE" }],
    [`/instance/logout/${encoded}`, { method: "POST" }]
  ];
  const errors: string[] = [];
  for (const [path, init] of attempts) {
    try {
      await evolution(path, init);
      return { ok: true, warning: null };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { ok: false, warning: errors[0] || "Evolution não confirmou a exclusão da instância" };
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
    if (req.method === "POST" && id) {
      const devices = await supabase(`devices?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}&select=id,instance_name&limit=1`);
      if (!devices?.length) return json({ error: "Dispositivo não encontrado" }, 404);
      const qrCode = await getQrCode(devices[0].instance_name, null);
      await supabase(`devices?id=eq.${devices[0].id}`, { method: "PATCH", body: JSON.stringify({ status: "connecting", last_seen_at: new Date().toISOString() }) });
      return json({ ok: true, id: devices[0].id, instanceName: devices[0].instance_name, qrCode });
    }
    if (req.method === "DELETE" && id) {
      const devices = await supabase(`devices?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}&select=id,instance_name&limit=1`);
      if (!devices?.length) return json({ error: "Dispositivo não encontrado" }, 404);
      const evolutionDelete = await tryDeleteEvolutionInstance(devices[0].instance_name);
      await supabase(`devices?id=eq.${devices[0].id}`, { method: "DELETE" });
      return json({ ok: true, warning: evolutionDelete.warning });
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
      created = await createEvolutionInstance(instanceName);
      const qrCode = await getQrCode(instanceName, created);
      const [device] = await supabase("devices", { method: "POST", body: JSON.stringify({ tenant_id: tenantId, name, instance_name: instanceName, status: "connecting" }) });
      return json({ ok: true, id: device.id, instanceName, state: created?.instance?.status || created?.instance?.state || "connecting", qrCode }, 201);
    } catch (error) {
      if (created) { try { await evolution(`/instance/delete/${encodeURIComponent(instanceName)}`, { method: "DELETE" }); } catch {} }
      throw error;
    }
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    const message = error instanceof Error ? error.message : "Não foi possível processar o dispositivo";
    console.error("Evolution device error", message);
    return json({ error: message }, 502);
  }
};
export const config: Config = { path: ["/api/devices", "/api/devices/:id", "/api/devices/:id/state"], method: ["GET", "POST", "DELETE"] };