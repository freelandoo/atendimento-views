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

// ─── CRM EM EQUIPE, ETAPA 6.3: O MENU PASSOU A FILTRAR POR CAPACIDADE ───────────────────
//
// Antes, cada item declarava `minRole` e a filtragem era uma ESCADA numérica
// (`user < admin < superadmin`) sobre o papel GLOBAL. Duas coisas estavam erradas nisso:
//
//   1. o papel global não é o que autoriza desde a Etapa 1 — quem autoriza é o papel do
//      VÍNCULO com a empresa (`app.usuarios_empresas.role`);
//   2. o papel `comercial` **não cabe numa escada**: ele precisa de MAIS que `member`
//      (operar a Central de Ligações) e MENOS que `admin` (não gastar coleta paga). Qualquer
//      nível intermediário abriria uma coisa errada ou fecharia outra.
//
// Agora cada item declara `capacidade`, e o menu recebe a lista que o BACKEND já resolveu
// (`/api/auth/me` → papel do vínculo + concessões aditivas). A tela não recalcula nada.
//
// `NIVEL_ROLE`/`podePapel` continuam exportados: `/dashboard/contas` é de PLATAFORMA e
// segue sendo decidido pelo papel global (`superadmin`), não por capacidade de empresa.

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
  { tipo: 'item', href: '/dashboard/central-ligacoes', label: 'Central de Ligações', icon: 'central', capacidade: 'ligacao_operar' },
  {
    tipo: 'grupo',
    id: 'operacao',
    label: 'Operação',
    icon: 'operacao',
    itens: [
      { tipo: 'item', href: '/dashboard/aquisicao', label: 'Aquisição', icon: 'prospect', capacidade: 'aquisicao_gerenciar', aliases: ['/dashboard/prospeccao', '/dashboard/captacao'] },
      { tipo: 'item', href: '/dashboard/banco-leads', label: 'Banco de Leads', icon: 'leads', capacidade: 'lead_ver_aprovados' },
      { tipo: 'item', href: '/dashboard/follow-ups', label: 'Follow-ups', icon: 'followup', capacidade: 'followup_operar' },
      { tipo: 'item', href: '/dashboard/roteiros', label: 'Roteiros', icon: 'roteiro', capacidade: 'roteiro_ler' },
      { tipo: 'item', href: '/dashboard/agenda', label: 'Agenda', icon: 'agenda' },
      // Comissao (migration 083). A capacidade e a de LEITURA: o comercial precisa conferir o
      // proprio dinheiro. Gerir plano/venda/pagamento exige `comissao_gerenciar`, checado na rota.
      { tipo: 'item', href: '/dashboard/comissao', label: 'Comissão', icon: 'report', capacidade: 'comissao_ver_propria' },
      // AREA DE EQUIPE. Quem gerencia as contas responde pela distribuicao do trabalho, entao
      // e' a MESMA capacidade de "Contas da empresa" — nao uma terceira. Desde 2026-09-19 esta
      // area tambem contem a gestao das EQUIPES COMERCIAIS (aba "Equipes"), que era uma pagina
      // separada em Configuracoes.
      { tipo: 'item', href: '/dashboard/equipe', label: 'Equipe', icon: 'accounts', capacidade: 'membros_gerenciar' },
    ],
  },
  { tipo: 'item', href: '/dashboard/relatorios', label: 'Relatórios', icon: 'report', capacidade: 'relatorios_ver' },
  {
    tipo: 'grupo',
    id: 'configuracoes',
    label: 'Configurações',
    icon: 'settings',
    itens: [
      { tipo: 'item', href: '/dashboard/contextos', label: 'Instâncias', icon: 'company', aliases: ['/dashboard/instancias', '/dashboard/empresa'] },
      { tipo: 'item', href: '/dashboard/playbook', label: 'Playbook', icon: 'playbook', capacidade: 'instancia_gerenciar_contexto' },
      { tipo: 'item', href: '/dashboard/llm', label: 'Modelo e IA', icon: 'model', capacidade: 'integracoes_gerenciar' },
      { tipo: 'item', href: '/dashboard/prompts', label: 'Prompts e Saudações', icon: 'prompts', capacidade: 'integracoes_gerenciar' },
      { tipo: 'item', href: '/dashboard/uso', label: 'Uso e custos', icon: 'usage', capacidade: 'integracoes_gerenciar' },
      { tipo: 'item', href: '/dashboard/integracoes', label: 'Integrações', icon: 'integracoes', capacidade: 'integracoes_gerenciar' },
      // Contas da EMPRESA (Etapa 2). Desde a Etapa 6.3 o item filtra pela MESMA capacidade que
      // o backend exige na rota — os dois passaram a falar a mesma língua.
      { tipo: 'item', href: '/dashboard/contas-empresa', label: 'Contas da empresa', icon: 'accounts', capacidade: 'membros_gerenciar' },
      // ⚠️ "Equipes comerciais" NAO e' mais um item aqui (2026-09-19). Ela e as Equipes eram
      // partes do MESMO fluxo — montar a equipe e olhar o resultado — separadas em duas paginas,
      // com a MESMA capacidade. Foram unificadas em `/dashboard/equipe` (aba "Equipes"), que ja
      // aparece no grupo Operacao. Recriar o item aqui devolveria a viagem no meio do trabalho.
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

/**
 * Filtra um item pelo ACESSO de quem está olhando.
 *
 * `acesso` = `{ role, capacidades }`. Por compatibilidade, uma STRING é aceita e tratada como o
 * papel global — é o que os chamadores antigos passavam, e o que `/dashboard/contas` (plataforma)
 * continua usando.
 *
 * Regras, nesta ordem:
 *   1. item sem exigência → visível (Visão Geral, Perfil, Conversas, Agenda, Instâncias);
 *   2. item com `minRole` → escada do papel GLOBAL (só `/dashboard/contas`, que é de plataforma);
 *   3. item com `capacidade` → a lista que o backend resolveu.
 *
 * **Capacidade desconhecida ou lista ausente ESCONDE.** Enquanto a sessão carrega,
 * `capacidades` é `null` e o menu mostra só o que não exige nada — mostrar um item que vai
 * responder 403 é pior que mostrá-lo um instante depois.
 */
function normalizarAcesso(acesso) {
  if (typeof acesso === 'string' || acesso == null) return { role: acesso || undefined, capacidades: null }
  return { role: acesso.role, capacidades: Array.isArray(acesso.capacidades) ? acesso.capacidades : null }
}

function itemVisivel(item, acesso) {
  const { role, capacidades } = normalizarAcesso(acesso)
  if (item && item.minRole) return podePapel(role, item.minRole)
  if (item && item.capacidade) {
    // `superadmin` é operador da PLATAFORMA e alcança tudo — o backend já responde assim
    // (`avaliarCapacidade` devolve `plataforma`). Sem isto, o menu esconderia dele o que a API
    // libera, e a tela mentiria sobre o próprio acesso.
    if (role === 'superadmin') return true
    return Array.isArray(capacidades) && capacidades.includes(item.capacidade)
  }
  return true
}

/**
 * A árvore que este acesso enxerga. Grupo que ficou SEM filho visível some inteiro —
 * senão alguém veria "Configurações" abrir vazio, o que é pior que não ver o grupo.
 */
/**
 * O rótulo do item, que para UM item depende de quem olha.
 *
 * `/dashboard` renderiza duas telas diferentes: a Visão Geral administrativa para quem tem
 * `relatorios_ver` e **Minha Operação** para quem não tem (ver `lib/minha-operacao.js`). Sem esta
 * substituição o menu diria "Visão Geral" e a tela diria "Minha Operação" — o menu mentiria sobre
 * o próprio destino.
 *
 * A regra é a MESMA capacidade que decide a tela. Duplicá-la como literal noutro lugar faria o
 * rótulo e o conteúdo divergirem no primeiro ajuste.
 */
const ROTULO_ALTERNATIVO = { '/dashboard': { semCapacidade: 'relatorios_ver', label: 'Minha Operação' } }

function rotularItem(item, acesso) {
  const alt = ROTULO_ALTERNATIVO[item && item.href]
  if (!alt) return item
  const { capacidades } = normalizarAcesso(acesso)
  // Enquanto as capacidades não carregaram, mantém o rótulo padrão: trocar o texto do menu duas
  // vezes por carregamento é pior que mostrá-lo um instante depois.
  if (!Array.isArray(capacidades) || capacidades.length === 0) return item
  return capacidades.includes(alt.semCapacidade) ? item : { ...item, label: alt.label }
}

function navegacaoVisivel(acesso, arvore = NAV) {
  const saida = []
  for (const no of arvore) {
    if (no.tipo === 'grupo') {
      const itens = no.itens.filter((item) => itemVisivel(item, acesso)).map((item) => rotularItem(item, acesso))
      if (itens.length) saida.push({ ...no, itens })
      continue
    }
    if (itemVisivel(no, acesso)) saida.push(rotularItem(no, acesso))
  }
  return saida
}

/** Lista plana de todos os itens visíveis (grupos achatados). Útil em busca/testes. */
function itensVisiveis(acesso, arvore = NAV) {
  const saida = []
  for (const no of navegacaoVisivel(acesso, arvore)) {
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
function resolverAtivo(pathname, acesso, arvore = NAV) {
  for (const no of navegacaoVisivel(acesso, arvore)) {
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
  normalizarAcesso,
  navegacaoVisivel,
  itensVisiveis,
  resolverAtivo,
  normalizarGruposAbertos,
  alternarGrupo,
  lerGruposAbertos,
}
