export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export const requiredEnv = (name: string) => {
  const value = Netlify.env.get(name);
  if (!value) throw new Error(`Variável ausente: ${name}`);
  return value;
};
