import type { Config } from "@netlify/functions";
import { json, requiredEnv } from "./_shared/http.ts";
import { supabase } from "./_shared/supabase.ts";

async function currentUser(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("AUTH_REQUIRED");
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/auth/v1/user`, { headers: { apikey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("AUTH_INVALID");
  return response.json();
}
const slugify = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  try {
    const user = await currentUser(req);
    const existing = await supabase(`profiles?id=eq.${encodeURIComponent(user.id)}&select=id,tenant_id,full_name,role&limit=1`);
    if (existing?.length) return json({ ok: true, profile: existing[0], existing: true });
    const body = await req.json();
    const companyName = String(body.companyName || "").trim().slice(0, 80);
    const fullName = String(body.fullName || user.email?.split("@")[0] || "Administrador").trim().slice(0, 80);
    if (companyName.length < 3) return json({ error: "Informe o nome da empresa" }, 400);
    let tenants = await supabase(`tenants?owner_id=eq.${encodeURIComponent(user.id)}&select=id,name,status&limit=1`);
    if (!tenants?.length) {
      const trialEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      tenants = await supabase("tenants", { method: "POST", body: JSON.stringify({ name: companyName, owner_id: user.id, slug: `${slugify(companyName)}-${crypto.randomUUID().slice(0, 8)}`, status: "trial", trial_ends_at: trialEndsAt }) });
      await supabase("tenant_subscriptions", { method: "POST", body: JSON.stringify({ tenant_id: tenants[0].id, plan_code: "starter", status: "trial", trial_started_at: new Date().toISOString(), trial_ends_at: trialEndsAt }) });
    }
    const [profile] = await supabase("profiles", { method: "POST", body: JSON.stringify({ id: user.id, tenant_id: tenants[0].id, full_name: fullName, role: "owner" }) });
    return json({ ok: true, profile, tenant: tenants[0] }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "AUTH_REQUIRED" || message === "AUTH_INVALID") return json({ error: "Sessão inválida" }, 401);
    console.error("Onboarding error", error);
    return json({ error: "Não foi possível configurar a conta" }, 500);
  }
};
export const config: Config = { path: "/api/onboarding", method: "POST" };

