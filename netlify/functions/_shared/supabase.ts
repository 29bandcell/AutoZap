import { requiredEnv } from "./http.ts";
const headers = () => { const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY"); return { apikey: key, authorization: `Bearer ${key}` }; };
export async function supabase(path: string, init: RequestInit = {}) {
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/rest/v1/${path}`, { ...init, headers: { ...headers(), "content-type": "application/json", prefer: "return=representation", ...init.headers } });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
export async function supabaseCount(path: string) {
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/rest/v1/${path}`, { method: "HEAD", headers: { ...headers(), prefer: "count=exact", range: "0-0" } });
  if (!response.ok) throw new Error(`Supabase count ${response.status}`);
  const contentRange = response.headers.get("content-range") || "0/0";
  return Number(contentRange.split("/")[1] || 0);
}
