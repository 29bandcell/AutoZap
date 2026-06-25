import { requiredEnv } from "./http.ts";
const encoder = new TextEncoder();
export async function hashSecret(secret: string) {
  const pepper = Netlify.env.get("APP_KEY_PEPPER") || requiredEnv("AUTOMATION_SECRET");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${secret}:${pepper}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function randomSecret(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${token}`;
}
export function constantTimeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}
