'use strict'
// Contas da empresa — APRESENTAÇÃO PURA. CRM em equipe, Etapa 2.
//
// Regra de ouro, a mesma de `lib/site-rotulos.js` e `lib/pontuacao-indicador.js`:
// **a regra de acesso vive no BACKEND; aqui só se traduz o veredito.**
// Este módulo NÃO tem a matriz papel×capacidade, NÃO decide quem pode o quê e NÃO reimplementa
// `podeCapacidade`. Ele recebe `capacidades` já resolvidas por `/api/auth/me` e a lista de
// concedíveis por papel vinda de `GET .../membros/opcoes`, e produz rótulo, descrição e estado
// de controle. Duplicar a matriz aqui faria a tela e o servidor divergirem em silêncio — e a
// divergência apareceria como "o botão estava lá e deu 403".
//
// Sem React, sem rede, sem DOM: testável com `node --test` (padrão de `lib/paginacao.js`).

// ─── Rótulos ────────────────────────────────────────────────────────────────────────────────
// O backend manda o slug (`lead_triar`); aqui ele ganha nome de gente. Slug desconhecido é
// exibido como ele mesmo, nunca escondido: uma capacidade nova no servidor não pode desaparecer
// da tela de permissões só porque o front ainda não a batizou.

const PAPEL_ROTULO = {
  owner: 'Dono',
  admin: 'Administrador',
  comercial: 'Comercial',
  member: 'Membro',
}

const PAPEL_DESCRICAO = {
  owner: 'Acesso total. Responde pela empresa e não pode ser rebaixado nesta tela.',
  admin: 'Acesso total à operação e às configurações da empresa.',
  comercial: 'Trabalha os leads aprovados: liga, atende, agenda e registra. Não vê a base bruta nem a Aquisição.',
  member: 'Acesso mínimo: atende conversas e usa a própria agenda.',
}

const CAPACIDADE_ROTULO = {
  aquisicao_gerenciar: 'Buscar e importar leads',
  lead_triar: 'Aprovar e descartar leads',
  lead_ver_brutos: 'Ver a base bruta de leads',
  lead_ver_aprovados: 'Ver leads aprovados',
  lead_assumir: 'Assumir lead livre',
  lead_abordar_manual: 'Abordar pelo WhatsApp (manual)',
  lead_disparar_semi: 'Usar o modo semi-automático',
  lead_disparar_lote: 'Disparar mensagens em lote',
  lead_transferir: 'Transferir lead de outra pessoa',
  conversa_atender: 'Atender conversas',
  conversa_ver_todas: 'Ver todas as conversas da empresa',
  conversa_gerenciar_ia: 'Ligar e desligar a IA',
  conversa_apagar_historico: 'Apagar histórico de conversa',
  ligacao_operar: 'Operar a Central de Ligações',
  ligacao_ver_todas: 'Ver ligações de toda a equipe',
  campanha_gerenciar: 'Criar e editar campanhas',
  followup_ver_fila: 'Ver follow-ups da equipe',
  followup_operar: 'Criar e concluir follow-ups',
  followup_reatribuir: 'Reatribuir follow-up a outra pessoa',
  followup_config_empresa: 'Configurar o follow-up automático',
  roteiro_ler: 'Consultar roteiros',
  roteiro_gerenciar: 'Criar e editar roteiros',
  agenda_operar_propria: 'Usar a própria agenda',
  agenda_ver_equipe: 'Ver a agenda da equipe',
  instancia_gerenciar_propria: 'Conectar o próprio WhatsApp',
  instancia_gerenciar_empresa: 'Gerenciar as instâncias da empresa',
  instancia_gerenciar_contexto: 'Editar o contexto e o playbook',
  membros_gerenciar: 'Gerenciar contas da empresa',
  integracoes_gerenciar: 'Configurar integrações e IA',
  relatorios_ver: 'Ver relatórios da empresa',
}

// Capacidades que merecem aviso ao serem concedidas. Não é "perigoso" no sentido técnico: é o
// que tem efeito FORA do sistema (fala com o cliente, gasta dinheiro) ou é irreversível.
const CAPACIDADE_AVISO = {
  conversa_gerenciar_ia: 'A IA passa a poder responder o cliente automaticamente nas conversas desta pessoa.',
  conversa_apagar_historico: 'Apagar histórico é irreversível.',
  lead_disparar_lote: 'Consome o teto diário de envio e afeta a reputação do número.',
  aquisicao_gerenciar: 'A busca de leads é uma coleta paga.',
  lead_ver_brutos: 'Dá acesso à base inteira, inclusive leads nunca triados e descartados.',
  membros_gerenciar: 'Permite criar e desativar contas desta empresa.',
}

/** Nome de gente para um papel. Papel desconhecido volta como ele mesmo. */
function rotuloPapel(papel) {
  return PAPEL_ROTULO[papel] || String(papel || '—')
}

/** O que o papel significa, em uma frase. Vazio para papel desconhecido (não se inventa). */
function descricaoPapel(papel) {
  return PAPEL_DESCRICAO[papel] || ''
}

/** Nome de gente para uma capacidade. Slug desconhecido volta como ele mesmo. */
function rotuloCapacidade(capacidade) {
  return CAPACIDADE_ROTULO[capacidade] || String(capacidade || '')
}

/** Aviso de consequência, ou `null`. Nunca invente aviso para capacidade sem consequência externa. */
function avisoCapacidade(capacidade) {
  return CAPACIDADE_AVISO[capacidade] || null
}

/**
 * A pessoa tem esta capacidade?
 * Consulta a lista que o SERVIDOR resolveu — não recalcula nada. Lista ausente = não tem, nunca
 * "tem por padrão": se a sessão ainda não carregou, o certo é esconder e não arriscar mostrar um
 * botão que vai dar 403.
 */
function temCapacidade(capacidades, capacidade) {
  return Array.isArray(capacidades) && capacidades.includes(capacidade)
}

/**
 * Monta a lista de concessões para o formulário, a partir do que a API disse ser concedível
 * para aquele papel (`GET .../membros/opcoes`) e do que já está concedido.
 *
 * `marcada` é o estado do controle. Devolve ordenado por rótulo para a lista não dançar entre
 * papéis diferentes.
 */
function concessoesDoFormulario(concedeveis, jaConcedidas) {
  const concedidas = new Set(Object.keys(jaConcedidas || {}).filter((k) => jaConcedidas[k] === true))
  return (Array.isArray(concedeveis) ? concedeveis : [])
    .map((capacidade) => ({
      capacidade,
      rotulo: rotuloCapacidade(capacidade),
      aviso: avisoCapacidade(capacidade),
      marcada: concedidas.has(capacidade),
    }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

/**
 * Converte a lista de caixas marcadas no corpo que a API aceita.
 *
 * SOMENTE ADITIVO, como o backend exige: capacidade desmarcada é **omitida**, nunca enviada
 * como `false`. Mandar `false` é recusado com 400 pela rota — e é o certo: negar não existe
 * neste modelo (negar = trocar o papel).
 */
function corpoPermissoes(marcadas) {
  const saida = {}
  for (const c of Array.isArray(marcadas) ? marcadas : []) {
    if (c) saida[c] = true
  }
  return saida
}

/**
 * Estado de um membro na lista, já resolvido para a tela.
 * `inativo` cobre os DOIS níveis: o vínculo com a empresa e a conta em si. Uma conta desativada
 * globalmente não entra nesta empresa mesmo com vínculo ativo, e mostrar "ativo" nesse caso
 * faria o admin procurar o problema no lugar errado.
 */
function situacaoMembro(membro) {
  const m = membro || {}
  if (m.usuario_ativo === false) {
    return { ativo: false, rotulo: 'Conta desativada', detalhe: 'A conta está desativada na plataforma.' }
  }
  if (m.ativo === false) {
    return { ativo: false, rotulo: 'Sem acesso', detalhe: 'O acesso desta pessoa a esta empresa foi revogado.' }
  }
  return { ativo: true, rotulo: 'Ativo', detalhe: '' }
}

/** "há 3 dias" para o último acesso. `null`/ausente vira "nunca acessou" — nunca uma data falsa. */
function ultimoAcesso(valor, agora = new Date()) {
  if (!valor) return 'nunca acessou'
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return 'nunca acessou'
  const dias = Math.floor((agora.getTime() - d.getTime()) / 86400000)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  if (dias < 30) return `há ${dias} dias`
  const meses = Math.floor(dias / 30)
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`
}

/**
 * O que o admin pode fazer com esta linha.
 *
 * As duas proibições vêm do backend (`OWNER_PROTEGIDO` e `AUTO_ALTERACAO`) e são repetidas aqui
 * **só para desabilitar o controle com explicação** — a recusa de verdade continua sendo do
 * servidor. Esconder o botão sem dizer por quê é o que faz o operador achar que a tela quebrou.
 */
function acoesDoMembro(membro, usuarioLogadoId) {
  const m = membro || {}
  if (String(m.usuario_id) === String(usuarioLogadoId)) {
    return { podeEditar: false, motivo: 'Você não pode alterar seu próprio acesso.' }
  }
  if (m.role === 'owner') {
    return { podeEditar: false, motivo: 'O dono da empresa não pode ser alterado aqui.' }
  }
  return { podeEditar: true, motivo: '' }
}

// ─── Agrupamento por ÁREA (apresentação) ─────────────────────────────────────────────────
//
// 18 caixas iguais em lista plana não se leem: o operador precisa varrer tudo para achar a que
// interessa, e não percebe que "ligar a IA" e "apagar histórico" são de naturezas diferentes.
// O agrupamento é POR ÁREA DE TRABALHO — o mesmo recorte do menu lateral —, não por severidade:
// severidade já é dita pelo aviso de cada capacidade, e um grupo "perigosas" transformaria o
// aviso num rótulo de prateleira em vez de uma frase sobre a consequência.
//
// Isto é APRESENTAÇÃO, e é por isso que vive aqui: o backend continua dono de quem pode o quê
// (`services/acesso-capacidades.js`); este módulo só decide em que ordem desenhar.

const GRUPOS = Object.freeze([
  { id: 'leads', rotulo: 'Leads e abordagem' },
  { id: 'conversas', rotulo: 'Conversas e IA' },
  { id: 'ligacoes', rotulo: 'Ligações e follow-ups' },
  { id: 'config', rotulo: 'Configuração da operação' },
  { id: 'gestao', rotulo: 'Gestão e visibilidade' },
  { id: 'outras', rotulo: 'Outras' },
])

const GRUPO_DA_CAPACIDADE = {
  aquisicao_gerenciar: 'leads',
  lead_triar: 'leads',
  lead_ver_brutos: 'leads',
  lead_ver_aprovados: 'leads',
  lead_assumir: 'leads',
  lead_abordar_manual: 'leads',
  lead_disparar_semi: 'leads',
  lead_disparar_lote: 'leads',
  lead_transferir: 'leads',

  conversa_atender: 'conversas',
  conversa_ver_todas: 'conversas',
  conversa_gerenciar_ia: 'conversas',
  conversa_apagar_historico: 'conversas',

  ligacao_operar: 'ligacoes',
  ligacao_ver_todas: 'ligacoes',
  followup_ver_fila: 'ligacoes',
  followup_operar: 'ligacoes',
  followup_reatribuir: 'ligacoes',
  followup_config_empresa: 'ligacoes',
  campanha_gerenciar: 'ligacoes',
  roteiro_ler: 'ligacoes',
  roteiro_gerenciar: 'ligacoes',

  instancia_gerenciar_propria: 'config',
  instancia_gerenciar_empresa: 'config',
  instancia_gerenciar_contexto: 'config',
  integracoes_gerenciar: 'config',

  agenda_operar_propria: 'gestao',
  agenda_ver_equipe: 'gestao',
  membros_gerenciar: 'gestao',
  relatorios_ver: 'gestao',
}

/**
 * A que área uma capacidade pertence.
 * Slug desconhecido cai em `outras` — **nunca** desaparece. Uma capacidade nova no servidor
 * precisa continuar visível na tela de permissões, ainda que sem casa definida aqui.
 */
function grupoDaCapacidade(capacidade) {
  return GRUPO_DA_CAPACIDADE[String(capacidade || '')] || 'outras'
}

/**
 * Agrupa itens de `concessoesDoFormulario` por área, na ordem de `GRUPOS`.
 * Grupo vazio é omitido (um cabeçalho sem nada embaixo é ruído), mas nenhum ITEM é descartado.
 */
function agruparConcessoes(itens) {
  const lista = Array.isArray(itens) ? itens : []
  return GRUPOS
    .map((g) => ({ ...g, itens: lista.filter((i) => grupoDaCapacidade(i && i.capacidade) === g.id) }))
    .filter((g) => g.itens.length > 0)
}

/**
 * O que o papel JÁ inclui, em rótulos legíveis e por área.
 *
 * Existe porque sem isso o formulário mostra caixas desmarcadas e nenhuma linha de base: o
 * operador não tem como saber se "Atender conversas" está faltando ou se o papel já dá. A lista
 * chega pronta do backend (`GET .../membros/opcoes` → `incluidas`), calculada pelo mesmo módulo
 * que autoriza — este aqui só traduz e ordena.
 */
function resumoDoPapel(incluidas) {
  const lista = (Array.isArray(incluidas) ? incluidas : []).map((capacidade) => ({
    capacidade,
    rotulo: rotuloCapacidade(capacidade),
  }))
  return GRUPOS
    .map((g) => ({
      ...g,
      itens: lista
        .filter((i) => grupoDaCapacidade(i.capacidade) === g.id)
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
    }))
    .filter((g) => g.itens.length > 0)
}

/**
 * As liberações extras de um membro, prontas para a célula da tabela.
 * Uma contagem ("3 liberação(ões)") obriga o admin a abrir o editor para saber o que foram —
 * e a pergunta que essa coluna existe para responder é justamente *quais*.
 */
function extrasDoMembro(membro) {
  const permissoes = (membro || {}).permissoes || {}
  return Object.keys(permissoes)
    .filter((k) => permissoes[k] === true)
    .map((capacidade) => ({ capacidade, rotulo: rotuloCapacidade(capacidade), aviso: avisoCapacidade(capacidade) }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

module.exports = {
  PAPEL_ROTULO,
  CAPACIDADE_ROTULO,
  rotuloPapel,
  descricaoPapel,
  rotuloCapacidade,
  avisoCapacidade,
  temCapacidade,
  concessoesDoFormulario,
  corpoPermissoes,
  GRUPOS,
  grupoDaCapacidade,
  agruparConcessoes,
  resumoDoPapel,
  extrasDoMembro,
  situacaoMembro,
  ultimoAcesso,
  acoesDoMembro,
}
