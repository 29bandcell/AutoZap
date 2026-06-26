import type { Config } from "@netlify/functions";
import { json } from "./_shared/http.ts";
import { authError, requireTenantUser } from "./_shared/auth.ts";
import { supabase } from "./_shared/supabase.ts";

export default async (req: Request) => {
  try {
    if (req.method !== "GET") return json({ error: "Método não permitido" }, 405);
    const { profile } = await requireTenantUser(req);
    const tenantId = profile.tenant_id;
    const [tenant] = await supabase(`tenants?id=eq.${tenantId}&select=id,name,slug,status,plan_code,trial_ends_at,max_devices,max_apps,monthly_message_limit&limit=1`);
    const [subscription] = await supabase(`tenant_subscriptions?tenant_id=eq.${tenantId}&select=id,plan_code,status,trial_started_at,trial_ends_at,current_period_started_at,current_period_ends_at,cancelled_at&limit=1`);
    const now = Date.now();
    const trialEndsAt = subscription?.trial_ends_at || tenant?.trial_ends_at;
    const trialMsLeft = trialEndsAt ? new Date(trialEndsAt).getTime() - now : 0;
    return json({
      data: {
        tenant,
        profile: { id: profile.id, full_name: profile.full_name, role: profile.role },
        subscription,
        access: {
          allowed: ["trial", "active"].includes(String(subscription?.status || tenant?.status || "")) && (!trialEndsAt || trialMsLeft > 0 || String(subscription?.status || tenant?.status) === "active"),
          trialDaysLeft: Math.max(0, Math.ceil(trialMsLeft / 86400000))
        }
      }
    });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    console.error("Account error", error);
    return json({ error: "Não foi possível carregar a conta" }, 500);
  }
};

export const config: Config = { path: "/api/account", method: "GET" };


