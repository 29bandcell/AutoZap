import type { Config, Context } from "@netlify/functions";
import { json } from "./_shared/http.ts";
import { authError, requireTenantUser } from "./_shared/auth.ts";
import { supabase } from "./_shared/supabase.ts";

const clean = (value: unknown, max = 500) => String(value || "").trim().slice(0, max);
const matchType = (value: unknown) => {
  const raw = clean(value, 40).toLowerCase();
  if (raw.includes("cont")) return "contains";
  if (raw.includes("come") || raw.includes("start")) return "starts_with";
  if (raw.includes("regex")) return "regex";
  return "exact";
};
const uiMatch = (value: unknown) => ({ contains: "Contém", starts_with: "Começa com", regex: "Regex", exact: "Frase exata" }[String(value)] || "Frase exata");
const isWebhook = (value: unknown) => /url|webhook|servidor/i.test(String(value || ""));

async function firstDevice(tenantId: string, deviceId?: string) {
  const query = deviceId
    ? `devices?id=eq.${encodeURIComponent(deviceId)}&tenant_id=eq.${tenantId}&select=id&limit=1`
    : `devices?tenant_id=eq.${tenantId}&select=id&order=created_at.asc&limit=1`;
  const [device] = await supabase(query);
  return device?.id;
}

const serializeRule = (rule: any) => ({
  id: rule.id,
  name: rule.name,
  keyword: rule.keyword,
  match: uiMatch(rule.match_type),
  responseType: ["webhook", "url", "external_webhook", "server"].includes(String(rule.action?.type || "")) ? "URL / Servidor externo / Webhook" : "Texto",
  method: rule.action?.method || "POST",
  webhookUrl: rule.action?.url || rule.action?.webhook_url || rule.action?.endpoint || "",
  action: rule.action,
  reply: rule.reply_template,
  active: !!rule.enabled,
  deviceId: rule.device_id
});

export default async (req: Request, context: Context) => {
  try {
    const { profile } = await requireTenantUser(req);
    const tenantId = profile.tenant_id;
    const id = context.params.id;

    if (req.method === "GET") {
      const rows = await supabase(`automation_rules?tenant_id=eq.${tenantId}&select=id,device_id,name,keyword,match_type,action,reply_template,enabled,priority,created_at,updated_at&order=priority.asc,created_at.desc`);
      return json({ data: (rows || []).map(serializeRule) });
    }

    if (req.method === "DELETE" && id) {
      await supabase(`automation_rules?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`, { method: "DELETE" });
      return json({ ok: true });
    }

    if (!["POST", "PATCH"].includes(req.method)) return json({ error: "Método não permitido" }, 405);
    const body = await req.json();
    const deviceId = await firstDevice(tenantId, clean(body.deviceId || body.device_id, 80));
    if (!deviceId) return json({ error: "Crie/conecte um dispositivo WhatsApp antes de criar regras" }, 400);
    const responseType = clean(body.responseType || body.response_type, 100);
    const webhookUrl = clean(body.webhookUrl || body.webhook_url, 1000);
    const payload = {
      tenant_id: tenantId,
      device_id: deviceId,
      name: clean(body.name, 120),
      keyword: clean(body.keyword, 120),
      match_type: matchType(body.match || body.match_type),
      action: isWebhook(responseType) ? { type: "webhook", method: clean(body.method, 10).toUpperCase() === "GET" ? "GET" : "POST", url: webhookUrl } : { type: "reply" },
      reply_template: clean(body.reply || body.reply_template, 4000),
      enabled: body.active === false || body.enabled === false ? false : true,
      priority: Number(body.priority || 100)
    };
    if (!payload.name || !payload.keyword) return json({ error: "Nome e palavra-chave são obrigatórios" }, 400);
    if (isWebhook(responseType) && !webhookUrl) return json({ error: "Informe a URL do webhook/pacote" }, 400);

    if (req.method === "PATCH" && id) {
      const [updated] = await supabase(`automation_rules?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`, { method: "PATCH", body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }) });
      return json({ ok: true, data: serializeRule(updated) });
    }

    const [created] = await supabase("automation_rules", { method: "POST", body: JSON.stringify(payload) });
    return json({ ok: true, data: serializeRule(created) }, 201);
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    console.error("Automation rules error", error);
    return json({ error: error instanceof Error ? error.message : "Não foi possível processar a regra" }, 500);
  }
};

export const config: Config = { path: ["/api/automation-rules", "/api/automation-rules/:id"], method: ["GET", "POST", "PATCH", "DELETE"] };
