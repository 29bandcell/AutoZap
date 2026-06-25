# Deploy do AutoZap no Netlify

## 1. Conferir banco Supabase

As tabelas já devem existir no Supabase:

- tenants
- profiles
- tenant_subscriptions
- devices
- automation_rules
- iptv_integrations
- iptv_test_packages
- message_events

## 2. Configurar o frontend público

Edite `config.js` antes do deploy de produção:

```js
window.APP_CONFIG = {
  mode: "production",
  supabaseUrl: "https://SEU-PROJETO.supabase.co",
  supabasePublishableKey: "SUA_CHAVE_PUBLICAVEL_DO_SUPABASE"
};
```

A chave publishable/anon do Supabase pode ficar no frontend. Nunca coloque service role ou chave Evolution no frontend.

## 3. Variáveis privadas no Netlify

No Netlify:

Site settings > Environment variables

Configure:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key_do_supabase
EVOLUTION_API_URL=https://bandcell-evolution-api.38nhhr.easypanel.host
EVOLUTION_API_KEY=sua_api_key_da_evolution
EVOLUTION_WEBHOOK_SECRET=crie_um_token_forte_para_o_webhook
EVOLUTION_INTEGRATION=WHATSAPP-BAILEYS
```

## 4. Deploy via CLI

Na pasta do projeto:

```powershell
cd C:\Users\Band_Cell\Documents\Codex\2026-06-22\onse\outputs\iptv-revenda
npx netlify login
npx netlify init
npx netlify deploy
npx netlify deploy --prod
```

O projeto já tem `netlify.toml` com:

- build command: `npm run build`
- publish directory: `.`
- functions directory: `netlify/functions`

## 5. Webhook da Evolution

Depois que o site estiver publicado, configure na Evolution API o webhook apontando para:

```text
https://SEU-SITE.netlify.app/api/evolution/webhook?token=SEU_EVOLUTION_WEBHOOK_SECRET
```

O token da URL deve ser exatamente o mesmo valor definido em `EVOLUTION_WEBHOOK_SECRET` no Netlify.

## 6. Teste final

1. Abra o site publicado.
2. Crie uma conta nova.
3. Confirme que a empresa ganha trial de 3 dias.
4. Crie dispositivo WhatsApp.
5. Leia o QR Code.
6. Cadastre URL de teste IPTV.
7. Clique em “Usar no chatbot”.
8. Envie a palavra-chave no WhatsApp conectado.
