import type { Config } from "@netlify/functions";
import { json } from "./_shared/http.ts";
import { authError, requireTenantUser } from "./_shared/auth.ts";
import { supabase } from "./_shared/supabase.ts";

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

const cleanText = (value: unknown, fallback: string, max = 4000) => {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, max);
};

export default async (req: Request) => {
  try {
    const { profile } = await requireTenantUser(req);
    const tenantId = profile.tenant_id;
    if (req.method === "GET") {
      const [tenant] = await supabase(`tenants?id=eq.${tenantId}&select=lead_capture_enabled,lead_greeting_template,lead_followup_template&limit=1`);
      return json({ data: tenant || null });
    }
    if (req.method !== "PATCH") return json({ error: "Método não permitido" }, 405);

    const body = await req.json().catch(() => ({}));
    const payload = {
      lead_capture_enabled: body.lead_capture_enabled !== false,
      lead_greeting_template: cleanText(body.lead_greeting_template, DEFAULT_GREETING),
      lead_followup_template: cleanText(body.lead_followup_template, DEFAULT_FOLLOWUP, 1200),
      updated_at: new Date().toISOString()
    };
    const [tenant] = await supabase(`tenants?id=eq.${tenantId}`, { method: "PATCH", body: JSON.stringify(payload) });
    return json({ data: tenant || payload });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    console.error("Tenant settings error", error);
    return json({ error: "Não foi possível salvar as configurações" }, 500);
  }
};

export const config: Config = { path: "/api/tenant-settings" };
