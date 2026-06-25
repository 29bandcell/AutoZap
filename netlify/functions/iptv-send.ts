import type { Config } from "@netlify/functions";
import { json, requiredEnv } from "./_shared/http.ts";
import { supabase, supabaseCount } from "./_shared/supabase.ts";
import { constantTimeEqual, hashSecret } from "./_shared/secrets.ts";

function getCredential(req: Request, body: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const header = req.headers.get(name);
    if (header) return header.replace(/^Bearer\s+/i, "");
    const direct = body[name] ?? body[name.replace(/-/g, "_")];
    if (typeof direct === "string" && direct) return direct;
  }
  return "";
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let requestRecord: any = null;
  let eventRecord: any = null;
  try {
    const body = await req.json() as Record<string, unknown>;
    const appKey = getCredential(req, body, ["x-app-key", "app-key", "appKey"]);
    const authKey = getCredential(req, body, ["x-auth-key", "auth-key", "authKey", "authorization"]);
    if (!appKey || !authKey) return json({ error: "App Key e Auth Key são obrigatórias" }, 401);
    const prefix = appKey.slice(0, 20);
    const apps = await supabase(`api_apps?app_key_prefix=eq.${encodeURIComponent(prefix)}&status=eq.active&select=id,tenant_id,device_id,app_key_hash,auth_key_hash&limit=1`);
    if (!apps?.length || !constantTimeEqual(await hashSecret(appKey), apps[0].app_key_hash) || !constantTimeEqual(await hashSecret(authKey), apps[0].auth_key_hash)) return json({ error: "Credenciais da aplicação inválidas" }, 401);
    const app = apps[0];
    const [tenant] = await supabase(`tenants?id=eq.${app.tenant_id}&select=status,monthly_message_limit&limit=1`);
    if (!tenant || !["trial", "active"].includes(tenant.status)) return json({ error: "Conta suspensa ou inativa" }, 403);
    const rawNumber = String(body.number ?? body.phone ?? body.to ?? body.whatsapp ?? "");
    const number = rawNumber.replace(/\D/g, "");
    const text = String(body.text ?? body.message ?? body.body ?? "").trim();
    if (number.length < 10 || number.length > 15) return json({ error: "Número inválido" }, 400);
    if (!text || text.length > 4096) return json({ error: "Mensagem inválida" }, 400);
    const contacts = await supabase(`contacts?tenant_id=eq.${app.tenant_id}&phone=eq.${number}&select=id,opted_out_at&limit=1`);
    if (contacts?.[0]?.opted_out_at) return json({ error: "Contato não autorizou novas mensagens" }, 409);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
    const used = await supabaseCount(`message_events?tenant_id=eq.${app.tenant_id}&status=eq.sent&created_at=gte.${encodeURIComponent(monthStart.toISOString())}&select=id`);
    if (used >= tenant.monthly_message_limit) return json({ error: "Limite mensal de mensagens atingido" }, 429);
    const requestHash = await digest(JSON.stringify({ number, text }));
    const suppliedKey = String(req.headers.get("idempotency-key") || body.idempotencyKey || body.externalRequestId || "");
    const idempotencyKey = suppliedKey.slice(0, 160) || `${number}:${requestHash.slice(0, 24)}:${new Date().toISOString().slice(0,10)}`;
    const existing = await supabase(`api_requests?api_app_id=eq.${app.id}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=id,status,response_status,response_body&limit=1`);
    if (existing?.length) return json({ ok: existing[0].status === "completed", duplicate: true, status: existing[0].status }, existing[0].response_status || 202);
    try {
      [requestRecord] = await supabase("api_requests", { method: "POST", body: JSON.stringify({ tenant_id: app.tenant_id, api_app_id: app.id, idempotency_key: idempotencyKey, request_hash: requestHash, route: "/api/iptv/send" }) });
    } catch {
      const raced = await supabase(`api_requests?api_app_id=eq.${app.id}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=id,status,response_status&limit=1`);
      if (raced?.length) return json({ ok: raced[0].status === "completed", duplicate: true, status: raced[0].status }, raced[0].response_status || 202);
      throw new Error("Falha ao registrar idempotência");
    }
    const devices = await supabase(`devices?id=eq.${app.device_id}&tenant_id=eq.${app.tenant_id}&select=id,instance_name,status&limit=1`);
    if (!devices?.length) throw new Error("Dispositivo não encontrado");
    const device = devices[0];
    [eventRecord] = await supabase("message_events", { method: "POST", body: JSON.stringify({ tenant_id: app.tenant_id, device_id: device.id, api_app_id: app.id, dedupe_key: `${app.id}:${idempotencyKey}`, external_request_id: idempotencyKey, phone: number, message: text, status: "processing" }) });
    const response = await fetch(`${requiredEnv("EVOLUTION_API_URL").replace(/\/$/, "")}/message/sendText/${encodeURIComponent(device.instance_name)}`, { method: "POST", headers: { apikey: requiredEnv("EVOLUTION_API_KEY"), "content-type": "application/json" }, body: JSON.stringify({ number, text }) });
    const responseText = await response.text();
    let providerResponse: any = null;
    try { providerResponse = responseText ? JSON.parse(responseText) : null; } catch { providerResponse = { message: responseText.slice(0, 500) }; }
    if (!response.ok) throw new Error(`Evolution respondeu ${response.status}`);
    const publicResponse = { ok: true, status: "sent", requestId: requestRecord.id };
    await supabase(`message_events?id=eq.${eventRecord.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent", provider_response: providerResponse, sent_at: new Date().toISOString() }) });
    await supabase(`api_requests?id=eq.${requestRecord.id}`, { method: "PATCH", body: JSON.stringify({ status: "completed", response_status: 200, response_body: publicResponse, completed_at: new Date().toISOString() }) });
    await supabase(`api_apps?id=eq.${app.id}`, { method: "PATCH", body: JSON.stringify({ last_used_at: new Date().toISOString() }) });
    if (!contacts?.length) await supabase("contacts?on_conflict=tenant_id,phone", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ tenant_id: app.tenant_id, device_id: device.id, phone: number, last_interaction_at: new Date().toISOString() }) });
    return json(publicResponse);
  } catch (error) {
    console.error("IPTV integration error", error);
    if (eventRecord) { try { await supabase(`message_events?id=eq.${eventRecord.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error_message: "Falha no provedor de mensagens" }) }); } catch {} }
    if (requestRecord) { try { await supabase(`api_requests?id=eq.${requestRecord.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", response_status: 502, response_body: { error: "Falha no envio" }, completed_at: new Date().toISOString() }) }); } catch {} }
    return json({ error: "Não foi possível processar o envio" }, 502);
  }
};
export const config: Config = { path: ["/api/iptv/send", "/api/messages/send"], method: "POST" };
