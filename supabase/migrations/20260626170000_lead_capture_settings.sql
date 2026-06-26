alter table public.tenants
  add column if not exists lead_capture_enabled boolean not null default true,
  add column if not exists lead_greeting_template text not null default 'Olá, que bom te ter aqui!

Sou {{company_name}}. 🙍‍♂️

🔸Em qual aparelho irá testar?

Aguardo sua resposta 🤓

1 - TV Box
2 - Celular
3 - Chromecast
4 - Computador
5 - Smart TV
6 - Amazon Fire Stick',
  add column if not exists lead_followup_template text not null default 'Digite ''{{keyword}}'' para receber um teste gratuito.';

alter table public.contacts
  add column if not exists metadata jsonb not null default '{}'::jsonb;
