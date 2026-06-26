import type { Config } from "@netlify/functions";
import { json, requiredEnv } from "./_shared/http.ts";
import { supabase } from "./_shared/supabase.ts";
import { constantTimeEqual } from "./_shared/secrets.ts";

const DEFAULT_GREETING = `Olá, que bom te ter aqui!

Sou {{company_name}}. 🙍‍♂️

🔸Em qual aparelho irá testar?

Aguardo sua resposta 🤓

1 - TV Box
2 - Celular
3 - Chromecast
4 - Computador
5 - Smart TV
6 - Amazon Fire Stick`;
const DEFAULT_FOLLOWUP = `Digite '{{keyword}}' para receber um teste gratuito.`;

const normalizeText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const extractText = (data: any) => data?.message?.conversation || data?.message?.extendedTextMessage?.text || data?.message?.imageMessage?.caption || data?.message?.videoMessage?.caption || "";
const firstName = (value: unknown) => String(value || "cliente").trim().split(/\s+/)[0] || "cliente";
const matches = (rule: any, text: string) => {
  const input = normalizeText(text); const keyword = normalizeText(rule.keyword || "");
  if (rule.match_type === "contains") return input.includes(keyword);
  if (rule.match_type === "starts_with") return input.startsWith(keyword);
  return input === keyword;
};
const getPath = (source: any, path = "") => path.split(".").filter(Boolean).reduce((acc, key) => acc?.[key], source);
const stringifyValue = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
};
const renderTemplate = (template: string, context: Record<string, unknown>) => template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => stringifyValue(getPath(context, path)));
const responseToText = (payload: any, fallback: string, context: Record<string, unknown>) => {
  const direct = payload?.text || payload?.message || payload?.reply || payload?.response || payload?.data?.text || payload?.data?.message || payload?.data?.customer_message || payload?.data?.customer_renew_template;
  if (direct) return renderTemplate(String(direct), context);
  if (fallback) return renderTemplate(fallback, { ...context, api: payload?.data || payload });
  return stringifyValue(payload);
};
const assertWebhookUrl = (url: string) => {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("URL de webhook inválida");
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname)) throw new Error("URL de webhook local bloqueada");
  return parsed;
};
async function callExternalWebhook(rule: any, payload: Record<string, unknown>) {
  const action = rule.action || {};
  const url = String(action.url || action.webhook_url || action.endpoint || "").trim();
  if (!url) throw new Error("Regra webhook sem URL");
  const parsed = assertWebhookUrl(url);
  const method = String(action.method || "POST").toUpperCase();
  const headers = { "content-type": "application/json", ...(action.headers && typeof action.headers === "object" ? action.headers : {}) };
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(25000) };
  if (method === "GET") {
    Object.entries(payload).forEach(([key, value]) => parsed.searchParams.set(key, String(value ?? "")));
  } else {
    init.body = JSON.stringify(action.body && typeof action.body === "object" ? { ...payload, ...action.body } : payload);
  }
  const response = await fetch(parsed.toString(), init);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) throw new Error(`Webhook IPTV respondeu ${response.status}`);
  return body;
}
function extractConnectedPhone(data: any) {
  const raw = data?.wuid || data?.phone || data?.number || data?.owner || data?.ownerJid || data?.instance?.wuid || data?.instance?.owner || data?.instance?.ownerJid || data?.instance?.profile?.id || "";
  const phone = String(raw).split("@")[0].replace(/\D/g, "");
  return phone.length >= 10 ? phone : null;
}
async function send(instance: string, number: string, text: string) {
  const response = await fetch(`${requiredEnv("EVOLUTION_API_URL").replace(/\/$/, "")}/message/sendText/${encodeURIComponent(instance)}`, { method: "POST", headers: { apikey: requiredEnv("EVOLUTION_API_KEY"), "content-type": "application/json" }, body: JSON.stringify({ number, text }) });
  if (!response.ok) throw new Error(`Evolution respondeu ${response.status}`);
  return response.json();
}
async function logOutbound(device: any, messageId: string, phone: string, message: string, providerResponse: Record<string, unknown> = {}) {
  await supabase("message_events", { method: "POST", body: JSON.stringify({ tenant_id: device.tenant_id, device_id: device.id, dedupe_key: `reply:${device.id}:${messageId}`, external_request_id: `reply:${messageId}`, phone, message, direction: "outbound", status: "sent", provider_response: providerResponse, sent_at: new Date().toISOString() }) });
}
async function upsertContact(device: any, phone: string, data: any, metadata?: Record<string, unknown>, optedOutAt?: string | null) {
  const payload: Record<string, unknown> = { tenant_id: device.tenant_id, device_id: device.id, phone, display_name: String(data.pushName || "").slice(0, 120) || null, last_interaction_at: new Date().toISOString() };
  if (metadata) payload.metadata = metadata;
  if (optedOutAt !== undefined) payload.opted_out_at = optedOutAt;
  await supabase("contacts?on_conflict=tenant_id,phone", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(payload) });
}
async function firstTestKeyword(tenantId: string, deviceId: string) {
  const packages = await supabase(`iptv_test_packages?tenant_id=eq.${tenantId}&status=eq.active&select=keyword,device_id&order=created_at.desc&limit=10`);
  const packageForDevice = (packages || []).find((item: any) => !item.device_id || item.device_id === deviceId) || packages?.[0];
  return String(packageForDevice?.keyword || "teste iptv").trim() || "teste iptv";
}
async function handleLeadCapture(params: { device: any; instance: string; phone: string; text: string; messageId: string; data: any; contact: any; tenant: any }) {
  const { device, instance, phone, text, messageId, data, contact, tenant } = params;
  if (tenant?.lead_capture_enabled === false) return false;
  const metadata = contact?.metadata && typeof contact.metadata === "object" ? contact.metadata : {};
  const context = { name: firstName(data.pushName), company_name: tenant?.name || "AutoZap", inbound: { senderPhone: phone, message: text } };
  const isNewContact = !contact?.id;
  const stage = String(metadata.lead_capture_stage || "");
  if (isNewContact) {
    const reply = renderTemplate(String(tenant?.lead_greeting_template || DEFAULT_GREETING), context);
    await upsertContact(device, phone, data, { ...metadata, lead_capture_stage: "awaiting_device", lead_capture_started_at: new Date().toISOString(), lead_capture_last_prompt_at: new Date().toISOString() });
    const result = await send(instance, phone, reply);
    await logOutbound(device, `lead-greeting:${messageId}`, phone, reply, { whatsapp: result, lead_capture: "greeting" });
    return true;
  }
  if (stage === "awaiting_device") {
    const reply = /^\d{1,2}$/.test(text.trim())
      ? renderTemplate(String(tenant?.lead_followup_template || DEFAULT_FOLLOWUP), { ...context, keyword: await firstTestKeyword(device.tenant_id, device.id), device_option: text.trim() })
      : renderTemplate(String(tenant?.lead_greeting_template || DEFAULT_GREETING), context);
    const nextMetadata = /^\d{1,2}$/.test(text.trim())
      ? { ...metadata, lead_capture_stage: "awaiting_keyword", lead_device_option: text.trim(), lead_capture_updated_at: new Date().toISOString() }
      : { ...metadata, lead_capture_last_prompt_at: new Date().toISOString() };
    await upsertContact(device, phone, data, nextMetadata);
    const result = await send(instance, phone, reply);
    await logOutbound(device, `lead-step:${messageId}`, phone, reply, { whatsapp: result, lead_capture: nextMetadata.lead_capture_stage || "awaiting_device" });
    return true;
  }
  return false;
}

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  const expected = requiredEnv("EVOLUTION_WEBHOOK_SECRET");
  const received = req.headers.get("x-webhook-secret") || new URL(req.url).searchParams.get("token") || "";
  if (!constantTimeEqual(received, expected)) return json({ error: "Webhook não autorizado" }, 401);
  try {
    const body = await req.json();
    const instance = String(body.instance || body.instanceName || "");
    if (!instance) return json({ error: "Instância ausente" }, 400);
    const devices = await supabase(`devices?instance_name=eq.${encodeURIComponent(instance)}&select=id,tenant_id,instance_name&limit=1`);
    if (!devices?.length) return new Response(null, { status: 204 });
    const device = devices[0];
    const eventName = String(body.event || "").toLowerCase();
    if (eventName.includes("connection")) {
      const state = String(body.data?.state || body.data?.status || "connecting").toLowerCase();
      const connectedPhone = extractConnectedPhone(body.data || {});
      const devicePatch: Record<string, unknown> = { status: state === "open" ? "open" : state === "close" ? "close" : "connecting", last_seen_at: new Date().toISOString() };
      if (connectedPhone) devicePatch.phone = connectedPhone;
      await supabase(`devices?id=eq.${device.id}`, { method: "PATCH", body: JSON.stringify(devicePatch) });
      return new Response(null, { status: 204 });
    }
    if (!eventName.includes("messages") && !eventName.includes("message")) return new Response(null, { status: 204 });
    const data = body.data || {};
    if (data.key?.fromMe) return new Response(null, { status: 204 });
    const remote = String(data.sender || data.key?.remoteJidAlt || data.key?.remoteJid || "");
    if (remote.includes("@g.us")) return new Response(null, { status: 204 });
    const phone = remote.split("@")[0].replace(/\D/g, "");
    const text = String(extractText(data)).trim();
    const messageId = String(data.key?.id || body.id || "");
    if (!phone || !text || !messageId) return new Response(null, { status: 204 });
    const duplicate = await supabase(`message_events?tenant_id=eq.${device.tenant_id}&external_request_id=eq.${encodeURIComponent(messageId)}&select=id&limit=1`);
    if (duplicate?.length) return new Response(null, { status: 204 });
    await supabase("message_events", { method: "POST", body: JSON.stringify({ tenant_id: device.tenant_id, device_id: device.id, dedupe_key: `inbound:${device.id}:${messageId}`, external_request_id: messageId, phone, message: text, direction: "inbound", status: "sent", sent_at: new Date().toISOString() }) });
    const stopWords = ["sair", "parar", "cancelar", "nao quero receber"];
    const startWords = ["voltar", "ativar mensagens"];
    const normalized = normalizeText(text);
    const optedOut = stopWords.includes(normalized);
    const optedIn = startWords.includes(normalized);
    const currentContacts = await supabase(`contacts?tenant_id=eq.${device.tenant_id}&phone=eq.${phone}&select=id,opted_out_at,metadata&limit=1`);
    const contact = currentContacts?.[0] || null;
    if (optedOut) { await upsertContact(device, phone, data, contact?.metadata || {}, new Date().toISOString()); await send(instance, phone, "Você não receberá mais mensagens automáticas. Para voltar, envie VOLTAR."); return new Response(null, { status: 204 }); }
    if (optedIn) { await upsertContact(device, phone, data, { ...(contact?.metadata || {}), lead_capture_stage: "awaiting_keyword" }, null); await send(instance, phone, "Mensagens automáticas reativadas com sucesso."); return new Response(null, { status: 204 }); }
    if (contact?.opted_out_at) return new Response(null, { status: 204 });
    const tenants = await supabase(`tenants?id=eq.${device.tenant_id}&select=name,lead_capture_enabled,lead_greeting_template,lead_followup_template&limit=1`);
    const handledLeadCapture = await handleLeadCapture({ device, instance, phone, text, messageId, data, contact, tenant: tenants?.[0] || {} });
    if (handledLeadCapture) return new Response(null, { status: 204 });
    await upsertContact(device, phone, data, contact?.metadata || {});
    const rules = await supabase(`automation_rules?device_id=eq.${device.id}&enabled=eq.true&select=id,name,keyword,match_type,action,reply_template&order=priority.asc`);
    const rule = (rules || []).find((candidate: any) => matches(candidate, text));
    if (!rule) return new Response(null, { status: 204 });
    const actionType = String(rule.action?.type || "reply").toLowerCase();
    const webhookPayload = {
      appName: instance,
      messageDateTime: Math.floor(Date.now() / 1000),
      devicePhone: instance,
      senderName: String(data.pushName || ""),
      senderPhone: phone,
      message: text,
      ruleName: rule.name,
      keyword: rule.keyword
    };
    let providerResponse: unknown = null;
    let reply = "";
    if (["webhook", "url", "external_webhook", "server"].includes(actionType)) {
      providerResponse = await callExternalWebhook(rule, webhookPayload);
      reply = responseToText(providerResponse, String(rule.reply_template || ""), { name: firstName(data.pushName), inbound: webhookPayload, api: typeof providerResponse === "object" ? providerResponse : { text: providerResponse } });
    } else if (!rule.action?.type || actionType === "reply") {
      reply = renderTemplate(String(rule.reply_template), { name: firstName(data.pushName), inbound: webhookPayload });
    } else {
      console.warn("Blocked unsupported automation action", rule.action.type);
      return new Response(null, { status: 204 });
    }
    if (!reply.trim()) return new Response(null, { status: 204 });
    const result = await send(instance, phone, reply);
    await logOutbound(device, messageId, phone, reply, { whatsapp: result, webhook: providerResponse });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Evolution webhook error", error);
    return json({ error: "Falha ao processar webhook" }, 500);
  }
};
export const config: Config = { path: "/api/evolution/webhook", method: "POST" };
