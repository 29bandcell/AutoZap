import type { Config } from "@netlify/functions";
import { requiredEnv } from "./_shared/http.ts";
import { supabase } from "./_shared/supabase.ts";

export default async () => {
  const due = await supabase(`scheduled_messages?status=eq.pending&scheduled_for=lte.${encodeURIComponent(new Date().toISOString())}&select=id,tenant_id,device_id,contact_id,phone,message,idempotency_key,attempt_count&order=scheduled_for.asc&limit=20`);
  for (const item of due || []) {
    const claimed = await supabase(`scheduled_messages?id=eq.${item.id}&status=eq.pending`, { method: "PATCH", body: JSON.stringify({ status: "processing", attempt_count: item.attempt_count + 1 }) });
    if (!claimed?.length) continue;
    let event: any = null;
    try {
      const blocked = await supabase(`contacts?tenant_id=eq.${item.tenant_id}&phone=eq.${item.phone}&opted_out_at=not.is.null&select=id&limit=1`);
      if (blocked?.length) throw new Error("Contato não autorizou novas mensagens");
      const [device] = await supabase(`devices?id=eq.${item.device_id}&tenant_id=eq.${item.tenant_id}&select=id,instance_name&limit=1`);
      if (!device) throw new Error("Dispositivo indisponível");
      [event] = await supabase("message_events", { method: "POST", body: JSON.stringify({ tenant_id: item.tenant_id, device_id: device.id, dedupe_key: `scheduled:${item.idempotency_key}`, external_request_id: item.idempotency_key, phone: item.phone, message: item.message, status: "processing" }) });
      const response = await fetch(`${requiredEnv("EVOLUTION_API_URL").replace(/\/$/, "")}/message/sendText/${encodeURIComponent(device.instance_name)}`, { method: "POST", headers: { apikey: requiredEnv("EVOLUTION_API_KEY"), "content-type": "application/json" }, body: JSON.stringify({ number: item.phone.replace(/\D/g, ""), text: item.message }) });
      const responseText = await response.text();
      if (!response.ok) throw new Error(`Evolution respondeu ${response.status}`);
      let providerResponse: unknown = null;
      try { providerResponse = responseText ? JSON.parse(responseText) : null; } catch {}
      await supabase(`message_events?id=eq.${event.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent", provider_response: providerResponse, sent_at: new Date().toISOString() }) });
      await supabase(`scheduled_messages?id=eq.${item.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), last_error: null }) });
    } catch (error) {
      if (event) { try { await supabase(`message_events?id=eq.${event.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error_message: "Falha no envio agendado" }) }); } catch {} }
      const attempts = item.attempt_count + 1;
      await supabase(`scheduled_messages?id=eq.${item.id}`, { method: "PATCH", body: JSON.stringify({ status: attempts >= 3 ? "failed" : "pending", scheduled_for: attempts >= 3 ? claimed[0].scheduled_for : new Date(Date.now() + attempts * 5 * 60_000).toISOString(), last_error: error instanceof Error ? error.message.slice(0, 300) : "Falha desconhecida" }) });
    }
  }
  return new Response(null, { status: 204 });
};
export const config: Config = { schedule: "* * * * *" };
