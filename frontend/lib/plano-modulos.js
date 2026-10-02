// Matriz de ACESSO por plano (§12 da proposta). Fonte única do que cada plano LIBERA por módulo.
// Só os módulos BLOQUEÁVEIS entram aqui — os usáveis para todos (Banco de Leads, Agenda, Follow-ups,
// Aquisição, Assinatura, Integrações, Minha Operação) não precisam de entrada.
//
// A tela só TRADUZ o veredito do plano (/me). O BACKEND continua a autoridade das AÇÕES (rotas +
// motor). Isto governa a NAVEGAÇÃO/página: módulo não liberado → PaginaBloqueada.
//
// FAIL-OPEN: plano desconhecido ou ausente (grandfather) = nível Pro → nada bloqueia. Nunca
// trancar quem paga por erro de leitura.

const NIVEL = { trial: 0, minimo: 1, basico: 2, pro: 3 }

const MODULOS = {
  '/dashboard/conversas': { liberaEm: 'minimo', titulo: 'Central de Mensagens', faz: 'Atenda seus leads no WhatsApp pelo painel, com histórico de cada conversa.' },
  '/dashboard/contextos': { liberaEm: 'minimo', titulo: 'Instâncias', faz: 'Conecte seus números de WhatsApp para atender pelo sistema.' },
  '/dashboard/central-ligacoes': { liberaEm: 'pro', titulo: 'Central de Ligações', faz: 'Organize, priorize e registre as ligações do time comercial.' },
  '/dashboard/roteiros': { liberaEm: 'pro', titulo: 'Roteiros', faz: 'Crie roteiros de ligação para padronizar a abordagem do time.' },
  '/dashboard/equipe': { liberaEm: 'pro', titulo: 'Equipe', faz: 'Monte o time comercial, distribua a carteira e acompanhe a carga.' },
  '/dashboard/comissao': { liberaEm: 'pro', titulo: 'Comissão', faz: 'Acompanhe comissões, metas e o ranking do time.' },
  '/dashboard/contas-empresa': { liberaEm: 'pro', titulo: 'Contas da empresa', faz: 'Adicione e gerencie os usuários da sua empresa.' },
  '/dashboard/relatorios': { liberaEm: 'basico', titulo: 'Relatórios', faz: 'Acompanhe o desempenho da operação: funil, conversões e resultados por período.' },
  '/dashboard/integracoes': { liberaEm: 'minimo', titulo: 'Integrações', faz: 'Envie seus resultados para a Meta (conversões de anúncios).' },
}

// ÚNICA fonte dos metadados comerciais do plano (nome, preço/mês em R$, se está em construção).
// Mudar nome/preço = mudar AQUI. `pro` = o plano de R$600 de EQUIPE, ainda EM CONSTRUÇÃO (não
// vendável) — por isso `em_construcao`. 'legado' não é vendável (grandfather interno).
const PLANO_INFO = {
  minimo: { nome: 'Essencial', preco: 79, em_construcao: false },
  basico: { nome: 'Profissional', preco: 149.9, em_construcao: false },
  pro: { nome: 'Empresarial', preco: 600, em_construcao: true },
}

function infoDoPlano(chave) {
  return PLANO_INFO[chave] || null
}

// O que cada plano ENTREGA — listado na tela bloqueada pra ficar claro (e premium) o que a pessoa
// ganha ao assinar. Nomes comerciais placeholder (Essencial/Profissional/Pro).
const BENEFICIOS = {
  minimo: [
    'Atendimento no WhatsApp pelo painel',
    'Banco de Leads e Quadro do Dia',
    'Agenda e follow-up manual',
  ],
  basico: [
    'Tudo do Essencial',
    'IA respondendo no WhatsApp sozinha',
    'Follow-up automático',
    'Busca de leads em qualquer nicho e lugar (Google, Instagram, Meta)',
    'Vários chips com fila anti-ban',
  ],
  pro: [
    'Tudo do Profissional',
    'Central de Ligações',
    'CRM de equipe: metas, comissão e distribuição',
    'Dados completos do lead (cruzamento)',
    'Relatórios e vários usuários',
  ],
}

// Nomes derivados do PLANO_INFO (fonte única). Mantido por compatibilidade de quem já importa.
const NOME_COMERCIAL = { minimo: PLANO_INFO.minimo.nome, basico: PLANO_INFO.basico.nome, pro: PLANO_INFO.pro.nome }

// Benefícios do plano que libera o módulo (para o CTA da PaginaBloqueada).
function beneficiosDoPlano(liberaEm) {
  return BENEFICIOS[liberaEm] || []
}

// Nível efetivo a partir do veredito do plano. Trial é o mais baixo; sem linha = grandfather (Pro).
function nivelDoPlano(plano) {
  if (!plano) return NIVEL.pro
  if (plano.status === 'trial') return NIVEL.trial
  const porNome = { minimo: NIVEL.minimo, basico: NIVEL.basico, pro: NIVEL.pro, legado: NIVEL.pro }
  const n = porNome[plano.nome]
  return n == null ? NIVEL.pro : n // nome desconhecido = fail-open (não bloqueia)
}

// Módulo bloqueável da rota atual (match exato ou subrota), ou null.
function moduloDaRota(pathname) {
  const p = String(pathname || '')
  const chave = Object.keys(MODULOS).find((r) => p === r || p.startsWith(r + '/'))
  return chave ? { chave, ...MODULOS[chave] } : null
}

// Rótulo comercial do plano que libera o módulo (para o CTA).
function planoQueLibera(modulo) {
  if (!modulo) return null
  return NOME_COMERCIAL[modulo.liberaEm] || 'pago'
}

// Este plano fica BLOQUEADO neste módulo?
function bloqueado(plano, modulo) {
  if (!modulo) return false
  return nivelDoPlano(plano) < NIVEL[modulo.liberaEm]
}

module.exports = { NIVEL, MODULOS, BENEFICIOS, NOME_COMERCIAL, PLANO_INFO, infoDoPlano, nivelDoPlano, moduloDaRota, planoQueLibera, beneficiosDoPlano, bloqueado }
