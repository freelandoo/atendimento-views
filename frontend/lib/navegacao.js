'use strict'
// Navegação do painel — ÁRVORE E REGRAS PURAS.
//
// Por que este módulo existe: a navegação deixou de ser uma lista plana de 16 itens e
// virou uma árvore com dois grupos expansíveis (Operação e Configurações). O que é grupo,
// quem enxerga o quê, qual item está ativo e "grupo sem filho visível some" são REGRA —
// e essa regra é desenhada em DOIS lugares (a coluna do desktop e o drawer do mobile).
// Mantê-la aqui é o que impede as duas apresentações de divergirem com o tempo.
//
// Sem React, sem rede, sem DOM: testável com `node --test` (mesmo padrão de paginacao.js).
//
// Regra de ouro: esta árvore é APRESENTAÇÃO. Quem protege rota é o backend
// (`requireAuth` + `requireRole` + `requireEmpresaAccess`). Esconder um item aqui deixa a
// tela honesta; nunca substitui o controle de acesso.

/** @typedef {'user'|'admin'|'superadmin'} Role */

const NIVEL_ROLE = { user: 1, admin: 2, superadmin: 3 }

/**
 * Papel do usuário alcança o mínimo exigido?
 * `minimo` nulo/ausente = item público. Exigência desconhecida NEGA — um enum novo
 * escrito errado não pode virar porta aberta.
 */
function podePapel(role, minimo) {
  if (minimo == null) return true
  const exigido = NIVEL_ROLE[minimo]
  if (exigido == null) return false
  return (NIVEL_ROLE[role] ?? NIVEL_ROLE.user) >= exigido
}

// A árvore. `href` é a rota REAL — nenhuma rota foi renomeada nesta reorganização,
// só o rótulo. `aliases` são rotas que existem e devem acender o mesmo item:
// `/dashboard/prospeccao` e `/dashboard/captacao` existem como rota E são renderizadas
// como abas dentro de `/dashboard/aquisicao`; `/dashboard/instancias/:id/contexto` é
// página filha de Instâncias; `/dashboard/empresa` é o redirect antigo para Instâncias.
// Sem os aliases, quem entrasse por esses caminhos não acenderia item nem grupo algum.
const NAV = [
  { tipo: 'item', href: '/dashboard', label: 'Visão Geral', icon: 'overview', exato: true },
  { tipo: 'item', href: '/dashboard/conversas', label: 'Central de Mensagens', icon: 'chat' },
  { tipo: 'item', href: '/dashboard/central-ligacoes', label: 'Central de Ligações', icon: 'central', minRole: 'admin' },
  {
    tipo: 'grupo',
    id: 'operacao',
    label: 'Operação',
    icon: 'operacao',
    itens: [
      { tipo: 'item', href: '/dashboard/aquisicao', label: 'Aquisição', icon: 'prospect', minRole: 'admin', aliases: ['/dashboard/prospeccao', '/dashboard/captacao'] },
      { tipo: 'item', href: '/dashboard/banco-leads', label: 'Banco de Leads', icon: 'leads', minRole: 'admin' },
      { tipo: 'item', href: '/dashboard/follow-ups', label: 'Follow-ups', icon: 'followup', minRole: 'admin' },
      { tipo: 'item', href: '/dashboard/roteiros', label: 'Roteiros', icon: 'roteiro', minRole: 'admin' },
      { tipo: 'item', href: '/dashboard/agenda', label: 'Agenda', icon: 'agenda' },
    ],
  },
  { tipo: 'item', href: '/dashboard/relatorios', label: 'Relatórios', icon: 'report', minRole: 'admin' },
  {
    tipo: 'grupo',
    id: 'configuracoes',
    label: 'Configurações',
    icon: 'settings',
    itens: [
      { tipo: 'item', href: '/dashboard/contextos', label: 'Instâncias', icon: 'company', aliases: ['/dashboard/instancias', '/dashboard/empresa'] },
      { tipo: 'item', href: '/dashboard/playbook', label: 'Playbook', icon: 'playbook', minRole: 'admin' },
      { tipo: 'item', href: '/dashboard/llm', label: 'Modelo e IA', icon: 'model', minRole: 'admin' },
      { tipo: 'item', href: '/dashboard/prompts', label: 'Prompts e Saudações', icon: 'prompts', minRole: 'admin' },
      { tipo: 'item', href: '/dashboard/uso', label: 'Uso e custos', icon: 'usage', minRole: 'admin' },
      { tipo: 'item', href: '/dashboard/integracoes', label: 'Integrações', icon: 'integracoes', minRole: 'admin' },
      { tipo: 'item', href: '/dashboard/contas', label: 'Contas', icon: 'accounts', minRole: 'superadmin' },
    ],
  },
  { tipo: 'item', href: '/dashboard/perfil', label: 'Perfil', icon: 'profile' },
]

const IDS_GRUPOS = NAV.filter((n) => n.tipo === 'grupo').map((g) => g.id)

/** Tira barra final e query/hash. `/dashboard/uso/` e `/dashboard/uso` são a mesma tela. */
function normalizarRota(valor) {
  const bruto = String(valor == null ? '' : valor)
  const semQuery = bruto.split('?')[0].split('#')[0]
  if (semQuery.length > 1 && semQuery.endsWith('/')) return semQuery.slice(0, -1)
  return semQuery
}

/**
 * A rota atual pertence a este destino?
 * Comparação por SEGMENTO, não por prefixo de texto: `/dashboard/conversas` não pode ser
 * acesa por uma rota futura chamada `/dashboard/conversas-arquivadas`.
 */
function mesmaRota(pathname, destino, exato = false) {
  const atual = normalizarRota(pathname)
  const alvo = normalizarRota(destino)
  if (!alvo) return false
  if (atual === alvo) return true
  if (exato) return false
  return atual.startsWith(`${alvo}/`)
}

/** Todas as rotas que acendem um item: a própria + os aliases. */
function rotasDoItem(item) {
  const extras = Array.isArray(item && item.aliases) ? item.aliases : []
  return [item && item.href, ...extras].filter(Boolean)
}

/** O item está ativo para a rota atual? */
function itemAtivo(pathname, item) {
  if (!item) return false
  return rotasDoItem(item).some((rota) => mesmaRota(pathname, rota, !!item.exato))
}

/** Filtra um item pelo papel. */
function itemVisivel(item, role) {
  return podePapel(role, item.minRole)
}

/**
 * A árvore que este papel enxerga. Grupo que ficou SEM filho visível some inteiro —
 * senão um `user` veria "Configurações" abrir vazio, o que é pior que não ver o grupo.
 */
function navegacaoVisivel(role, arvore = NAV) {
  const saida = []
  for (const no of arvore) {
    if (no.tipo === 'grupo') {
      const itens = no.itens.filter((item) => itemVisivel(item, role))
      if (itens.length) saida.push({ ...no, itens })
      continue
    }
    if (itemVisivel(no, role)) saida.push(no)
  }
  return saida
}

/** Lista plana de todos os itens visíveis (grupos achatados). Útil em busca/testes. */
function itensVisiveis(role, arvore = NAV) {
  const saida = []
  for (const no of navegacaoVisivel(role, arvore)) {
    if (no.tipo === 'grupo') saida.push(...no.itens)
    else saida.push(no)
  }
  return saida
}

/**
 * Onde estamos: qual item acende e dentro de qual grupo.
 * `grupoId` é o que faz o grupo da página atual abrir sozinho e receber o destaque de
 * seção ativa. Rota fora da árvore devolve os dois nulos — ninguém acende por engano.
 */
function resolverAtivo(pathname, role, arvore = NAV) {
  for (const no of navegacaoVisivel(role, arvore)) {
    if (no.tipo === 'grupo') {
      const achado = no.itens.find((item) => itemAtivo(pathname, item))
      if (achado) return { href: achado.href, grupoId: no.id }
      continue
    }
    if (itemAtivo(pathname, no)) return { href: no.href, grupoId: null }
  }
  return { href: null, grupoId: null }
}

/**
 * Estado de abertura dos grupos, saneado.
 * Recebe o que veio do localStorage (pode ser lixo) + o grupo da página atual, que é
 * SEMPRE incluído: navegar para uma página escondida dentro de um grupo fechado e não
 * ver onde você está seria pior que a lista plana de antes.
 */
function normalizarGruposAbertos(valor, grupoAtivo = null, ids = IDS_GRUPOS) {
  const lista = Array.isArray(valor) ? valor : []
  const abertos = new Set(lista.filter((id) => ids.includes(id)))
  if (grupoAtivo && ids.includes(grupoAtivo)) abertos.add(grupoAtivo)
  return ids.filter((id) => abertos.has(id))
}

/** Abre/fecha um grupo, devolvendo uma lista nova (sem mutar a anterior). */
function alternarGrupo(abertos, id, ids = IDS_GRUPOS) {
  if (!ids.includes(id)) return normalizarGruposAbertos(abertos, null, ids)
  const atual = new Set(Array.isArray(abertos) ? abertos : [])
  if (atual.has(id)) atual.delete(id)
  else atual.add(id)
  return ids.filter((g) => atual.has(g))
}

/** Lê com segurança o JSON gravado no localStorage. Lixo vira lista vazia. */
function lerGruposAbertos(bruto) {
  if (!bruto) return []
  try {
    const dados = JSON.parse(bruto)
    return Array.isArray(dados) ? dados.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

module.exports = {
  NAV,
  IDS_GRUPOS,
  NIVEL_ROLE,
  podePapel,
  normalizarRota,
  mesmaRota,
  rotasDoItem,
  itemAtivo,
  itemVisivel,
  navegacaoVisivel,
  itensVisiveis,
  resolverAtivo,
  normalizarGruposAbertos,
  alternarGrupo,
  lerGruposAbertos,
}
