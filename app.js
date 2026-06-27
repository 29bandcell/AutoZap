const app = document.querySelector('#app');
const title = document.querySelector('#page-title');
const modal = document.querySelector('#modal');
const modalContent = document.querySelector('#modal-content');

const titles = {
  dashboard: 'Dashboard',
  dispositivos: 'Dispositivos',
  chatbot: 'Chatbot',
  testes: 'Teste automático',
  paineliptv: 'Painel IPTV',
  testar: 'Testar chatbot',
  templates: 'Templates',
  contatos: 'Contatos',
  grupos: 'Grupos de contatos',
  agendamentos: 'Mensagens agendadas',
  enviar: 'Enviar mensagem',
  logs: 'Mensagens enviadas',
  integracoes: 'Apps e API',
  diagnosticos: 'Diagnósticos',
  planos: 'Planos e assinatura',
  admin: 'Admin AutoZap'
};

const demoTestUrls = [
  'https://painel.la/api/chatbot/2BDven9Lrk/Yj1tiB1Mjm',
  'https://painel.la/api/chatbot/2BDven9Lrk/nVWo8DKaN',
  'https://painel.la/api/chatbot/2BDven9Lrk/ANKWPKDPRq',
  'https://demonstracao.qpanel.top/api/chatbot/BV4D3rLaqZ/BV4D3rLaqZ'
];
const isDemoTestLink = link => demoTestUrls.includes(String(link?.url || ''));
const defaultLeadGreeting = `Olá, que bom te ter aqui!

Sou {{company_name}}. 🙍‍♂️

🔸Em qual aparelho irá testar?

Aguardo sua resposta 🤓

1 - TV Box
2 - Celular
3 - Chromecast
4 - Computador
5 - Smart TV
6 - Amazon Fire Stick`;
const defaultLeadFollowup = `Digite '{{keyword}}' para receber um teste gratuito.`;

const seed = {
  devices: [{ id: 'wa1', name: 'WhatsApp principal', phone: '+55 88 99999-0000', status: 'connected' }],
  apps: [],
  testLinks: [],
  iptvProvider: { mode: 'links', name: '', apiBaseUrl: '', authType: 'none', notes: 'Cliente cadastra seus links diretos de teste ou a API do provedor IPTV.' },
  leadCapture: { enabled: true, greeting: defaultLeadGreeting, followup: defaultLeadFollowup },
  rules: [{
      id: 'r2',
      name: 'Consultar vencimento',
      keyword: 'vencimento',
      match: 'Contém',
      responseType: 'Texto',
      method: 'POST',
      webhookUrl: '',
      action: 'Responder texto fixo/template',
      reply: 'Seu plano vence em {{expires_at}}. Para renovar, fale com o suporte.',
      active: true
    },
    {
      id: 'r3',
      name: 'Solicitar renovação',
      keyword: 'renovar',
      match: 'Frase exata',
      responseType: 'Webhook',
      method: 'POST',
      webhookUrl: '/api/iptv/renewal-request',
      action: 'Enviar pedido de renovação ao painel do provedor',
      reply: 'Recebi sua solicitação. Já vou te enviar o link de pagamento.',
      active: true
    }
  ],
  templates: [
    { name: 'Boas-vindas', type: 'Texto', content: 'Olá! Digite teste iptv para receber um teste automático.' },
    { name: 'Teste criado', type: 'API + texto', content: 'Usuário: {{username}} • Senha: {{password}} • Vencimento: {{expires_at}}' }
  ],
  contacts: [{ name: 'Contato de demonstração', phone: '+55 11 99999-1111', source: 'WhatsApp', last: 'Hoje, 14:32' }],
  logs: [
    { at: 'Hoje, 14:32', from: '+55 11 99999-1111', keyword: 'teste iptv', rule: 'Gerar teste IPTV', result: 'Enviado' },
    { at: 'Hoje, 13:18', from: '+55 21 98888-2222', keyword: 'vencimento', rule: 'Consultar vencimento', result: 'Enviado' }
  ],
  scheduled: []
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem('autozap-state'));
    if (!saved) return structuredClone(seed);
    return { ...structuredClone(seed), ...saved, testLinks: (saved.testLinks || []).filter(link => !isDemoTestLink(link)), rules: (saved.rules || seed.rules).filter(rule => !demoTestUrls.includes(String(rule?.webhookUrl || ''))), iptvProvider: { ...structuredClone(seed).iptvProvider, ...(saved.iptvProvider || {}) }, leadCapture: { ...structuredClone(seed).leadCapture, ...(saved.leadCapture || {}) } };
  } catch {
    return structuredClone(seed);
  }
}

let state = loadState();
const save = () => localStorage.setItem('autozap-state', JSON.stringify(state));
const defaultNavHtml = document.querySelector('#nav')?.innerHTML || '';
const route = () => location.hash.slice(1) || 'dashboard';
const effectiveRoute = () => state.account?.platformAdmin && ['dashboard', 'admin'].includes(route()) ? 'admin' : route();
const statusText = s => s === true ? 'Ativa' : s === false ? 'Pendente' : s === 'connected' ? 'Conectado' : s === 'open' ? 'Conectado' : s;
const badge = s => `<span class="badge ${s === 'Enviado' || s === 'connected' || s === 'open' || s === true || s === 'Ativo' ? 'active' : 'pending'}">${statusText(s)}</span>`;
const stat = (label, value, meta, icon, kind = '') => `<article class="stat ${kind}"><small>${label}</small><strong>${value}</strong><span>${meta}</span><div class="stat-icon">${icon}</div></article>`;
const empty = (icon, h, p, button = '') => `<div class="empty"><div class="empty-icon">${icon}</div><h3>${h}</h3><p>${p}</p>${button}</div>`;
const safe = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const productionMode = () => window.autoZapAuth?.mode === 'production';
const uiStatus = value => String(value || '').toLowerCase() === 'paused' ? 'Pausado' : 'Ativo';
const apiStatus = value => String(value || '').toLowerCase().startsWith('paus') ? 'paused' : 'active';
const packageFromApi = item => ({ id: item.id, integrationId: item.integration_id, deviceId: item.device_id, packageName: item.package_name, keyword: item.keyword, method: item.method || 'POST', url: item.url, renewalCheckoutUrl: item.renewal_checkout_url || '', status: uiStatus(item.status) });
const providerFromApi = item => item ? ({ id: item.id, mode: item.mode || 'links', name: item.name || '', apiBaseUrl: item.api_base_url || '', authType: item.auth_type || 'none', notes: item.notes || '', status: item.status || 'active', maskedSecret: !!item.secret_ref }) : structuredClone(seed).iptvProvider;
const formatDateTime = value => value ? new Date(value).toLocaleString('pt-BR') : '-';
const messageEventToLog = event => ({ id: event.id, at: formatDateTime(event.created_at || event.sent_at), from: event.phone || '-', keyword: event.direction === 'inbound' ? event.message : 'resposta enviada', rule: event.direction === 'inbound' ? 'Mensagem recebida' : 'Resposta do AutoZap', result: event.status === 'sent' ? 'Enviado' : event.status === 'failed' ? 'Falhou' : 'Processando', direction: event.direction || 'outbound', error: event.error_message || '', message: event.message || '' });
const usageText = (used, limit) => limit ? String(used || 0) + ' / ' + String(limit) : String(used || 0);
const adminStatusLabel = status => ({ trial: 'Teste', active: 'Ativo', past_due: 'Vencido', suspended: 'Suspenso', cancelled: 'Cancelado' }[String(status || '').toLowerCase()] || status || 'trial');
const connectedDevice = () => (state.devices || []).find(d => ['open','connected'].includes(String(d.status || '').toLowerCase())) || (state.devices || [])[0] || null;
const connectedDeviceLabel = () => {
  const device = connectedDevice();
  if (!device) return 'Nenhum WhatsApp';
  return device.phone || device.number || device.connected_phone || device.instance_name || 'Aguardando número';
};
function openOperationModal() {
  const tenant = state.account?.tenant || {};
  const device = connectedDevice();
  modalContent.innerHTML = `<h2>Minha operação</h2><p class="subtitle">Edite o nome que aparece no painel e nas mensagens automáticas.</p><form id="operation-form"><div class="field"><label>Nome da empresa / operação</label><input class="input" name="name" required maxlength="120" value="${safe(tenant.name || state.account?.profile?.full_name || '')}" placeholder="Ex.: NovaIPTV.ia"></div><div class="call-note"><strong>WhatsApp conectado</strong><p>${safe(device ? connectedDeviceLabel() : 'Nenhum dispositivo conectado ainda.')}</p></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancelar</button><button class="btn primary">Salvar operação</button></div></form>`;
  modal.hidden = false;
  document.querySelector('#operation-form').onsubmit = saveOperationSettings;
}
async function saveOperationSettings(e) {
  e.preventDefault();
  const name = String(new FormData(e.currentTarget).get('name') || '').trim();
  if (name.length < 2) { toast('Informe um nome válido para a empresa.'); return; }
  try {
    if (productionMode()) {
      const response = await window.apiFetch('/api/tenant-settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Falha ao salvar operação');
      state.account = { ...(state.account || {}), tenant: { ...(state.account?.tenant || {}), ...(data.data || {}), name } };
    } else {
      state.account = { ...(state.account || {}), tenant: { ...(state.account?.tenant || {}), name } };
    }
    modal.hidden = true;
    save();
    updateAccountShell();
    render();
    toast('Nome da empresa atualizado.');
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Falha ao salvar operação.');
  }
}

const leadSettings = () => {
  const tenant = state.account?.tenant || {};
  return {
    enabled: tenant.lead_capture_enabled ?? state.leadCapture?.enabled ?? true,
    greeting: tenant.lead_greeting_template || state.leadCapture?.greeting || defaultLeadGreeting,
    followup: tenant.lead_followup_template || state.leadCapture?.followup || defaultLeadFollowup
  };
};
function leadSettingsCard() {
  const lead = leadSettings();
  return `<article class="card lead-card"><div class="card-head"><div><h2>Pré-atendimento do teste IPTV</h2><p>Mensagem inicial antes de liberar o teste real. Use {{company_name}}, {{name}} e {{keyword}}.</p></div><label class="toggle-line"><input type="checkbox" name="leadEnabled" form="lead-settings-form" ${lead.enabled ? 'checked' : ''}> Ativo</label></div><form id="lead-settings-form" class="lead-form"><div class="field full"><label>Saudação enviada no primeiro contato</label><textarea name="leadGreeting" rows="10">${safe(lead.greeting)}</textarea></div><div class="field full"><label>Mensagem depois que o cliente responde o número do aparelho</label><textarea name="leadFollowup" rows="3">${safe(lead.followup)}</textarea><small>O sistema troca {{keyword}} pela palavra-chave do primeiro pacote ativo, por exemplo: teste iptv.</small></div><div class="modal-actions"><button class="btn primary">Salvar pré-atendimento</button></div></form></article>`;
}
async function saveLeadSettings(e) {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const payload = { lead_capture_enabled: !!f.get('leadEnabled'), lead_greeting_template: f.get('leadGreeting'), lead_followup_template: f.get('leadFollowup') };
  try {
    if (productionMode()) {
      const response = await window.apiFetch('/api/tenant-settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Falha ao salvar pré-atendimento');
      state.account = { ...(state.account || {}), tenant: { ...(state.account?.tenant || {}), ...(data.data || payload) } };
    }
    state.leadCapture = { enabled: payload.lead_capture_enabled, greeting: payload.lead_greeting_template, followup: payload.lead_followup_template };
    save();
    toast('Pré-atendimento salvo.');
    render();
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Falha ao salvar pré-atendimento.');
  }
}
function applyIptvRemote(payload) {
  if (!payload) return;
  state.iptvProvider = providerFromApi(payload.integration);
  state.testLinks = (payload.packages || []).map(packageFromApi);
}
async function persistProviderRemote(provider) {
  if (!productionMode()) return null;
  const response = await window.apiFetch('/api/iptv-integrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ integration: provider }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Falha ao salvar painel IPTV');
  applyIptvRemote(data.data);
  return data;
}
async function persistPackageRemote(pkg, existingId) {
  if (!productionMode()) return null;
  const body = JSON.stringify({ packageName: pkg.packageName, keyword: pkg.keyword, method: pkg.method, url: pkg.url, renewalCheckoutUrl: pkg.renewalCheckoutUrl || '', status: apiStatus(pkg.status), deviceId: pkg.deviceId });
  const response = await window.apiFetch(existingId ? `/api/iptv-integrations/${existingId}` : '/api/iptv-integrations/packages', { method: existingId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Falha ao salvar pacote IPTV');
  return data;
}
async function deletePackageRemote(id) {
  if (!productionMode()) return;
  const response = await window.apiFetch(`/api/iptv-integrations/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Falha ao excluir pacote IPTV');
  }
}
async function persistRuleRemote(rule) {
  if (!productionMode()) return null;
  const response = await window.apiFetch(rule.id ? `/api/automation-rules/${rule.id}` : '/api/automation-rules', { method: rule.id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rule) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Falha ao salvar regra do chatbot');
  return data;
}

const views = {
  dashboard: () => `<div class="banner"><div><h3>Motor de automação ativo</h3><p>O WhatsApp recebe a palavra-chave, chama o link/API do painel IPTV e devolve o teste para o cliente.</p></div><a class="btn" href="#testes">Ver testes automáticos</a></div><div class="stats">${stat('Dispositivos','1 / 1','WhatsApp conectado','â–£')}${stat('Respostas ativas',state.rules.filter(r=>r.active).length,'Prontas para responder','â™Ÿ','blue')}${stat('Links de teste',state.testLinks.length,'Cadastrados','⚡')}${stat('Falhas de API','0','Últimas 24 horas','✓','warn')}</div><article class="card" style="margin-bottom:20px"><div class="card-head"><h2>Fluxo igual ao BotBot</h2><a href="#chatbot">Configurar chatbot</a></div><div class="flow"><div class="flow-card"><div class="flow-icon">WA</div><h3>1. Cliente escreve</h3><p>Ex.: “teste iptv” no WhatsApp conectado.</p></div><div class="flow-arrow">→</div><div class="flow-card"><div class="flow-icon">⚡</div><h3>2. Chama URL</h3><p>A regra aciona o link do painel IPTV/provedor para criar o teste.</p></div><div class="flow-arrow">→</div><div class="flow-card"><div class="flow-icon">TV</div><h3>3. Envia resposta</h3><p>Usuário, senha, vencimento e links retornam no WhatsApp.</p></div></div></article><div class="grid-2"><article class="card"><div class="card-head"><h2>Mensagens processadas</h2><a>Últimos 7 dias</a></div><div class="chart">${[42,55,38,72,61,87,66,91,74,83,68,94].map(v=>`<div class="bar" style="height:${v}%" data-value="${v}"></div>`).join('')}</div></article><article class="card"><div class="card-head"><h2>Últimas execuções</h2><a href="#logs">Ver logs</a></div>${state.logs.map(l=>`<div class="activity-item"><span class="activity-icon">✓</span><div><strong>${l.rule}</strong><small>${l.from} • ${l.keyword}</small></div><time>${l.at}</time></div>`).join('')}</article></div>`,
  dispositivos: () => devicesView(),
  chatbot: () => chatbotView(),
  testes: () => testLinksView(),
  paineliptv: () => iptvPanelView(),
  testar: () => testChatbotView(),
  templates: () => `<div class="section-head"><div><h2>Templates</h2><p>Modelos reutilizáveis para as respostas do chatbot.</p></div><button class="btn primary" data-action="new-template">+ Criar template</button></div><article class="card table-wrap"><table class="table"><thead><tr><th>Nome</th><th>Tipo</th><th>Conteúdo</th><th>Ações</th></tr></thead><tbody>${state.templates.map(t=>`<tr><td><strong>${safe(t.name)}</strong></td><td><span class="tag">${safe(t.type)}</span></td><td>${safe(t.content)}</td><td class="row-actions"><button>Editar</button></td></tr>`).join('')}</tbody></table></article>`,
  contatos: () => `<div class="section-head"><div><h2>Contatos</h2><p>Números que já conversaram com o bot.</p></div><button class="btn primary">+ Importar contatos</button></div><article class="card table-wrap"><table class="table"><thead><tr><th>Contato</th><th>Origem</th><th>Última interação</th><th>Ações</th></tr></thead><tbody>${state.contacts.map(c=>`<tr><td><strong>${safe(c.name)}</strong><br><small>${safe(c.phone)}</small></td><td>${safe(c.source)}</td><td>${safe(c.last)}</td><td class="row-actions"><button>Mensagem</button></td></tr>`).join('')}</tbody></table></article>`,
  grupos: () => `<div class="section-head"><div><h2>Grupos de contatos</h2><p>Organize contatos para campanhas e comunicados.</p></div><button class="btn primary">+ Criar grupo</button></div><article class="card">${empty('♧','Nenhum grupo criado','Crie um grupo para organizar seus contatos.')}</article>`,
  agendamentos: () => `<div class="section-head"><div><h2>Mensagens agendadas</h2><p>Lembretes e campanhas que serão enviados no horário definido.</p></div><button class="btn primary" data-action="schedule">+ Criar agendamento</button></div><div class="stats">${stat('Agendamentos',state.scheduled.length,'Total','◷')}${stat('Pendentes',state.scheduled.length,'Aguardando envio','◴','warn')}${stat('Executados','0','Hoje','✓','blue')}${stat('Falhas','0','Hoje','!','red')}</div><article class="card">${state.scheduled.length?'<p>Agendamento salvo.</p>':empty('◷','Nenhum agendamento feito','Crie uma mensagem para uma data e horário específicos.')}</article>`,
  enviar: () => `<div class="section-head"><div><h2>Enviar mensagem</h2><p>Envio manual pelo dispositivo conectado.</p></div></div><article class="card"><div class="compose-grid"><div class="compose-tabs"><button class="active">Texto</button><button>Mídia</button><button>Template</button></div><form id="send-form"><div class="form-grid"><div class="field"><label>Dispositivo</label><select class="select"><option>WhatsApp principal</option></select></div><div class="field"><label>Número com DDD</label><input class="input" required placeholder="5511999999999"></div><div class="field full"><label>Mensagem</label><textarea rows="9" required placeholder="Digite a mensagem"></textarea></div></div><div class="modal-actions"><button class="btn primary">Enviar mensagem</button></div></form></div></article>`,
  logs: () => logsView(),
  integracoes: () => appsView(),
  planos: () => plansView(),
  admin: () => adminView(),
  diagnosticos: () => `<div class="section-head"><div><h2>Diagnósticos</h2><p>Saúde das conexões e últimas execuções.</p></div><button class="btn primary" data-action="diagnose">Atualizar</button></div><article class="card"><div class="health"><div class="health-item"><strong>WhatsApp</strong>${badge('connected')}<br><span>Latência: 84 ms</span></div><div class="health-item"><strong>Motor de regras</strong>${badge('connected')}<br><span>Fila: 0 eventos</span></div><div class="health-item"><strong>API IPTV</strong><span class="badge pending">Pendente</span><br><span>Falta validar a chamada real do provedor.</span></div></div></article><article class="card" style="margin-top:18px"><div class="card-head"><h2>Último teste</h2></div><pre class="code">WhatsApp .............. OK
Palavra-chave .......... OK
Webhook de teste ....... MODELO
Resposta WhatsApp ...... SIMULADA</pre></article>`
};


function logsView() {
  const summary = state.logSummary || {};
  const logs = state.logs || [];
  const sent = logs.filter(l => l.result === 'Enviado').length;
  const failed = logs.filter(l => l.result === 'Falhou').length;
  const rows = logs.length ? logs.map(l => '<tr><td>' + safe(l.at) + '</td><td>' + safe(l.from) + '</td><td>' + safe(l.direction) + '</td><td>' + safe(l.message || l.keyword) + '</td><td>' + badge(l.result) + '</td><td>' + safe(l.error || '-') + '</td></tr>').join('') : '<tr><td colspan="6">Nenhum log real ainda. Assim que o WhatsApp receber/enviar mensagens, aparece aqui.</td></tr>';
  return '<div class="section-head"><div><h2>Mensagens enviadas</h2><p>Auditoria real das mensagens recebidas, respostas e falhas.</p></div><button class="btn ghost" data-action="refresh-remote">Atualizar</button></div><div class="stats">' + stat('Eventos hoje', String(summary.todayTotal ?? logs.length), 'Recebidos/enviados', 'EN') + stat('Enviadas no mês', String(summary.monthOutbound ?? sent), 'Conta no limite do plano', 'WA', 'blue') + stat('Falhas no mês', String(summary.monthFailed ?? failed), 'Para corrigir URL/API', '!', 'warn') + stat('Últimos logs', String(logs.length), 'Carregados', 'LG') + '</div><article class="card table-wrap"><table class="table"><thead><tr><th>Data</th><th>Telefone</th><th>Direção</th><th>Mensagem</th><th>Status</th><th>Erro</th></tr></thead><tbody>' + rows + '</tbody></table></article>';
}

function plansView() {
  const account = state.account || {};
  const tenant = account.tenant || {};
  const subscription = account.subscription || {};
  const usage = account.usage || {};
  const currentPlan = String(subscription.plan_code || tenant.plan_code || 'starter').toLowerCase();
  const status = subscription.status || tenant.status || (productionMode() ? 'trial' : 'demo');
  const plans = [
    { id: 'starter', name: 'Starter', price: 'R$ 39,90/mês', devices: 1, apps: 1, messages: 1000, fit: 'Teste grátis, operação pequena e validação.' },
    { id: 'pro', name: 'Profissional', price: 'R$ 59,90/mês', devices: 3, apps: 3, messages: 5000, fit: 'Revenda com mais de um número e mais volume.' },
    { id: 'agency', name: 'Agência', price: 'R$ 137,90/mês', devices: 10, apps: 10, messages: 25000, fit: 'Para vender AutoZap para vários clientes.' }
  ];
  const cards = plans.map(plan => '<article class="card"><div class="card-head"><h2>' + plan.name + '</h2>' + (plan.id === currentPlan ? badge('Ativo') : '<span class="tag">Upgrade</span>') + '</div><h3>' + plan.price + '</h3><div class="health-stack"><div><span>Dispositivos</span><strong>' + plan.devices + '</strong></div><div><span>Apps/API</span><strong>' + plan.apps + '</strong></div><div><span>Mensagens/mês</span><strong>' + plan.messages.toLocaleString('pt-BR') + '</strong></div></div><p>' + plan.fit + '</p><button class="btn ' + (plan.id === currentPlan ? 'ghost' : 'primary') + '" data-action="plan-interest" data-plan="' + plan.id + '">' + (plan.id === currentPlan ? 'Plano atual' : 'Quero esse plano') + '</button></article>').join('');
  return '<div class="section-head"><div><h2>Planos e assinatura</h2><p>Seu plano atual, limites contratados e opções de upgrade.</p></div><a class="btn primary" href="#dispositivos">Conectar WhatsApp</a></div><div class="banner"><div><h3>Conta atual: ' + safe(currentPlan.toUpperCase()) + ' • ' + safe(status) + '</h3><p>Teste grátis restante: ' + safe(account.access?.trialDaysLeft ?? 0) + ' dia(s). Limites são aplicados por empresa/cliente.</p></div><a class="btn" href="#paineliptv">Configurar IPTV</a></div><div class="stats">' + stat('Dispositivos', usageText(usage.devicesUsed, usage.maxDevices), 'Limite do plano', 'WA') + stat('Apps/API', usageText(usage.appsUsed, usage.maxApps), 'Credenciais externas', 'API', 'blue') + stat('Links IPTV', String(usage.testLinksUsed || state.testLinks.length), 'URLs cadastradas', 'TV') + stat('Mensagens mês', usageText(usage.messagesUsedThisMonth, usage.messagesLimit), 'Enviadas com sucesso', 'EN', 'warn') + '</div><div class="integration-grid">' + cards + '</div>';
}

function adminView() {
  const account = state.account || {};
  if (!account.platformAdmin) return '<article class="card">' + empty('ADM','Acesso restrito','Esse painel aparece apenas para o dono da plataforma. Configure AUTOZAP_ADMIN_EMAILS no Netlify com seu e-mail de login.') + '</article>';
  const payload = state.adminDashboard || {};
  const rows = payload.data || [];
  const active = payload.summary?.active ?? rows.filter(row => ['active','trial'].includes(String(row.subscription?.status || row.status))).length;
  const body = rows.length ? rows.map(row => {
    const plan = row.subscription?.plan_code || row.plan_code || 'starter';
    const status = row.subscription?.status || row.status || 'trial';
    return '<tr data-tenant="' + safe(row.id) + '"><td><strong>' + safe(row.name) + '</strong><br><small>' + safe(row.slug || row.id) + '</small><br><small>' + safe(row.users || 0) + ' usuário(s)</small></td><td><select class="select compact" data-admin-field="planCode"><option value="starter" ' + (plan === 'starter' ? 'selected' : '') + '>Starter</option><option value="pro" ' + (plan === 'pro' ? 'selected' : '') + '>Pro</option><option value="agency" ' + (plan === 'agency' ? 'selected' : '') + '>Agência</option></select></td><td><select class="select compact" data-admin-field="status"><option value="trial" ' + (status === 'trial' ? 'selected' : '') + '>Teste</option><option value="active" ' + (status === 'active' ? 'selected' : '') + '>Ativo</option><option value="past_due" ' + (status === 'past_due' ? 'selected' : '') + '>Vencido</option><option value="suspended" ' + (status === 'suspended' ? 'selected' : '') + '>Suspenso</option><option value="cancelled" ' + (status === 'cancelled' ? 'selected' : '') + '>Cancelado</option></select></td><td><input class="input compact" data-admin-field="maxDevices" type="number" min="0" value="' + safe(row.max_devices || 0) + '"><small>' + safe(row.connectedDevices || 0) + ' conectado(s)</small></td><td><input class="input compact" data-admin-field="monthlyMessageLimit" type="number" min="0" value="' + safe(row.monthly_message_limit || 0) + '"><small>' + safe(row.messagesThisMonth || 0) + ' usadas</small></td><td><input class="input compact" data-admin-field="maxApps" type="number" min="0" value="' + safe(row.max_apps || 0) + '"><small>Apps/API</small></td><td><button class="btn primary" data-action="save-admin-tenant" data-id="' + safe(row.id) + '">Salvar</button></td></tr>';
  }).join('') : '<tr><td colspan="7">Nenhum cliente encontrado.</td></tr>';
  return '<div class="section-head"><div><h2>Admin AutoZap</h2><p>Painel do dono da plataforma: gerencie assinantes, planos, limites e acesso.</p></div><button class="btn ghost" data-action="refresh-remote">Atualizar</button></div><div class="banner"><div><h3>Modo administrador da plataforma</h3><p>Esta área não é o painel vendido ao assinante. Aqui você controla quem acessa, qual plano usa e quais limites cada cliente tem.</p></div><a class="btn" href="#planos">Ver planos comerciais</a></div><article class="card" style="margin-bottom:18px"><div class="card-head"><h2>Próxima etapa comercial</h2></div><p>Quando você escolher o gateway de pagamento, essa tela passa a criar assinatura, liberar teste de 3 dias e bloquear/reativar automaticamente pelo status do pagamento.</p></article><div class="stats">' + stat('Clientes', String(rows.length), 'Empresas cadastradas', 'OP') + stat('Ativos/teste', String(active), 'Com acesso liberado', 'OK', 'blue') + stat('Dispositivos', String(rows.reduce((sum,row)=>sum+(row.devices||0),0)), 'WhatsApps criados', 'WA') + stat('Mensagens mês', String(rows.reduce((sum,row)=>sum+(row.messagesThisMonth||0),0)), 'Saídas enviadas', 'EN', 'warn') + '</div><article class="card table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>Plano</th><th>Status</th><th>Dispositivos</th><th>Mensagens/mês</th><th>Apps</th><th>Ação</th></tr></thead><tbody>' + body + '</tbody></table></article>';
}

function chatbotView() {
  return `<div class="section-head"><div><h2>Respostas e automações</h2><p>Cada resposta liga uma palavra-chave do WhatsApp a texto, template ou URL externa.</p></div><button class="btn primary" data-action="new-rule">+ Criar resposta</button></div>${leadSettingsCard()}<div class="stats">${stat('Respostas',state.rules.length,'Total cadastrado','BOT')}${stat('Ativas',state.rules.filter(r=>r.active).length,'Respondendo agora','OK','blue')}${stat('URLs/Webhooks',state.rules.filter(r=>String(r.responseType).includes('URL')||String(r.responseType).includes('Webhook')).length,'Criam teste no provedor','⚡')}${stat('Chamadas de API','11','Hoje','API')}</div><article class="card"><div class="filters"><input class="input" placeholder="Pesquisar regra ou palavra-chave"><select class="select"><option>Todos os dispositivos</option><option>WhatsApp principal</option></select></div>${state.rules.map(ruleCard).join('')}</article>`;
}
function ruleCard(r) {
  return `<div class="rule-card"><div class="rule-top"><span class="automation-icon">${r.responseType?.includes('URL') || r.responseType?.includes('Webhook') ? '⚡' : 'â™Ÿ'}</span><div><h3>${safe(r.name)}</h3><p>Palavra-chave: <b>${safe(r.keyword)}</b> • ${safe(r.match)}</p></div>${badge(r.active)}<div class="mini-actions"><button data-action="edit-rule" data-id="${r.id}">Editar</button><button data-action="toggle-rule" data-id="${r.id}">${r.active?'Pausar':'Ativar'}</button></div></div><div class="rule-body"><div class="rule-step"><strong>Tipo de resposta</strong>${safe(r.responseType || 'Texto')}</div><div class="rule-step"><strong>URL / ação</strong>${safe(r.webhookUrl || r.action || 'Responder texto')}</div><div class="rule-step"><strong>Resposta ao cliente</strong>${safe(r.reply)}</div></div></div>`;
}

function testLinksView() {
  const links = state.testLinks || [];
  const listHtml = links.length
    ? `<div class="test-link-list">${links.map(t=>`<div class="test-link-row"><div><strong>${safe(t.packageName)}</strong><small>Palavra-chave que o cliente vai mandar: ${safe(t.keyword)} • Método: ${safe(t.method || 'POST')}</small><code>${safe(t.url)}</code>${t.renewalCheckoutUrl ? `<small>Checkout padrão: ${safe(t.renewalCheckoutUrl)}</small>` : ''}</div><div>${badge(t.status || 'Ativo')}<button class="btn secondary" data-action="copy-url" data-url="${safe(t.url)}">Copiar URL</button><button class="btn ghost" data-action="make-rule" data-id="${t.id}">Usar no chatbot</button><button class="btn danger" data-action="delete-package" data-id="${t.id}">Excluir</button></div></div>`).join('')}</div>`
    : empty('?','Nenhuma URL de teste cadastrada','Cada cliente precisa cadastrar aqui as URLs do próprio provedor IPTV. Depois disso, ele pode transformar cada URL em uma regra do chatbot.','<button class="btn primary" data-action="new-package">Cadastrar URL do provedor</button>');
  return `<div class="section-head"><div><h2>Links de teste automático</h2><p>Cadastre as URLs reais do provedor IPTV deste cliente. O sistema não usa links fixos: cada cliente informa os próprios links ou API.</p></div><button class="btn primary" data-action="new-package">+ Cadastrar URL do provedor</button></div><div class="banner"><div><h3>Como funciona</h3><p>O cliente cola a URL de teste do painel dele, define a palavra-chave, e depois usa “Usar no chatbot” para automatizar a resposta no WhatsApp.</p></div><a class="btn" href="#paineliptv">Configurar painel IPTV</a></div><div class="stats">${stat('URLs cadastradas',links.length,'Do cliente atual','?')}${stat('Método padrão','POST','Ajustável por pacote','?','blue')}${stat('Resposta esperada','reply/text/JSON','Enviada no WhatsApp','WA')}${stat('Origem','Cliente','Provedor próprio','?','warn')}</div><article class="card"><div class="card-head"><h2>URLs do provedor IPTV</h2><button class="btn primary" data-action="new-package">+ Nova URL</button></div>${listHtml}</article><article class="card" style="margin-top:18px"><div class="card-head"><h2>Payload enviado para cada URL</h2></div><pre class="code">POST URL_CADASTRADA_PELO_CLIENTE
Content-Type: application/json

{
  "appName": "WhatsApp principal",
  "messageDateTime": 1780000000,
  "devicePhone": "5588999990000",
  "senderName": "Cliente",
  "senderPhone": "5588999991111",
  "message": "TESTE IPTV"
}</pre></article>`;
}
function testChatbotView() {
  const first = state.rules.find(r => r.keyword.includes('teste')) || state.rules[0];
  return `<div class="banner"><div><h3>Ambiente seguro de teste</h3><p>Simula a conversa e mostra exatamente onde o link do pacote seria chamado.</p></div></div><div class="grid-2"><article class="card"><div class="card-head"><h2>Conversa simulada</h2><span class="tag">Dispositivo: WhatsApp principal</span></div><div class="chat-preview" id="chat"><div class="bubble">${safe(first.keyword)}<small>14:31</small></div><div class="bubble out">Chamando URL do pacote no painel IPTV…<small>14:31</small></div><div class="bubble out">✅ Teste criado com sucesso\nUsuário: 633349\nSenha: 224689\nPlano: 4 horas\nLink M3U: enviado pelo provedor<small>14:31 ✓✓</small></div></div><div class="filters" style="margin-top:12px"><input class="input" id="test-input" value="${safe(first.keyword)}"><button class="btn primary" data-action="simulate">Testar</button></div></article><article class="card"><div class="card-head"><h2>Rastreamento da execução</h2></div><pre class="code">1  whatsapp_inbound    mensagem recebida
2  match_keyword       "${safe(first.keyword)}"
3  external_webhook    ${safe(first.method || 'POST')} ${safe(first.webhookUrl || 'sem URL')}
4  provider_response   teste criado
5  whatsapp_send       entregue</pre></article></div>`;
}

function devicesView() {
  const devices = state.devices || [];
  const connected = devices.filter(d => ['open','connected'].includes(String(d.status).toLowerCase())).length;
  return `<div class="section-head"><div><h2>Dispositivos</h2><p>Cada dispositivo representa uma sessão WhatsApp isolada.</p></div><button class="btn primary" data-action="new-device">+ Criar dispositivo</button></div><div class="stats">${stat('Dispositivos',String(devices.length),window.autoZapAuth?.mode==='production'?'Limite conforme seu plano':'Modo demonstração','WA')}${stat('Conectados',String(connected),'Sessões online','OK','blue')}${stat('Mensagens hoje','18','Processadas','EN')}${stat('Falhas','0','Últimas 24 horas','!','warn')}</div>${devices.length?`<div class="device-detail-grid">${devices.map(d=>`<article class="card device-main-card"><div class="connection"><span class="device-photo">WA</span><div><h3>${safe(d.name)}</h3><p>${safe(d.phone||d.instance_name||'Aguardando conexão')}</p></div>${badge(['open','connected'].includes(String(d.status).toLowerCase()))}</div><div class="device-message-stats"><div><strong>18</strong><small>Hoje</small></div><div><strong>54</strong><small>7 dias</small></div><div><strong>126</strong><small>30 dias</small></div><div><strong>394</strong><small>Total</small></div></div><div class="device-actions"><button class="btn primary" data-action="show-device-qr" data-id="${d.id}">Gerar QR</button><a class="btn primary" href="#diagnosticos">Diagnósticos</a><button class="btn danger" data-action="delete-device" data-id="${d.id}">Excluir</button></div><div class="call-note"><strong>Precisa conectar de novo?</strong><p>Use “Gerar QR” para abrir um novo QR Code desta mesma instância. Se quiser começar do zero, clique em “Excluir” e crie outro dispositivo.</p></div></article>`).join('')}<article class="card"><div class="card-head"><h2>Saúde das sessões</h2></div><div class="health-stack">${devices.map(d=>`<div><span>${safe(d.name)}</span>${badge(['open','connected'].includes(String(d.status).toLowerCase()))}</div>`).join('')}</div><div class="call-note"><strong>Segurança</strong><p>Cada cliente vê apenas as instâncias pertencentes à própria empresa.</p></div></article></div>`:`<article class="card">${empty('WA','Nenhum dispositivo','Crie o primeiro dispositivo e leia o QR Code no WhatsApp.','<button class="btn primary" data-action="new-device">Criar dispositivo</button>')}</article>`}`;
}

function appsView() {
  const apps = state.apps || [];
  return `<div class="section-head"><div><h2>Aplicativos e API</h2><p>Credenciais independentes para cada integração externa.</p></div><button class="btn primary" data-action="new-app">+ Criar aplicativo</button></div><div class="stats">${stat('Aplicativos',String(apps.filter(a=>a.status==='active').length),'Ativos','â–¦')}${stat('Mensagens enviadas','18','Via API','➤','blue')}${stat('Últimos 30 dias','126','Processadas','◷')}${stat('Falhas','0','Integração saudável','✓','warn')}</div>${apps.length?`<div class="integration-grid">${apps.map(a=>`<article class="card"><div class="connection"><span class="device-photo">API</span><div><h3>${safe(a.name)}</h3><p>App Key: ${safe(a.app_key_prefix)}••••••</p></div>${badge(a.status==='active')}</div><div class="health-stack"><div><span>Último uso</span><strong>${a.last_used_at?new Date(a.last_used_at).toLocaleString('pt-BR'):'Nunca'}</strong></div><div><span>Criado em</span><strong>${new Date(a.created_at).toLocaleDateString('pt-BR')}</strong></div></div></article>`).join('')}</div>`:`<article class="card">${empty('⌁','Nenhum aplicativo','Crie credenciais para conectar um painel IPTV.','<button class="btn primary" data-action="new-app">Criar aplicativo</button>')}</article>`}<article class="card" style="margin-top:18px"><div class="card-head"><h2>Endpoint de mensagens</h2></div><pre class="code">POST https://SEU-SITE.netlify.app/api/iptv/send
x-app-key: SUA_APP_KEY
x-auth-key: SUA_AUTH_KEY
idempotency-key: ID_UNICO_DO_ENVIO

{"number":"5588999990000","text":"Mensagem"}</pre></article>`;
}


function iptvPanelView() {
  const provider = state.iptvProvider || {};
  const links = state.testLinks || [];
  const linkMode = provider.mode !== 'api';
  const packagesHtml = links.length
    ? `<div class="test-link-list">${links.map(t=>`<div class="test-link-row"><div><strong>${safe(t.packageName)}</strong><small>Palavra-chave: ${safe(t.keyword)} • Método: ${safe(t.method || 'POST')}</small><code>${safe(t.url)}</code>${t.renewalCheckoutUrl ? `<small>Checkout padrão: ${safe(t.renewalCheckoutUrl)}</small>` : ''}</div><div>${badge(t.status || 'Ativo')}<button class="btn secondary" data-action="test-package-url" data-id="${t.id}">Testar URL</button><button class="btn ghost" data-action="make-rule" data-id="${t.id}">Criar regra</button><button class="btn danger" data-action="delete-package" data-id="${t.id}">Excluir</button></div></div>`).join('')}</div>`
    : empty('TV','Nenhum pacote cadastrado','Cadastre a primeira URL de teste ou endpoint da API do provedor IPTV deste cliente.','<button class="btn primary" data-action="new-package">Cadastrar primeira URL</button>');
  return `<div class="section-head"><div><h2>Painel IPTV do cliente</h2><p>Cada cliente configura aqui o painel, os links de teste e as palavras-chave dele.</p></div><div class="header-actions"><button class="btn ghost" data-action="edit-provider">Configurar painel</button><button class="btn primary" data-action="new-package">+ Novo pacote</button></div></div><div class="provider-grid"><article class="card provider-card"><div class="card-head"><h2>Modo de integração</h2>${badge(linkMode ? 'Links diretos' : 'API completa')}</div><div class="mode-cards"><button class="mode-card ${linkMode ? 'active' : ''}" data-action="set-provider-mode" data-mode="links"><span>URL</span><strong>Tenho links de teste</strong><small>Ideal quando o painel gera teste por uma URL tipo /api/chatbot/...</small></button><button class="mode-card ${!linkMode ? 'active' : ''}" data-action="set-provider-mode" data-mode="api"><span>API</span><strong>Tenho API do painel</strong><small>Para painel com token, endpoints de criar teste, renovar e consultar cliente.</small></button></div><div class="provider-summary"><div><small>Nome do painel</small><strong>${safe(provider.name || 'Não configurado')}</strong></div><div><small>URL base/API</small><strong>${safe(provider.apiBaseUrl || 'Usando links individuais')}</strong></div><div><small>Segurança</small><strong>Dados separados por cliente</strong></div></div></article><article class="card"><div class="card-head"><h2>Como o cliente usa</h2></div><div class="api-flow-list"><div><b>1</b><span><strong>Conecta WhatsApp</strong>Lê o QR Code no dispositivo da empresa dele.</span></div><div><b>2</b><span><strong>Cadastra painel</strong>Escolhe API completa ou cola links de teste.</span></div><div><b>3</b><span><strong>Cria pacotes</strong>Define palavra-chave, URL e dispositivo.</span></div><div><b>4</b><span><strong>Vende no automático</strong>Cliente pede teste no WhatsApp e recebe o retorno do painel.</span></div></div></article></div><article class="card" style="margin-top:18px"><div class="card-head"><h2>Pacotes de teste deste cliente</h2><button class="btn primary" data-action="new-package">+ Cadastrar link/API</button></div>${packagesHtml}</article><article class="card" style="margin-top:18px"><div class="card-head"><h2>Lembrete de renovação</h2></div><p class="subtitle">Quando o painel IPTV retornar vencimento, link de renovação ou customer_renew_template, o AutoZap agenda o lembrete para o mesmo WhatsApp que solicitou o teste. Se o vencimento já passou, o lembrete entra na fila para envio imediato.</p></article><article class="card" style="margin-top:18px"><div class="card-head"><h2>Payload enviado ao painel</h2></div><pre class="code">POST URL_DO_PACOTE
Content-Type: application/json

{
  "appName": "WhatsApp conectado do cliente",
  "senderName": "Nome do solicitante",
  "senderPhone": "5588999991111",
  "message": "TESTE IPTV"
}

Resposta ideal: { "reply": "mensagem pronta para enviar no WhatsApp" }</pre></article>`;
}
function openProviderModal() {
  const provider = state.iptvProvider || {};
  modalContent.innerHTML = `<h2>Configurar painel IPTV</h2><p class="subtitle">Essa configuração pertence somente ao cliente logado.</p><form id="provider-form"><div class="form-grid"><div class="field"><label>Nome do painel/provedor</label><input class="input" name="name" value="${safe(provider.name || '')}" placeholder="Ex.: Alpha, QPanel, Sigma"></div><div class="field"><label>Tipo de integração</label><select class="select" name="mode"><option value="links" ${provider.mode !== 'api' ? 'selected' : ''}>Tenho links de teste</option><option value="api" ${provider.mode === 'api' ? 'selected' : ''}>Tenho API do painel</option></select></div><div class="field full"><label>URL base da API (opcional)</label><input class="input" name="apiBaseUrl" value="${safe(provider.apiBaseUrl || '')}" placeholder="https://painel-do-cliente.com/api"></div><div class="field"><label>Autenticação</label><select class="select" name="authType"><option value="none" ${provider.authType === 'none' ? 'selected' : ''}>Nenhuma / link direto</option><option value="bearer" ${provider.authType === 'bearer' ? 'selected' : ''}>Bearer token</option><option value="apikey" ${provider.authType === 'apikey' ? 'selected' : ''}>API Key</option></select></div><div class="field"><label>Token/API Key</label><input class="input" name="maskedSecret" value="${provider.maskedSecret ? '********' : ''}" placeholder="Salvo com segurança no backend"></div><div class="field full"><label>Observações internas</label><textarea name="notes" rows="4" placeholder="Ex.: painel usa URLs /api/chatbot/...">${safe(provider.notes || '')}</textarea></div></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancelar</button><button class="btn primary">Salvar painel</button></div></form>`;
  modal.hidden = false;
  document.querySelector('#provider-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = { name: f.get('name'), mode: f.get('mode'), apiBaseUrl: f.get('apiBaseUrl'), authType: f.get('authType'), maskedSecret: f.get('maskedSecret') ? true : provider.maskedSecret || false, notes: f.get('notes') };
    try {
      state.iptvProvider = payload;
      await persistProviderRemote(payload);
      save();
      modal.hidden = true;
      toast('Painel IPTV salvo para este cliente.');
      location.hash = '#paineliptv';
      render();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Falha ao salvar painel IPTV.');
    }
  };
}

function openPackageModal(existing) {
  const returnHash = route() === 'testes' ? '#testes' : '#paineliptv';
  const p = existing || { packageName: '', keyword: 'TESTE IPTV', url: '', renewalCheckoutUrl: '', method: 'POST', status: 'Ativo' };
  modalContent.innerHTML = `<h2>${existing ? 'Editar' : 'Cadastrar'} pacote de teste</h2><p class="subtitle">Cole aqui a URL de teste do painel do cliente ou o endpoint da API dele.</p><form id="package-form"><div class="form-grid"><div class="field full"><label>Nome do pacote</label><input class="input" name="packageName" required value="${safe(p.packageName)}" placeholder="Ex.: Teste 24h sem adultos"></div><div class="field"><label>Palavra-chave</label><input class="input" name="keyword" required value="${safe(p.keyword)}" placeholder="TESTE IPTV"></div><div class="field"><label>Método</label><select class="select" name="method"><option ${p.method !== 'GET' ? 'selected' : ''}>POST</option><option ${p.method === 'GET' ? 'selected' : ''}>GET</option></select></div><div class="field full"><label>URL de teste/API</label><input class="input" name="url" required value="${safe(p.url)}" placeholder="https://painel.com/api/chatbot/..."></div><div class="field full"><label>Link de checkout/renovação padrão (opcional)</label><input class="input" name="renewalCheckoutUrl" value="${safe(p.renewalCheckoutUrl || '')}" placeholder="https://painel.com/#/checkout/..."><small>Usado se o painel não retornar renew_url ou se a mensagem automática vier sem link.</small></div><div class="field"><label>Dispositivo</label><select class="select" name="device"><option>WhatsApp principal</option></select></div><div class="field"><label>Status</label><select class="select" name="status"><option ${p.status !== 'Pausado' ? 'selected' : ''}>Ativo</option><option ${p.status === 'Pausado' ? 'selected' : ''}>Pausado</option></select></div></div><div class="webhook-help"><strong>Dica</strong><pre>Se a URL retornar { "reply": "..." }, o sistema envia esse texto direto ao cliente.</pre></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancelar</button><button class="btn primary">Salvar pacote</button></div></form>`;
  modal.hidden = false;
  document.querySelector('#package-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data = { id: p.id || crypto.randomUUID(), packageName: f.get('packageName'), keyword: f.get('keyword'), url: f.get('url'), renewalCheckoutUrl: f.get('renewalCheckoutUrl'), method: f.get('method'), status: f.get('status') };
    try {
      const remote = await persistPackageRemote(data, p.id && productionMode() ? p.id : null);
      if (remote?.data && !p.id) data.id = remote.data.id;
      const i = state.testLinks.findIndex(x => x.id === data.id);
      i >= 0 ? state.testLinks[i] = data : state.testLinks.unshift(data);
      save();
      modal.hidden = true;
      toast('Pacote de teste salvo.');
      location.hash = returnHash;
      render();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Falha ao salvar pacote IPTV.');
    }
  };
}
function updateAccountShell() {
  const account = state.account || {};
  const tenant = account.tenant || {};
  const profile = account.profile || {};
  const subscription = account.subscription || {};
  const platformAdmin = !!account.platformAdmin;
  const name = platformAdmin ? 'Admin AutoZap' : (tenant.name || profile.full_name || 'Minha operação');
  const roleMap = { owner: 'Assinante', admin: 'Administrador', reseller: 'Revendedor', agent: 'Atendente' };
  const role = platformAdmin ? 'ADMIN' : (roleMap[profile.role] || (productionMode() ? 'Assinante' : 'Demonstração'));
  const mode = platformAdmin ? 'Gestão de assinantes' : (productionMode()
    ? (subscription.status === 'trial' && account.access?.trialDaysLeft ? `Teste grátis • ${account.access.trialDaysLeft} dia(s)` : 'Conta ativa')
    : 'Modo demonstração local');
  const initials = String(name).trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'AZ';
  const nameEl = document.querySelector('#workspace-name');
  const roleEl = document.querySelector('#workspace-role');
  const avatarEl = document.querySelector('#workspace-avatar');
  const modeEl = document.querySelector('#workspace-mode');
  if (nameEl) nameEl.textContent = name;
  if (roleEl) roleEl.textContent = role;
  if (avatarEl) avatarEl.textContent = initials;
  if (modeEl) modeEl.textContent = mode;
  const navEl = document.querySelector('#nav');
  if (navEl && platformAdmin && navEl.dataset.mode !== 'admin') {
    navEl.dataset.mode = 'admin';
    navEl.innerHTML = '<p>GESTÃO DA PLATAFORMA</p><a href="#dashboard" data-route="dashboard" class="active"><i>ADM</i> Visão geral</a><a href="#admin" data-route="admin"><i>CL</i> Clientes e planos</a><a href="#logs" data-route="logs"><i>LG</i> Logs globais</a><a href="#planos" data-route="planos"><i>PL</i> Planos comerciais</a><p>ATALHOS DO PRODUTO</p><a href="#dispositivos" data-route="dispositivos"><i>WA</i> Minha operação</a>';
  } else if (navEl && !platformAdmin && navEl.dataset.mode === 'admin') {
    navEl.dataset.mode = 'tenant';
    navEl.innerHTML = defaultNavHtml;
  }
}

async function syncRemote() {
  if (window.autoZapAuth?.mode !== 'production') return;
  try {
    const [accountResponse, devicesResponse, appsResponse, iptvResponse, rulesResponse, logsResponse] = await Promise.all([window.apiFetch('/api/account'), window.apiFetch('/api/devices'), window.apiFetch('/api/apps'), window.apiFetch('/api/iptv-integrations'), window.apiFetch('/api/automation-rules'), window.apiFetch('/api/message-events')]);
    if (accountResponse.ok) state.account = (await accountResponse.json()).data || null;
    if (devicesResponse.ok) state.devices = (await devicesResponse.json()).data || [];
    if (appsResponse.ok) state.apps = (await appsResponse.json()).data || [];
    if (iptvResponse.ok) applyIptvRemote((await iptvResponse.json()).data);
    if (rulesResponse.ok) state.rules = (await rulesResponse.json()).data || [];
    if (logsResponse.ok) { const payload = await logsResponse.json(); state.logSummary = payload.summary || {}; state.logs = (payload.data || []).map(messageEventToLog); }
    if (state.account?.platformAdmin) { const adminResponse = await window.apiFetch('/api/admin/overview'); if (adminResponse.ok) state.adminDashboard = await adminResponse.json(); }
    render();
  } catch (error) {
    console.error('Falha ao sincronizar', error);
  }
}

function openRule(existing) {
  const r = existing || { name: '', keyword: '', match: 'Frase exata', responseType: 'URL / Servidor externo / Webhook', method: 'POST', webhookUrl: '', reply: '' };
  modalContent.innerHTML = `<h2>${existing?'Editar':'Criar'} resposta automática</h2><p class="subtitle">Configure como no BotBot: palavra-chave, dispositivo, tipo URL/Webhook e resposta.</p><form id="rule-form"><div class="form-grid"><div class="field full"><label>Nome da automação</label><input class="input" name="name" value="${safe(r.name)}" required placeholder="Ex.: Gerar teste IPTV"></div><div class="field"><label>Palavra-chave</label><input class="input" name="keyword" value="${safe(r.keyword)}" required placeholder="teste iptv"></div><div class="field"><label>Correspondência</label><select class="select" name="match"><option ${r.match==='Frase exata'?'selected':''}>Frase exata</option><option ${r.match==='Contém'?'selected':''}>Contém</option><option ${r.match==='Começa com'?'selected':''}>Começa com</option></select></div><div class="field"><label>Dispositivo</label><select class="select" name="device"><option>WhatsApp principal</option></select></div><div class="field"><label>Tipo de resposta</label><select class="select" name="responseType"><option ${String(r.responseType).includes('URL')?'selected':''}>URL / Servidor externo / Webhook</option><option ${r.responseType==='Texto'?'selected':''}>Texto</option><option ${r.responseType==='Template'?'selected':''}>Template</option></select></div><div class="field"><label>Método</label><select class="select" name="method"><option ${r.method==='POST'?'selected':''}>POST</option><option ${r.method==='GET'?'selected':''}>GET</option></select></div><div class="field full"><label>URL do pacote / webhook</label><input class="input" name="webhookUrl" value="${safe(r.webhookUrl)}" placeholder="https://painel.la/api/chatbot/... ou seu webhook"></div><div class="field full"><label>Resposta ao cliente / observação</label><textarea name="reply" rows="5" placeholder="Se o painel retornar texto pronto, esta resposta pode ficar como fallback.">${safe(r.reply)}</textarea></div></div><div class="webhook-help"><strong>Request enviado para a URL</strong><pre>{ "senderPhone": "5588999991111", "message": "${safe(r.keyword || 'teste iptv')}" }</pre></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancelar</button><button class="btn primary">Salvar automação</button></div></form>`;
  modal.hidden = false;
  document.querySelector('#rule-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data = { id: r.id || null, name: f.get('name'), keyword: f.get('keyword'), match: f.get('match'), responseType: f.get('responseType'), method: f.get('method'), webhookUrl: f.get('webhookUrl'), action: f.get('responseType'), reply: f.get('reply'), active: true };
    if (!data.id && !productionMode()) data.id = crypto.randomUUID();
    try {
      const remote = await persistRuleRemote(data);
      if (remote?.data) Object.assign(data, remote.data);
      const i = state.rules.findIndex(x => x.id === data.id);
      i >= 0 ? state.rules[i] = data : state.rules.unshift(data);
      save();
      modal.hidden = true;
      toast('Resposta automática salva.');
      location.hash = '#chatbot';
      render();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Falha ao salvar resposta automática.');
    }
  };
}

function openAppModal() {
  const devices = state.devices || [];
  if (!devices.length) { toast('Crie e conecte um dispositivo antes do aplicativo.'); location.hash = '#dispositivos'; return; }
  modalContent.innerHTML = `<h2>Criar aplicativo</h2><p class="subtitle">As chaves serão mostradas apenas uma vez.</p><form id="app-form"><div class="field"><label>Nome</label><input class="input" name="name" required placeholder="Ex.: Painel IPTV Alpha"></div><div class="field" style="margin-top:12px"><label>Dispositivo</label><select class="select" name="deviceId">${devices.map(d=>`<option value="${d.id}">${safe(d.name)}</option>`).join('')}</select></div><div id="app-result"></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancelar</button><button class="btn primary">Gerar credenciais</button></div></form>`;
  modal.hidden = false;
  document.querySelector('#app-form').onsubmit = createApp;
}

async function createApp(e) {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const button = e.currentTarget.querySelector('button[type="submit"],button.btn.primary');
  button.disabled = true;
  button.textContent = 'Gerando…';
  try {
    const response = await window.apiFetch('/api/apps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: f.get('name'), deviceId: f.get('deviceId') }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Falha ao criar aplicativo');
    document.querySelector('#app-result').innerHTML = `<div class="secret-result"><strong>Salve agora. Não mostraremos novamente.</strong><label>App Key</label><code>${safe(data.data.appKey)}</code><label>Auth Key</label><code>${safe(data.data.authKey)}</code></div>`;
    button.hidden = true;
    await syncRemote();
  } catch (error) {
    toast(error.message);
    button.disabled = false;
    button.textContent = 'Tentar novamente';
  }
}

async function openExistingQrModal(id) {
  const device = (state.devices || []).find(d => d.id === id);
  modalContent.innerHTML = `<h2>Gerar QR Code</h2><p class="subtitle">Vamos pedir um novo QR Code para esta instância existente.</p><div id="device-result"><p class="subtitle">Solicitando QR Code à Evolution API...</p></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancelar</button></div>`;
  modal.hidden = false;
  const result = document.querySelector('#device-result');
  try {
    const response = await window.apiFetch(`/api/devices/${encodeURIComponent(id)}`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível gerar QR Code');
    const qr = data.qrCode ? (data.qrCode.startsWith('data:') ? data.qrCode : `data:image/png;base64,${data.qrCode}`) : '';
    const webhookNote = data.webhookWarning ? `<div class="call-note"><strong>Atenção ao webhook</strong><p>${safe(data.webhookWarning)}</p><p>Se a resposta automática não funcionar, configure o webhook manualmente na Evolution.</p></div>` : '';
    result.innerHTML = `<div class="qr-result"><strong>Instância: ${safe(data.instanceName || device?.instance_name || device?.name || '')}</strong>${qr?`<img src="${qr}" alt="QR Code do WhatsApp"><p>WhatsApp → Aparelhos conectados → Conectar aparelho</p>`:'<p>A Evolution não devolveu um QR Code para esta instância.</p>'}<span class="badge pending" id="connection-state">Aguardando leitura</span></div>${webhookNote}`;
    if (qr) watchConnection(id);
  } catch (error) {
    result.innerHTML = `<div class="call-note"><strong>Não foi possível gerar o QR</strong><p>${safe(error.message)}</p><p>Se esse QR expirou, feche esta janela, clique em Excluir no dispositivo pendente e crie novamente.</p></div>`;
  }
}

async function deleteDevice(id) {
  const device = (state.devices || []).find(d => d.id === id);
  if (!confirm(`Excluir o dispositivo "${device?.name || 'selecionado'}"? Depois você poderá criar outro QR Code do zero.`)) return;
  try {
    const response = await window.apiFetch(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível excluir o dispositivo');
    state.devices = (state.devices || []).filter(d => d.id !== id);
    save();
    render();
    toast(data.warning ? 'Dispositivo removido do AutoZap. A Evolution não confirmou apagar a instância antiga.' : 'Dispositivo excluído. Agora você pode criar outro.');
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Falha ao excluir dispositivo.');
  }
}

function openDeviceModal() {
  modalContent.innerHTML = `<h2>Criar dispositivo</h2><p class="subtitle">Crie uma instância na Evolution API e conecte o WhatsApp pelo QR Code.</p><form id="device-form"><div class="field"><label>Nome do dispositivo</label><input class="input" name="name" required minlength="3" placeholder="Ex.: atendimento-principal"></div><div class="field" style="margin-top:12px"><label>Tipo de conexão</label><select class="select" disabled><option>Evolution API • WhatsApp QR Code</option></select></div><div id="device-result" style="margin-top:16px"></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancelar</button><button class="btn primary" id="create-device-submit">Criar e gerar QR Code</button></div></form>`;
  modal.hidden = false;
  document.querySelector('#device-form').onsubmit = createDevice;
}

async function createDevice(e) {
  e.preventDefault();
  const button = document.querySelector('#create-device-submit');
  const result = document.querySelector('#device-result');
  const name = new FormData(e.currentTarget).get('name');
  button.disabled = true;
  button.textContent = 'Criando instância…';
  result.innerHTML = '<p class="subtitle">Conectando ao servidor Evolution API…</p>';
  try {
    if (location.protocol === 'file:') throw new Error('Abra o projeto com netlify dev ou publique no Netlify para usar a função segura.');
    const response = await window.apiFetch('/api/devices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível criar a instância');
    const qr = data.qrCode ? (data.qrCode.startsWith('data:') ? data.qrCode : `data:image/png;base64,${data.qrCode}`) : '';
    result.innerHTML = `<div class="qr-result"><strong>Instância criada: ${safe(data.instanceName)}</strong>${qr?`<img src="${qr}" alt="QR Code do WhatsApp"><p>WhatsApp → Aparelhos conectados → Conectar aparelho</p>`:'<p>A instância foi criada, mas o servidor não devolveu o QR Code.</p>'}<span class="badge pending" id="connection-state">Aguardando leitura</span></div>`;
    button.hidden = true;
    if (qr) watchConnection(data.id);
  } catch (error) {
    result.innerHTML = `<div class="call-note"><strong>Não foi possível criar</strong><p>${safe(error.message)}</p></div>`;
    button.disabled = false;
    button.textContent = 'Tentar novamente';
  }
}

function watchConnection(instanceName) {
  let attempts = 0;
  const timer = setInterval(async () => {
    if (modal.hidden || attempts++ > 40) { clearInterval(timer); return; }
    try {
      const response = await window.apiFetch(`/api/devices/${encodeURIComponent(instanceName)}`);
      const data = await response.json();
      const status = document.querySelector('#connection-state');
      if (!status) { clearInterval(timer); return; }
      if (['open','connected'].includes(String(data.state).toLowerCase())) {
        status.className = 'badge active';
        status.textContent = 'Conectado';
        clearInterval(timer);
        toast('WhatsApp conectado com sucesso.');
      }
    } catch {}
  }, 3000);
}

function makeRuleFromLink(id) {
  const link = state.testLinks.find(t => t.id === id);
  if (!link) return;
  openRule({ name: `Gerar teste • ${link.packageName}`, keyword: link.keyword, match: 'Frase exata', responseType: 'URL / Servidor externo / Webhook', method: 'POST', webhookUrl: link.url, reply: 'O painel IPTV retorna os dados do teste e o motor envia ao cliente.', active: true });
}

function openPixPaymentModal(payment) {
  const qrImage = payment.qrCodeBase64 ? '<img src="' + safe(payment.qrCodeBase64) + '" alt="QR Code Pix" class="pix-qr">' : '';
  const expires = payment.expiresAt ? new Date(payment.expiresAt).toLocaleString('pt-BR') : 'em alguns minutos';
  modalContent.innerHTML = '<h2>Pagamento via Pix</h2><p class="subtitle">Escaneie o QR Code ou copie o código Pix para ativar seu plano após a confirmação.</p><div class="pix-box">' + qrImage + '<div><strong>Valor: R$ ' + Number(payment.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + '</strong><small>Vence em: ' + safe(expires) + '</small></div></div><div class="field full"><label>Pix copia e cola</label><textarea rows="5" readonly>' + safe(payment.qrCode || '') + '</textarea></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Fechar</button><button type="button" class="btn primary" data-action="copy-pix-code" data-pix="' + safe(payment.qrCode || '') + '">Copiar Pix</button></div><div class="call-note"><strong>Liberação automática</strong><p>Quando o Mercado Pago confirmar o Pix, o AutoZap atualiza seu plano pelo webhook.</p></div>';
  modal.hidden = false;
}

function copy(text, message) {
  navigator.clipboard?.writeText(text).then(() => toast(message)).catch(() => toast(text));
}

function subscriberTopBar() {
  const account = state.account || {};
  if (account.platformAdmin) return '';
  const tenant = account.tenant || {};
  const subscription = account.subscription || {};
  const usage = account.usage || {};
  const profile = account.profile || {};
  const plan = subscription.plan_code || tenant.plan_code || 'starter';
  const status = subscription.status || tenant.status || (productionMode() ? 'trial' : 'demo');
  const name = tenant.name || profile.full_name || 'Minha operação';
  const email = profile.email || 'E-mail não informado';
  return '<section class="subscriber-topbar"><div class="operation-cell"><small>Assinante</small><strong>' + safe(name) + '</strong><button class="mini-edit" data-action="edit-operation">Editar</button></div><div><small>E-mail</small><strong>' + safe(email) + '</strong></div><div><small>WhatsApp</small><strong>' + safe(connectedDeviceLabel()) + '</strong></div><div><small>Plano</small><strong>' + safe(String(plan).toUpperCase()) + '</strong></div><div><small>Status</small><strong>' + safe(adminStatusLabel(status)) + '</strong></div><div><small>Teste grátis</small><strong>' + safe(account.access?.trialDaysLeft ?? 0) + ' dia(s)</strong></div><div><small>Uso mensal</small><strong>' + usageText(usage.messagesUsedThisMonth, usage.messagesLimit) + '</strong></div></section>';
}

function render() {
  const r = effectiveRoute();
  title.textContent = titles[r] || 'Dashboard';
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.route === route() || a.dataset.route === r));
  app.innerHTML = subscriberTopBar() + (views[r] || views.dashboard)();
  const form = document.querySelector('#send-form');
  if (form) form.onsubmit = e => { e.preventDefault(); toast('Envio simulado. Configure o provedor WhatsApp para enviar de verdade.'); };
  const leadForm = document.querySelector('#lead-settings-form');
  if (leadForm) leadForm.onsubmit = saveLeadSettings;
}

function toast(text) {
  const t = document.querySelector('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(window.tt);
  window.tt = setTimeout(() => t.hidden = true, 3000);
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const a = b.dataset.action;
  if (a === 'refresh-remote') {
    await syncRemote();
    toast('Dados atualizados.');
  }
  if (a === 'plan-interest') {
    const planCode = b.dataset.plan;
    const currentPlan = String(state.account?.subscription?.plan_code || state.account?.tenant?.plan_code || '').toLowerCase();
    if (planCode && planCode === currentPlan) { toast('Este já é seu plano atual.'); return; }
    if (!productionMode()) { toast('Checkout disponível apenas no ambiente publicado.'); return; }
    try {
      b.disabled = true;
      b.textContent = 'Gerando Pix...';
      const response = await window.apiFetch('/api/mercadopago/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planCode }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível gerar Pix');
      if (data.data?.method === 'pix') {
        openPixPaymentModal(data.data);
        b.disabled = false;
        b.textContent = 'Quero esse plano';
        return;
      }
      const checkoutUrl = data.data?.checkoutUrl || data.data?.sandboxCheckoutUrl;
      if (!checkoutUrl) throw new Error('Mercado Pago não retornou link de pagamento');
      location.href = checkoutUrl;
    } catch (error) {
      b.disabled = false;
      toast(error instanceof Error ? error.message : 'Falha ao abrir pagamento.');
      render();
    }
  }
  if (a === 'save-admin-tenant') {
    const row = b.closest('tr[data-tenant]');
    const field = name => row?.querySelector(`[data-admin-field="${name}"]`)?.value;
    try {
      const response = await window.apiFetch('/api/admin/overview', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: b.dataset.id, planCode: field('planCode'), status: field('status'), maxDevices: field('maxDevices'), maxApps: field('maxApps'), monthlyMessageLimit: field('monthlyMessageLimit') }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Falha ao atualizar cliente');
      state.adminDashboard = data;
      toast('Cliente atualizado.');
      render();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Falha ao atualizar cliente.');
    }
  }
  if (a === 'sign-out') { window.signOut?.(); return; }
  if (a === 'edit-operation') openOperationModal();
  if (a === 'new-rule') openRule();
  if (a === 'edit-rule') openRule(state.rules.find(r => r.id === b.dataset.id));
  if (a === 'toggle-rule') { const r = state.rules.find(r => r.id === b.dataset.id); r.active = !r.active; save(); render(); }
  if (a === 'close-modal') modal.hidden = true;
  if (a === 'simulate') toast('Simulado: palavra-chave encontrada, URL chamada e resposta enviada.');
  if (a === 'new-device') openDeviceModal();
  if (a === 'show-device-qr') openExistingQrModal(b.dataset.id);
  if (a === 'delete-device') deleteDevice(b.dataset.id);
  if (a === 'new-template') toast('Editor de templates será conectado ao banco.');
  if (a === 'edit-provider') openProviderModal();
  if (a === 'new-package') openPackageModal();
  if (a === 'set-provider-mode') { try { state.iptvProvider = { ...(state.iptvProvider || {}), mode: b.dataset.mode }; await persistProviderRemote(state.iptvProvider); save(); render(); toast(b.dataset.mode === 'api' ? 'Modo API completa selecionado.' : 'Modo links de teste selecionado.'); } catch (error) { toast(error instanceof Error ? error.message : 'Falha ao salvar modo IPTV.'); } }
  if (a === 'test-package-url') { const p = state.testLinks.find(x => x.id === b.dataset.id); toast(p?.url ? 'URL pronta para teste seguro pelo backend: ' + p.url.slice(0, 42) + '...' : 'Pacote não encontrado.'); }
  if (a === 'delete-package') { try { await deletePackageRemote(b.dataset.id); state.testLinks = state.testLinks.filter(x => x.id !== b.dataset.id); save(); render(); toast('Pacote removido.'); } catch (error) { toast(error instanceof Error ? error.message : 'Falha ao remover pacote.'); } }
  if (a === 'schedule') { state.scheduled.push({ id: crypto.randomUUID() }); save(); render(); toast('Agendamento de demonstração criado.'); }
  if (a === 'diagnose' || a === 'test-engine') toast('Diagnóstico concluído: WhatsApp e motor online; API IPTV em modo modelo.');
  if (a === 'restart-device') toast('Reinício simulado. Em produção, esta ação reiniciará a sessão do WhatsApp.');
  if (a === 'device-settings') toast('Configurações do dispositivo: sessão, proxy, webhook e comportamento de chamadas.');
  if (a === 'new-app') openAppModal();
  if (a === 'copy-pix-code') copy(b.dataset.pix, 'Código Pix copiado.');
  if (a === 'copy-url') copy(b.dataset.url, 'URL copiada.');
  if (a === 'copy-payload') copy('{"senderPhone":"5588999991111","message":"teste iptv"}', 'Payload copiado.');
  if (a === 'make-rule') makeRuleFromLink(b.dataset.id);
  if (a === 'copy-endpoint') toast('Endpoint: /api/iptv/send');
});

document.querySelector('#mobile-menu').onclick = () => document.querySelector('.sidebar').classList.toggle('open');
window.addEventListener('hashchange', render);
window.addEventListener('autozap-authenticated', event => { if (!event.detail?.demo) syncRemote(); });
render();
















