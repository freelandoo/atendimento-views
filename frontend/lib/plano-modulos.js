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

// Rótulo do plano que libera o módulo (para o CTA).
function planoQueLibera(modulo) {
  if (!modulo) return null
  if (modulo.liberaEm === 'pro') return 'Pro'
  if (modulo.liberaEm === 'basico') return 'Profissional'
  if (modulo.liberaEm === 'minimo') return 'Essencial'
  return 'pago'
}

// Este plano fica BLOQUEADO neste módulo?
function bloqueado(plano, modulo) {
  if (!modulo) return false
  return nivelDoPlano(plano) < NIVEL[modulo.liberaEm]
}

module.exports = { NIVEL, MODULOS, nivelDoPlano, moduloDaRota, planoQueLibera, bloqueado }
