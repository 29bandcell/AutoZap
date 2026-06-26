import type { Config } from "@netlify/functions";
import { json } from "./_shared/http.ts";
import { authError, requireTenantUser } from "./_shared/auth.ts";
import { supabase, supabaseCount } from "./_shared/supabase.ts";

const monthStartIso = () => {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
};

export default async (req: Request) => {
  try {
    if (req.method !== "GET") return json({ error: "Método não permitido" }, 405);
    const { profile } = await requireTenantUser(req);
    const tenantId = profile.tenant_id;
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 80), 1), 200);
    const from = url.searchParams.get("from");
    const direction = url.searchParams.get("direction");
    const filters = [
      `tenant_id=eq.${tenantId}`,
      "select=id,device_id,api_app_id,external_request_id,phone,message,direction,message_type,status,provider_response,error_message,sent_at,created_at",
      "order=created_at.desc",
      `limit=${limit}`
    ];
    if (from) filters.push(`created_at=gte.${encodeURIComponent(from)}`);
    if (direction) filters.push(`direction=eq.${encodeURIComponent(direction)}`);
    const events = await supabase(`message_events?${filters.join("&")}`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [todayTotal, monthOutbound, monthFailed] = await Promise.all([
      supabaseCount(`message_events?tenant_id=eq.${tenantId}&created_at=gte.${encodeURIComponent(today.toISOString())}&select=id`),
      supabaseCount(`message_events?tenant_id=eq.${tenantId}&direction=eq.outbound&status=eq.sent&created_at=gte.${encodeURIComponent(monthStartIso())}&select=id`),
      supabaseCount(`message_events?tenant_id=eq.${tenantId}&status=eq.failed&created_at=gte.${encodeURIComponent(monthStartIso())}&select=id`)
    ]);
    return json({ data: events || [], summary: { todayTotal, monthOutbound, monthFailed } });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    console.error("Message events error", error);
    return json({ error: "Não foi possível carregar os logs" }, 500);
  }
};

export const config: Config = { path: "/api/message-events", method: "GET" };
