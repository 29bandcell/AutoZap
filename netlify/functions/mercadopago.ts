import type { Config, Context } from "@netlify/functions";
import { json } from "./_shared/http.ts";
import { authError, requireTenantUser } from "./_shared/auth.ts";
import { supabase } from "./_shared/supabase.ts";

type PlanCode = "starter" | "pro" | "agency";

type Plan = {
  code: PlanCode;
  name: string;
  amount: number;
  max_devices: number;
  max_apps: number;
  monthly_message_limit: number;
};

const plans: Record<PlanCode, Plan> = {
  starter: { code: "starter", name: "AutoZap Starter", amount: 39.9, max_devices: 1, max_apps: 1, monthly_message_limit: 1000 },
  pro: { code: "pro", name: "AutoZap Profissional", amount: 59.9, max_devices: 3, max_apps: 3, monthly_message_limit: 5000 },
  agency: { code: "agency", name: "AutoZap Agência", amount: 137.9, max_devices: 10, max_apps: 10, monthly_message_limit: 25000 }
};

const mpToken = () => {
  const mode = (Netlify.env.get("MERCADOPAGO_MODE") || "production").toLowerCase();
  if (mode === "test") return Netlify.env.get("MERCADOPAGO_TEST_ACCESS_TOKEN") || Netlify.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
  return Netlify.env.get("MERCADOPAGO_ACCESS_TOKEN") || Netlify.env.get("MERCADOPAGO_TEST_ACCESS_TOKEN") || "";
};

const siteUrl = (req: Request) => (Netlify.env.get("SITE_URL") || Netlify.env.get("URL") || new URL(req.url).origin).replace(/\/$/, "");

async function mercadoPago(path: string, init: RequestInit = {}) {
  const token = mpToken();
  if (!token) throw new Error("Variável MERCADOPAGO_ACCESS_TOKEN ausente");
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Mercado Pago ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

function parsePlan(value: unknown): Plan {
  const code = String(value || "starter").toLowerCase() as PlanCode;
  return plans[code] || plans.starter;
}

function parseExternalReference(value: unknown) {
  const [tenantId, planCode] = String(value || "").split(":");
  if (!tenantId || !plans[planCode as PlanCode]) return null;
  return { tenantId, plan: plans[planCode as PlanCode] };
}

function statusFromPreapproval(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (["authorized", "active"].includes(normalized)) return "active";
  if (["paused", "suspended"].includes(normalized)) return "suspended";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["rejected"].includes(normalized)) return "past_due";
  return "trial";
}

function statusFromPayment(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "approved") return "active";
  if (["rejected", "cancelled", "canceled", "refunded", "charged_back"].includes(normalized)) return "past_due";
  return "trial";
}

async function upsertSubscription(params: { tenantId: string; plan: Plan; status: string; externalSubscriptionId?: string | null; providerResponse?: unknown }) {
  const now = new Date().toISOString();
  await supabase(`tenants?id=eq.${encodeURIComponent(params.tenantId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      plan_code: params.plan.code,
      status: params.status,
      max_devices: params.plan.max_devices,
      max_apps: params.plan.max_apps,
      monthly_message_limit: params.plan.monthly_message_limit,
      updated_at: now
    })
  });
  const existing = await supabase(`tenant_subscriptions?tenant_id=eq.${encodeURIComponent(params.tenantId)}&select=id&limit=1`);
  const payload = {
    tenant_id: params.tenantId,
    provider: "mercadopago",
    external_subscription_id: params.externalSubscriptionId || null,
    plan_code: params.plan.code,
    status: params.status,
    current_period_started_at: params.status === "active" ? now : null,
    cancelled_at: ["cancelled", "suspended"].includes(params.status) ? now : null,
    updated_at: now
  };
  if (existing?.length) {
    await supabase(`tenant_subscriptions?id=eq.${existing[0].id}`, { method: "PATCH", body: JSON.stringify(payload) });
  } else {
    await supabase("tenant_subscriptions", { method: "POST", body: JSON.stringify({ ...payload, trial_started_at: now, trial_ends_at: new Date(Date.now() + 3 * 86400000).toISOString() }) });
  }
}

async function checkout(req: Request) {
  const { user, profile } = await requireTenantUser(req);
  const body = await req.json().catch(() => ({}));
  const plan = parsePlan(body.planCode);
  const baseUrl = siteUrl(req);
  const payload = {
    reason: plan.name,
    external_reference: `${profile.tenant_id}:${plan.code}`,
    payer_email: user.email,
    back_url: `${baseUrl}/#planos`,
    notification_url: `${baseUrl}/api/mercadopago/webhook`,
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: plan.amount,
      currency_id: "BRL"
    },
    status: "pending"
  };
  const mp = await mercadoPago("/preapproval", { method: "POST", body: JSON.stringify(payload) });
  await upsertSubscription({ tenantId: profile.tenant_id, plan, status: "trial", externalSubscriptionId: mp.id, providerResponse: mp });
  return json({ data: { id: mp.id, plan: plan.code, checkoutUrl: mp.init_point || mp.sandbox_init_point, sandboxCheckoutUrl: mp.sandbox_init_point } });
}

function getSignatureParts(header: string) {
  return Object.fromEntries(header.split(",").map(part => part.trim().split("=")).filter(item => item.length === 2));
}

async function hmacHex(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function validateWebhook(req: Request, body: any) {
  const secret = Netlify.env.get("MERCADOPAGO_WEBHOOK_SECRET");
  if (!secret) return true;
  const xSignature = req.headers.get("x-signature") || "";
  const xRequestId = req.headers.get("x-request-id") || "";
  const dataId = body?.data?.id || new URL(req.url).searchParams.get("data.id") || new URL(req.url).searchParams.get("id") || "";
  if (!xSignature || !xRequestId || !dataId) return false;
  const parts = getSignatureParts(xSignature);
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${parts.ts};`;
  const expected = await hmacHex(secret, manifest);
  return expected === parts.v1;
}

async function fetchResource(type: string, id: string) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("authorized_payment")) return mercadoPago(`/authorized_payments/${encodeURIComponent(id)}`);
  if (normalized.includes("payment")) return mercadoPago(`/v1/payments/${encodeURIComponent(id)}`);
  if (normalized.includes("preapproval")) return mercadoPago(`/preapproval/${encodeURIComponent(id)}`);
  try { return await mercadoPago(`/preapproval/${encodeURIComponent(id)}`); } catch { return null; }
}

async function webhook(req: Request) {
  const body = await req.json().catch(() => ({}));
  const valid = await validateWebhook(req, body);
  if (!valid) return json({ error: "Assinatura inválida" }, 401);
  const url = new URL(req.url);
  const eventType = body.type || body.topic || url.searchParams.get("type") || url.searchParams.get("topic") || "";
  const id = body?.data?.id || url.searchParams.get("data.id") || url.searchParams.get("id");
  if (!id) return json({ ok: true, ignored: "missing_id" });
  let resource: any = await fetchResource(eventType, String(id));
  if (!resource) return json({ ok: true, ignored: "unknown_resource" });
  if (String(eventType).includes("payment") && resource.preapproval_id) {
    try {
      const preapproval = await mercadoPago(`/preapproval/${encodeURIComponent(resource.preapproval_id)}`);
      resource = { ...resource, preapproval, external_reference: resource.external_reference || preapproval.external_reference };
    } catch {}
  }
  const ref = parseExternalReference(resource.external_reference || resource.preapproval?.external_reference);
  if (!ref) return json({ ok: true, ignored: "missing_external_reference", eventType, id });
  const status = String(eventType).includes("payment") ? statusFromPayment(resource.status) : statusFromPreapproval(resource.status);
  await upsertSubscription({ tenantId: ref.tenantId, plan: ref.plan, status, externalSubscriptionId: resource.id || resource.preapproval_id, providerResponse: resource });
  return json({ ok: true, tenantId: ref.tenantId, plan: ref.plan.code, status });
}

export default async (req: Request, context: Context) => {
  try {
    const action = context.params.action;
    if (action === "checkout") {
      if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
      return checkout(req);
    }
    if (action === "webhook") {
      if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
      return webhook(req);
    }
    return json({ error: "Rota não encontrada" }, 404);
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    console.error("Mercado Pago error", error);
    return json({ error: error instanceof Error ? error.message : "Falha na integração Mercado Pago" }, 500);
  }
};

export const config: Config = { path: "/api/mercadopago/:action" };
