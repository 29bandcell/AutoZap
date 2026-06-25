import type { Config, Context } from "@netlify/functions";
import { json } from "./_shared/http.ts";
import { authError, requireTenantUser } from "./_shared/auth.ts";
import { supabase } from "./_shared/supabase.ts";

const clean = (value: unknown, max = 200) => String(value || "").trim().slice(0, max);
const method = (value: unknown) => String(value || "POST").toUpperCase() === "GET" ? "GET" : "POST";
const status = (value: unknown) => String(value || "active").toLowerCase() === "paused" ? "paused" : "active";
const normalizeMode = (value: unknown) => String(value || "links").toLowerCase() === "api" ? "api" : "links";
const normalizeAuth = (value: unknown) => {
  const auth = String(value || "none").toLowerCase();
  return ["none", "bearer", "apikey", "basic"].includes(auth) ? auth : "none";
};
const assertExternalUrl = (value: string) => {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("URL deve iniciar com http ou https");
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname)) throw new Error("URL local não é permitida em produção");
  return parsed.toString();
};

async function getPayload(tenantId: string) {
  const [integration] = await supabase(`iptv_integrations?tenant_id=eq.${tenantId}&select=id,name,mode,api_base_url,auth_type,notes,status,created_at,updated_at&limit=1`);
  const packages = await supabase(`iptv_test_packages?tenant_id=eq.${tenantId}&select=id,integration_id,device_id,package_name,keyword,method,url,status,created_at,updated_at&order=created_at.desc`);
  return { integration: integration || null, packages: packages || [] };
}

export default async (req: Request, context: Context) => {
  try {
    const { profile } = await requireTenantUser(req);
    const tenantId = profile.tenant_id;
    const id = context.params.id;

    if (req.method === "GET") return json({ data: await getPayload(tenantId) });

    if (req.method === "POST" && !id) {
      const body = await req.json();
      const integration = body.integration || body;
      const current = await supabase(`iptv_integrations?tenant_id=eq.${tenantId}&select=id&limit=1`);
      const payload = {
        tenant_id: tenantId,
        name: clean(integration.name, 100),
        mode: normalizeMode(integration.mode),
        api_base_url: clean(integration.apiBaseUrl || integration.api_base_url, 500) || null,
        auth_type: normalizeAuth(integration.authType || integration.auth_type),
        notes: clean(integration.notes, 2000) || null,
        status: status(integration.status)
      };
      if (payload.api_base_url) payload.api_base_url = assertExternalUrl(payload.api_base_url);
      if (current?.length) await supabase(`iptv_integrations?id=eq.${current[0].id}&tenant_id=eq.${tenantId}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await supabase("iptv_integrations", { method: "POST", body: JSON.stringify(payload) });
      return json({ ok: true, data: await getPayload(tenantId) });
    }

    if (req.method === "POST" && id === "packages") {
      const body = await req.json();
      const url = assertExternalUrl(clean(body.url, 1000));
      const [integration] = await supabase(`iptv_integrations?tenant_id=eq.${tenantId}&select=id&limit=1`);
      const payload = {
        tenant_id: tenantId,
        integration_id: integration?.id || null,
        device_id: clean(body.deviceId || body.device_id, 80) || null,
        package_name: clean(body.packageName || body.package_name, 140),
        keyword: clean(body.keyword, 120),
        method: method(body.method),
        url,
        status: status(body.status)
      };
      if (!payload.package_name || !payload.keyword) return json({ error: "Nome do pacote e palavra-chave são obrigatórios" }, 400);
      const [created] = await supabase("iptv_test_packages", { method: "POST", body: JSON.stringify(payload) });
      return json({ ok: true, data: created }, 201);
    }

    if (req.method === "PATCH" && id) {
      const body = await req.json();
      const payload: Record<string, unknown> = {};
      if (body.packageName || body.package_name) payload.package_name = clean(body.packageName || body.package_name, 140);
      if (body.keyword) payload.keyword = clean(body.keyword, 120);
      if (body.method) payload.method = method(body.method);
      if (body.url) payload.url = assertExternalUrl(clean(body.url, 1000));
      if (body.status) payload.status = status(body.status);
      payload.updated_at = new Date().toISOString();
      await supabase(`iptv_test_packages?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`, { method: "PATCH", body: JSON.stringify(payload) });
      return json({ ok: true });
    }

    if (req.method === "DELETE" && id) {
      await supabase(`iptv_test_packages?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`, { method: "DELETE" });
      return json({ ok: true });
    }

    return json({ error: "Método não permitido" }, 405);
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    console.error("IPTV integration error", error);
    const message = error instanceof Error ? error.message : "Não foi possível processar a integração IPTV";
    return json({ error: message }, 500);
  }
};

export const config: Config = { path: ["/api/iptv-integrations", "/api/iptv-integrations/:id", "/api/iptv-integrations/packages"], method: ["GET", "POST", "PATCH", "DELETE"] };
