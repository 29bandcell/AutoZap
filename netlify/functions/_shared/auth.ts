import { requiredEnv } from "./http.ts";
import { supabase } from "./supabase.ts";

export type AuthContext = {
  user: { id: string; email?: string };
  profile: { id: string; tenant_id: string; full_name: string; role: string };
};

export async function requireTenantUser(req: Request): Promise<AuthContext> {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) throw new Response(JSON.stringify({ error: "Autenticação obrigatória" }), { status: 401, headers: { "content-type": "application/json" } });
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Response(JSON.stringify({ error: "Sessão inválida ou expirada" }), { status: 401, headers: { "content-type": "application/json" } });
  const user = await response.json();
  const profiles = await supabase(`profiles?id=eq.${encodeURIComponent(user.id)}&select=id,tenant_id,full_name,role&limit=1`);
  if (!profiles?.length) throw new Response(JSON.stringify({ error: "Conta ainda não configurada", code: "ONBOARDING_REQUIRED" }), { status: 409, headers: { "content-type": "application/json" } });
  return { user, profile: profiles[0] };
}

export function authError(error: unknown) {
  return error instanceof Response ? error : null;
}
