# AutoZap — motor de automação WhatsApp + IPTV

Produto SaaS multiempresa que conecta o painel IPTV do cliente ao WhatsApp pela Evolution API. Ele não cria nem renova usuários IPTV por conta própria: recebe o evento do painel provedor, valida as credenciais da integração e envia a mensagem ao telefone do assinante.

## O que já está implementado

- cadastro, login e onboarding com Supabase Auth;
- isolamento de empresas por tenant_id e RLS;
- planos, período de teste e limites de dispositivos, aplicativos e mensagens;
- criação de instância Evolution API e leitura do QR Code;
- App Key e Auth Key independentes por cliente, exibidas somente uma vez e armazenadas como hash;
- endpoint POST /api/iptv/send com idempotência, limite mensal, opt-out e auditoria;
- agendador de mensagens com tentativas controladas;
- webhook para conexão, mensagens recebidas, opt-out e regras automáticas;
- histórico de eventos e estrutura de contatos, grupos, templates e regras;
- cabeçalhos de segurança e bloqueio de cache nas APIs.

O painel visual funciona em modo demonstração sem credenciais. Em produção, dispositivos e aplicativos passam a usar o backend real. As outras telas ainda precisam receber o CRUD remoto antes de serem oferecidas como recursos comerciais completos.

## Arquitetura

Painel IPTV -> POST /api/iptv/send -> autenticação -> limite/opt-out/idempotência -> Evolution API -> WhatsApp

O painel IPTV deve permitir cadastrar uma URL de integração própria. Se o provedor mantiver a URL do BotBot fixa no servidor dele, será necessário solicitar um conector personalizado ao provedor; isso não pode ser alterado apenas pelo navegador.

## Preparação do Supabase

1. Crie um projeto Supabase.
2. Execute, na ordem, as migrations de supabase/migrations.
3. Em Authentication, habilite cadastro por e-mail e configure a URL do site.
4. Copie config.example.js para config.js e informe somente a URL e a chave publicável.
5. Guarde a service_role exclusivamente nas variáveis protegidas do Netlify.

A migration cria as tabelas, índices, permissões e políticas RLS necessárias.

## Variáveis do Netlify

Use .env.example como referência. Obrigatórias:

SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=segredo
EVOLUTION_API_URL=https://SEU-SERVIDOR-EVOLUTION
EVOLUTION_API_KEY=segredo
EVOLUTION_INTEGRATION=WHATSAPP-BAILEYS
EVOLUTION_WEBHOOK_SECRET=segredo-aleatorio
APP_KEY_PEPPER=segredo-aleatorio
AUTOMATION_SECRET=segredo-aleatorio
PUBLIC_SITE_URL=https://SEU-SITE.netlify.app
SITE_URL=https://SEU-SITE.netlify.app
AUTOZAP_ADMIN_EMAILS=admin@seudominio.com
MERCADOPAGO_MODE=production
MERCADOPAGO_ACCESS_TOKEN=APP_USR-...
MERCADOPAGO_PUBLIC_KEY=APP_USR-...
MERCADOPAGO_WEBHOOK_SECRET=assinatura_secreta_do_webhook
MERCADOPAGO_TEST_ACCESS_TOKEN=TEST-...
MERCADOPAGO_TEST_PUBLIC_KEY=TEST-...

Nunca coloque SUPABASE_SERVICE_ROLE_KEY, EVOLUTION_API_KEY, peppers ou segredos em config.js, Git ou no navegador.


## Mercado Pago

A integração de cobrança usa assinaturas recorrentes do Mercado Pago.

Endpoints criados:

- POST /api/mercadopago/checkout — cria a assinatura do plano escolhido e retorna/redireciona para o link de pagamento.
- POST /api/mercadopago/webhook — recebe eventos de pagamentos e planos/assinaturas e atualiza tenant_subscriptions/tenants no Supabase.

Configure no Mercado Pago o webhook:

https://SEU-SITE.netlify.app/api/mercadopago/webhook

Eventos recomendados:

- Pagamentos
- Planos e assinaturas

O webhook valida a assinatura secreta quando MERCADOPAGO_WEBHOOK_SECRET estiver configurado.
## Endpoint para o painel IPTV

POST https://SEU-SITE.netlify.app/api/iptv/send
x-app-key: APP_KEY_GERADA_NO_PAINEL
x-auth-key: AUTH_KEY_GERADA_NO_PAINEL
idempotency-key: ID_UNICO_DO_EVENTO
content-type: application/json

Corpo JSON:
{ "number": "5521900000000", "text": "Sua assinatura vence amanhã." }

O número deve ter DDI e DDD. O idempotency-key deve ser único por evento para impedir envio duplicado.

## Publicação

npm ci
npm run check
netlify deploy
netlify deploy --prod

Antes do primeiro cliente:

- aplicar as migrations em um Supabase real;
- configurar todas as variáveis protegidas;
- apontar o webhook da Evolution para /api/evolution/webhook com o segredo;
- testar QR Code, envio, duplicidade, opt-out e reconexão;
- definir política de privacidade, termos, retenção de logs e suporte;
- implantar cobrança e bloqueio por inadimplência;
- concluir as telas remotas de regras, templates, contatos, agendamentos e logs;
- configurar monitoramento, backup e alertas.

## Segurança operacional

Credenciais publicadas anteriormente em capturas, chat ou DevTools devem ser revogadas e substituídas. Cada cliente deve usar um aplicativo próprio; nunca compartilhe uma App/Auth Key entre empresas.


