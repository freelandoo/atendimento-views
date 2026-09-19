'use strict'
// Área de EQUIPE — APRESENTAÇÃO PURA da tela unificada (Visão geral · Equipes · Pessoas).
//
// ─── POR QUE ESTE MÓDULO EXISTE ─────────────────────────────────────────────────────────
// Até 2026-09-19 havia DUAS telas para o mesmo trabalho: `/dashboard/equipe` (quem está com o
// quê) e `/dashboard/equipes-comerciais` (quem trabalha qual nicho). São o mesmo fluxo — montar
// a equipe e depois olhar o resultado —, e o gestor tinha de trocar de página no meio dele.
// A unificação é de APRESENTAÇÃO: **nenhuma rota, nenhuma regra e nenhuma permissão mudaram**.
// As duas telas já exigiam a MESMA capacidade (`MEMBROS_GERENCIAR`).
//
// ─── REGRA DE OURO, a mesma de `lib/capacidades.js` e `lib/site-rotulos.js` ──────────────
// Este módulo **só junta e traduz** o que duas rotas já responderam. Ele não decide permissão,
// não valida unicidade e não recorta nada. Quem autoriza é o backend; quem garante "uma equipe
// ativa por pessoa" e "uma equipe ativa por nicho" é o BANCO (migration 088).
//
// ─── TRÊS COISAS QUE ESTA ÁREA NÃO PODE VIRAR ───────────────────────────────────────────
// 1. **Placar de produtividade.** As contagens medem coisas diferentes (carteira, fila,
//    compromisso, histórico) e NÃO se somam num total. `metricasDaEquipe` soma a MESMA métrica
//    entre pessoas (total de leads da equipe) e jamais métricas diferentes entre si.
// 2. **Fonte de dado inventado.** "Reuniões por pessoa" não existe em rota alguma, então não
//    aparece. Só entra número que uma API deste produto respondeu.
// 3. **Segunda régua de permissão.** Esconder um controle aqui deixa a tela honesta; nunca
//    substitui o gate do servidor.
//
// Sem React, sem rede, sem DOM: testável com `node --test` (mesmo padrão de `paginacao.js`).

const {
  COLUNAS,
  ATIVIDADE_HOJE_COLUNAS,
  rotuloPapel,
  rotuloUltimoAcesso,
  avisoDeInativo,
  atividadeHoje,
  ordenarEquipe,
  ordenarPorAtividadeHoje,
  descreverAtividade,
  cargaAtual,
  temTrabalhoSemDono,
} = require('./equipe-painel')

const {
  STATUS,
  LIMITE_NOME,
  AVISO_ENCERRAR,
  estadoDaEquipe,
  resumoDeMembros,
  estadoDaPessoa,
  conflitosDaSelecao,
  validarFormulario,
  textoConfirmarEncerramento,
  agruparEquipes,
  nichosOcupados,
} = require('./equipes-comerciais')

const { formatarDinheiro } = require('./comissao')
const { detalheMaisAntigo, resumoDaEquipe } = require('./lead-parado')

// ─── Abas ───────────────────────────────────────────────────────────────────────────────
//
// Abas de TELA, não de permissão: as três mostram o mesmo universo por recortes diferentes.
// Trocar de aba não dispara escrita nem muda escopo no servidor.

const ABAS = Object.freeze([
  { id: 'visao', titulo: 'Visão geral', descricao: 'O estado da operação num relance.' },
  { id: 'equipes', titulo: 'Equipes', descricao: 'Cada equipe, seus membros e seu desempenho.' },
  { id: 'pessoas', titulo: 'Pessoas', descricao: 'Todo mundo da empresa, independente de equipe.' },
])

const ABA_PADRAO = 'visao'
const IDS_ABAS = Object.freeze(ABAS.map((a) => a.id))

/** Aba desconhecida (URL adulterada, storage antigo) cai no padrão em vez de deixar a tela vazia. */
function abaValida(id) {
  return IDS_ABAS.includes(String(id || '')) ? String(id) : ABA_PADRAO
}

// ─── Junção das duas fontes ─────────────────────────────────────────────────────────────

function chave(valor) {
  return String(valor == null ? '' : valor)
}

/**
 * Uma linha por PESSOA, juntando o que cada rota sabe.
 *
 * `/equipe` sabe a carga de trabalho, o e-mail e se o acesso está ativo;
 * `/equipes-comerciais/elegiveis` sabe em que equipe a pessoa está;
 * `/comissao/ranking` sabe o faturamento originado no mês.
 *
 * A junção é pela ESQUERDA, a partir de `/equipe`: `elegiveis` só lista vínculo ATIVO, e alguém
 * desativado com carteira na mão precisa continuar visível — desativar revoga acesso e **não**
 * redistribui trabalho.
 */
function montarPessoas({ linhas, elegiveis, ranking } = {}) {
  const porElegivel = new Map((Array.isArray(elegiveis) ? elegiveis : []).map((e) => [chave(e.usuario_id), e]))
  const porRanking = new Map((Array.isArray(ranking) ? ranking : []).map((r) => [chave(r.usuario_id), r]))

  return (Array.isArray(linhas) ? linhas : []).map((l) => {
    const id = chave(l.usuario_id)
    const el = porElegivel.get(id) || null
    return {
      ...l,
      equipe: el && el.equipe_atual ? el.equipe_atual : null,
      // `null` ≠ `0`: ninguém originou zero — é que não há faturamento registrado para a pessoa
      // nesta competência. `formatarDinheiro(null)` devolve "—", nunca "R$ 0,00".
      originado: porRanking.has(id) ? Number(porRanking.get(id).originado) || 0 : null,
    }
  })
}

// ─── Métricas de uma equipe ─────────────────────────────────────────────────────────────
//
// ⚠️ Cada card diz o que mede, pelo mesmo motivo do `oQueMede` obrigatório da
// `BolinhaPontuacao`: cinco números lado a lado sugerem que são comparáveis entre si.

const METRICAS_EQUIPE = Object.freeze([
  { chave: 'leads', rotulo: 'Leads', oQueMede: 'Leads sob responsabilidade das pessoas desta equipe agora.' },
  { chave: 'conversas', rotulo: 'Conversas', oQueMede: 'Conversas atribuídas às pessoas desta equipe na Central de Mensagens.' },
  { chave: 'follow_ups_aguardando', rotulo: 'Follow-ups', oQueMede: 'Follow-ups em aberto atribuídos às pessoas desta equipe.' },
  { chave: 'ligacoes', rotulo: 'Ligações', oQueMede: 'Ligações já registradas pelas pessoas desta equipe. É histórico, não carga atual.' },
  { chave: 'originado', rotulo: 'Faturamento', oQueMede: 'Faturamento pago originado no mês pelas pessoas desta equipe.', dinheiro: true },
])

/**
 * Soma, por métrica, os números das pessoas da equipe.
 *
 * ⚠️ Soma a MESMA métrica entre pessoas — nunca métricas diferentes entre si. Um total de
 * "leads + conversas + follow-ups" daria um número que não se sustenta, exatamente o que a
 * guarda de `equipe-painel.js` existe para impedir.
 *
 * `originado` é `null` quando NINGUÉM da equipe tem faturamento registrado: zero afirmaria que
 * a equipe vendeu nada, quando o correto é "não há venda registrada".
 */
function metricasDaEquipe(membros) {
  const lista = Array.isArray(membros) ? membros : []
  const soma = (campo) => lista.reduce((t, m) => t + (Number(m[campo]) || 0), 0)
  const comFaturamento = lista.some((m) => m.originado != null)
  return {
    leads: soma('leads'),
    leads_parados: soma('leads_parados'),
    conversas: soma('conversas'),
    follow_ups_aguardando: soma('follow_ups_aguardando'),
    follow_ups_vencidos: soma('follow_ups_vencidos'),
    ligacoes: soma('ligacoes'),
    originado: comFaturamento ? soma('originado') : null,
  }
}

/**
 * As equipes, já com os membros e as métricas.
 *
 * ⚠️ `membros_ocultos` não é detalhe: `total_membros` vem do banco e conta todo vínculo com
 * `saiu_em IS NULL`, enquanto `elegiveis` só devolve quem tem vínculo ATIVO na empresa. Quem foi
 * desativado continua na equipe e some da lista — sem este número a tela diria "4 membros" e
 * mostraria 3, e ninguém saberia por quê.
 */
function montarEquipes({ equipes, pessoas } = {}) {
  const lista = Array.isArray(pessoas) ? pessoas : []
  return (Array.isArray(equipes) ? equipes : []).map((eq) => {
    const membros = lista.filter((p) => p.equipe && chave(p.equipe.id) === chave(eq.id))
    const total = Number(eq.total_membros) || 0
    return {
      ...eq,
      membros,
      total_membros: total,
      membros_ocultos: Math.max(0, total - membros.length),
      metricas: metricasDaEquipe(membros),
    }
  })
}

/** Texto do contador quando parte da equipe está invisível por acesso revogado. */
function avisoMembrosOcultos(equipe) {
  const n = Number(equipe && equipe.membros_ocultos) || 0
  if (n <= 0) return ''
  return n === 1
    ? '1 pessoa desta equipe está com o acesso revogado e não aparece na tabela — o trabalho dela continua na mão dela.'
    : `${n} pessoas desta equipe estão com o acesso revogado e não aparecem na tabela — o trabalho delas continua na mão delas.`
}

// ─── A tabela de membros ────────────────────────────────────────────────────────────────
//
// ⚠️ São DOIS horizontes na mesma tabela, e o rótulo é obrigado a dizer qual: as primeiras
// colunas são o que está NA MÃO da pessoa AGORA; as marcadas com "(hoje)" contam fatos
// registrados desde o início do dia. Misturar os dois sem dizer faria a tabela mentir.

const COLUNAS_MEMBRO = Object.freeze([
  { chave: 'leads', rotulo: 'Leads', oQueMede: 'Leads da carteira sob responsabilidade desta pessoa agora.' },
  { chave: 'leads_parados', rotulo: 'Parados', oQueMede: 'Leads desta pessoa sem nenhuma ação registrada na janela. Já estão contados em "Leads".', tom: 'alerta' },
  { chave: 'conversas', rotulo: 'Conversas', oQueMede: 'Conversas atribuídas a esta pessoa na Central de Mensagens.' },
  { chave: 'follow_ups_aguardando', rotulo: 'Follow-ups', oQueMede: 'Follow-ups em aberto atribuídos a esta pessoa.' },
  { chave: 'follow_ups_vencidos', rotulo: 'Vencidos', oQueMede: 'Follow-ups desta pessoa cujo prazo já passou.', tom: 'perigo' },
  { chave: 'ligacoes', rotulo: 'Ligações', oQueMede: 'Ligações já registradas por esta pessoa. É histórico, não carga atual.' },
  { chave: 'contatos_registrados', rotulo: 'Contatos (hoje)', hoje: true, oQueMede: 'Leads marcados como contatados, ou contato manual declarado, hoje.' },
  { chave: 'fechados', rotulo: 'Fechados (hoje)', hoje: true, oQueMede: 'Leads marcados como fechados hoje.' },
])

/** O valor de uma coluna, buscando no lugar certo (carga atual × atividade do dia). */
function valorDaColuna(pessoa, coluna) {
  if (!coluna) return 0
  const fonte = coluna.hoje ? atividadeHoje(pessoa) : (pessoa || {})
  return Number(fonte[coluna.chave]) || 0
}

/**
 * O tom da célula. Cor NUNCA é o único sinal — quem chama também mostra o `oQueMede` no
 * cabeçalho, e o número zero nunca é pintado (não há nada a alertar).
 */
function tomDaColuna(coluna, valor) {
  if (!coluna || !coluna.tom || !valor) return 'neutro'
  return coluna.tom
}

// ─── Resumo do topo ─────────────────────────────────────────────────────────────────────
//
// Quatro cartões compactos. Eles NÃO se somam e não formam um índice: cada um responde uma
// pergunta diferente sobre a operação.

function resumoGeral({ pessoas, equipes, semDono, prazoParado } = {}) {
  const gente = Array.isArray(pessoas) ? pessoas : []
  const times = Array.isArray(equipes) ? equipes : []
  const ativas = times.filter((e) => e.status === 'ativa')
  const ativos = gente.filter((p) => p.ativo !== false)
  const parados = gente.reduce((t, p) => t + (Number(p.leads_parados) || 0), 0)
  const followUps = gente.reduce((t, p) => t + (Number(p.follow_ups_aguardando) || 0), 0)
  const vencidos = gente.reduce((t, p) => t + (Number(p.follow_ups_vencidos) || 0), 0)
  const dias = Number(prazoParado) || 0

  return [
    {
      chave: 'pessoas',
      rotulo: ativos.length === 1 ? 'pessoa ativa' : 'pessoas ativas',
      valor: ativos.length,
      apoio: gente.length > ativos.length
        ? `${gente.length - ativos.length} com acesso revogado`
        : 'Com acesso a esta empresa',
      oQueMede: 'Pessoas com vínculo ativo nesta empresa.',
    },
    {
      chave: 'equipes',
      rotulo: ativas.length === 1 ? 'equipe ativa' : 'equipes ativas',
      valor: ativas.length,
      apoio: times.length > ativas.length
        ? `${times.length - ativas.length} encerrada${times.length - ativas.length === 1 ? '' : 's'} no histórico`
        : 'Cada uma trabalha um nicho',
      oQueMede: 'Equipes que recortam a carteira dos membros agora.',
    },
    {
      chave: 'parados',
      rotulo: parados === 1 ? 'lead parado' : 'leads parados',
      valor: parados,
      apoio: dias > 0 ? `Sem ação registrada há ${dias} dia${dias === 1 ? '' : 's'} ou mais` : 'Sem ação registrada na janela',
      tom: parados > 0 ? 'alerta' : 'neutro',
      oQueMede: 'Leads que estão na mão de alguém e não recebem ação. Já contados na carteira de cada pessoa.',
    },
    {
      chave: 'follow_ups',
      rotulo: followUps === 1 ? 'follow-up em aberto' : 'follow-ups em aberto',
      valor: followUps,
      apoio: vencidos > 0
        ? `${vencidos} com prazo vencido`
        : (temTrabalhoSemDono(semDono) ? 'Há trabalho sem responsável na fila' : 'Nenhum com prazo vencido'),
      tom: vencidos > 0 ? 'perigo' : 'neutro',
      oQueMede: 'Follow-ups atribuídos a alguém e ainda não concluídos.',
    },
  ]
}

// ─── Alertas ────────────────────────────────────────────────────────────────────────────
//
// Alerta é o que pede AÇÃO de quem está olhando. Sem nada a fazer, não se ocupa espaço para
// dizer que está tudo bem — a lista vazia tem frase própria na tela.

function alertasDaEquipe(equipe, prazoParado) {
  const e = equipe || {}
  const m = e.metricas || {}
  const saida = []

  const parados = Number(m.leads_parados) || 0
  if (parados > 0) {
    const resumo = resumoDaEquipe(e.membros || [], prazoParado)
    saida.push({
      chave: 'leads_parados',
      tom: 'alerta',
      titulo: parados === 1 ? '1 lead parado' : `${parados} leads parados`,
      descricao: resumo ? resumo.acao : 'Reative o lead ou atribua a outra pessoa da equipe.',
    })
  }

  const vencidos = Number(m.follow_ups_vencidos) || 0
  if (vencidos > 0) {
    saida.push({
      chave: 'follow_ups_vencidos',
      tom: 'perigo',
      titulo: vencidos === 1 ? '1 follow-up vencido' : `${vencidos} follow-ups vencidos`,
      descricao: 'O prazo combinado já passou. Abra a Central de Follow-ups para tratar.',
    })
  }

  const inativos = (e.membros || []).filter((p) => p.ativo === false && cargaAtual(p) > 0)
  if (inativos.length) {
    saida.push({
      chave: 'inativos_com_carga',
      tom: 'alerta',
      titulo: inativos.length === 1
        ? '1 pessoa sem acesso e com trabalho na mão'
        : `${inativos.length} pessoas sem acesso e com trabalho na mão`,
      descricao: 'Desativar revoga o acesso e NÃO redistribui. Reatribua manualmente o que ficou parado.',
    })
  }

  if (e.status === 'ativa' && (Number(e.total_membros) || 0) === 0) {
    saida.push({
      chave: 'equipe_vazia',
      tom: 'neutro',
      titulo: 'Equipe sem ninguém',
      descricao: 'Enquanto não houver membros, esta equipe não recorta a carteira de pessoa alguma.',
    })
  }

  return saida
}

/** Alertas da EMPRESA (não de uma equipe): trabalho sem dono é fila, e fila sem quem puxe vira problema. */
function alertasGerais({ semDono } = {}) {
  const s = semDono || {}
  const saida = []
  const leads = Number(s.leads) || 0
  const conversas = Number(s.conversas) || 0
  const followUps = Number(s.follow_ups_aguardando) || 0

  if (conversas > 0) {
    saida.push({
      chave: 'conversas_sem_responsavel',
      tom: 'alerta',
      titulo: conversas === 1 ? '1 conversa sem responsável' : `${conversas} conversas sem responsável`,
      descricao: 'Não é erro: a fila de não atribuídas é legítima e qualquer pessoa pode puxá-la. Vira problema quando ninguém puxa.',
    })
  }
  if (leads > 0) {
    saida.push({
      chave: 'leads_livres',
      tom: 'neutro',
      titulo: leads === 1 ? '1 lead livre na fila' : `${leads} leads livres na fila`,
      descricao: 'Lead sem responsável está disponível para quem quiser assumir — não está parado.',
    })
  }
  if (followUps > 0) {
    saida.push({
      chave: 'follow_ups_sem_dono',
      tom: 'alerta',
      titulo: followUps === 1 ? '1 follow-up sem responsável' : `${followUps} follow-ups sem responsável`,
      descricao: 'Estão em aberto e ninguém foi atribuído. A Central de Follow-ups mostra a fila completa.',
    })
  }
  return saida
}

// ─── Filtros ────────────────────────────────────────────────────────────────────────────

function normalizarTermo(valor) {
  return String(valor == null ? '' : valor).trim().toLowerCase()
}

/** Busca por nome da equipe OU nicho — é por um dos dois que o gestor procura. */
function filtrarEquipes(equipes, termo) {
  const t = normalizarTermo(termo)
  const lista = Array.isArray(equipes) ? equipes : []
  if (!t) return lista
  return lista.filter((e) =>
    normalizarTermo(e.nome).includes(t) || normalizarTermo(e.nicho_nome).includes(t))
}

const FILTRO_EQUIPE_TODAS = ''
const FILTRO_SEM_EQUIPE = 'sem_equipe'

const OPCOES_STATUS_PESSOA = Object.freeze([
  { id: 'ativos', rotulo: 'Com acesso ativo' },
  { id: 'todos', rotulo: 'Todos, inclusive revogados' },
  { id: 'inativos', rotulo: 'Só acesso revogado' },
])

/**
 * O recorte da aba Pessoas.
 *
 * ⚠️ É filtro de TELA, não recorte de permissão: quem vê esta área já vê todo mundo da empresa
 * (o backend resolveu isso). Por isso o padrão é "com acesso ativo" e não "meus" — esconder
 * gente aqui não protege nada, só atrapalha quem veio redistribuir trabalho.
 */
function filtrarPessoas(pessoas, { busca, equipeId, papel, status } = {}) {
  const t = normalizarTermo(busca)
  const eq = String(equipeId == null ? '' : equipeId)
  const pap = String(papel == null ? '' : papel)
  const st = String(status || 'ativos')

  return (Array.isArray(pessoas) ? pessoas : []).filter((p) => {
    if (t && !normalizarTermo(p.nome).includes(t) && !normalizarTermo(p.email).includes(t)) return false
    if (eq === FILTRO_SEM_EQUIPE) {
      if (p.equipe) return false
    } else if (eq && (!p.equipe || chave(p.equipe.id) !== eq)) return false
    if (pap && chave(p.papel) !== pap) return false
    if (st === 'ativos' && p.ativo === false) return false
    if (st === 'inativos' && p.ativo !== false) return false
    return true
  })
}

/** Os papéis realmente presentes na empresa — nunca a matriz inteira, que ofereceria filtro vazio. */
function papeisPresentes(pessoas) {
  const vistos = new Map()
  for (const p of Array.isArray(pessoas) ? pessoas : []) {
    const id = chave(p.papel)
    if (id && !vistos.has(id)) vistos.set(id, { id, rotulo: rotuloPapel(id) })
  }
  return [...vistos.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

/** O texto do rodapé da listagem. Vazio por FILTRO e vazio por AUSÊNCIA pedem saídas diferentes. */
function resumoDoRecorte(total, filtradas) {
  if (!total) return 'Nenhuma pessoa nesta empresa ainda.'
  if (filtradas === total) return total === 1 ? '1 pessoa' : `${total} pessoas`
  return `${filtradas} de ${total} pessoas`
}

// ─── Encerrar equipe ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ O backend RECUSA encerrar equipe que ainda tem gente
 * (`encerrarEquipe` → 409 `EQUIPE_COM_MEMBROS`), porque a devolução de leads dos participantes
 * não existe. A tela precisa dizer isso ANTES do clique: oferecer o botão e receber o 409 faz o
 * gestor achar que é defeito do sistema, quando é uma etapa do produto que ainda não nasceu.
 */
function podeEncerrar(equipe) {
  const e = equipe || {}
  if (e.status !== 'ativa') {
    return { pode: false, motivo: 'Esta equipe já está encerrada.' }
  }
  const n = Number(e.total_membros) || 0
  if (n > 0) {
    return {
      pode: false,
      motivo: `Tire ${n === 1 ? 'a pessoa' : `as ${n} pessoas`} da equipe antes de encerrar. Hoje isso depende da etapa de devolução de leads, que ainda não existe.`,
    }
  }
  return { pode: true, motivo: '' }
}

// ─── O modal de membros ─────────────────────────────────────────────────────────────────
//
// ⚠️ A REGRA MAIS IMPORTANTE DESTE MÓDULO: **este produto ainda não sabe REMOVER alguém de uma
// equipe.** `db/equipes-comerciais.js` lança 409 `REMOCAO_EXIGE_DEVOLUCAO` porque os leads que a
// pessoa assumiu ficariam presos com quem saiu do recorte. A referência visual desta tela mostra
// caixas que se desmarcam para remover — desenhar isso aqui prometeria uma ação que o servidor
// recusa, e o gestor descobriria no erro. Quem já é membro aparece MARCADO E BLOQUEADO, com o
// motivo em texto (a regra do guia visual para controle que a pessoa não pode usar).

const MOTIVO_REMOCAO_BLOQUEADA =
  'Tirar alguém da equipe depende da etapa de devolução de leads, que ainda não existe. Enquanto isso, só dá para adicionar pessoas.'

const FILTROS_MODAL = Object.freeze([
  { id: 'todos', rotulo: 'Todos' },
  { id: 'sem_equipe', rotulo: 'Sem equipe' },
  { id: 'nesta_equipe', rotulo: 'Já nesta equipe' },
])

/**
 * Como uma pessoa aparece no modal, para uma equipe.
 *
 * Três situações e elas não se confundem: **nesta equipe** (marcada e travada), **sem equipe**
 * (disponível) e **em outra equipe** (bloqueada, COM o nome da equipe — a informação que o 409
 * do backend não dá, porque ele fala de "uma das pessoas" sem dizer qual).
 */
function situacaoNoModal(pessoa, equipeId) {
  const st = estadoDaPessoa(pessoa, equipeId)
  if (st.jaNesta) {
    return {
      situacao: 'nesta_equipe',
      rotulo: 'Nesta equipe',
      tom: 'ok',
      selecionavel: false,
      marcado: true,
      motivo: MOTIVO_REMOCAO_BLOQUEADA,
    }
  }
  if (!st.disponivel) {
    return {
      situacao: 'outra_equipe',
      rotulo: 'Em outra equipe',
      tom: 'alerta',
      selecionavel: false,
      marcado: false,
      motivo: `${st.aviso}. Uma pessoa só pode estar em uma equipe ativa por vez.`,
    }
  }
  return { situacao: 'sem_equipe', rotulo: 'Sem equipe', tom: 'neutro', selecionavel: true, marcado: false, motivo: '' }
}

/** Contagem de cada filtro do modal — o número entra no próprio botão, como na referência. */
function contagensDoModal(pessoas, equipeId) {
  const lista = Array.isArray(pessoas) ? pessoas : []
  const conta = { todos: lista.length, sem_equipe: 0, nesta_equipe: 0 }
  for (const p of lista) {
    const s = situacaoNoModal(p, equipeId).situacao
    if (s === 'sem_equipe') conta.sem_equipe += 1
    else if (s === 'nesta_equipe') conta.nesta_equipe += 1
  }
  return conta
}

/** Busca por nome OU e-mail, como o campo promete. `elegiveis` não traz e-mail; a junção traz. */
function filtrarPessoasDoModal(pessoas, { busca, filtro, equipeId } = {}) {
  const t = normalizarTermo(busca)
  const f = String(filtro || 'todos')
  return (Array.isArray(pessoas) ? pessoas : []).filter((p) => {
    if (t && !normalizarTermo(p.nome).includes(t) && !normalizarTermo(p.email).includes(t)) return false
    if (f === 'todos') return true
    return situacaoNoModal(p, equipeId).situacao === f
  })
}

/**
 * O rodapé do modal: quantas pessoas ENTRAM de fato.
 *
 * Conta só as adições, porque só elas serão enviadas. Dizer "4 selecionadas" quando 4 já eram
 * membros faria o botão prometer uma mudança que não vai acontecer.
 */
function resumoSelecaoModal(novos) {
  const n = (Array.isArray(novos) ? novos : []).length
  if (n === 0) {
    return {
      quantidade: 0,
      texto: 'Nenhuma pessoa nova selecionada',
      podeSalvar: false,
      motivo: 'Escolha ao menos uma pessoa para adicionar.',
    }
  }
  return {
    quantidade: n,
    texto: n === 1 ? '1 pessoa será adicionada' : `${n} pessoas serão adicionadas`,
    podeSalvar: true,
    motivo: '',
  }
}

/**
 * O corpo do PUT: quem JÁ está mais quem foi escolhido.
 *
 * ⚠️ `PUT /participantes` é SUBSTITUIÇÃO — mandar só os novos removeria todo mundo, e o backend
 * recusaria a operação inteira com 409. Os membros atuais entram sempre.
 */
function corpoDeParticipantes(pessoas, equipeId, novos) {
  const atuais = (Array.isArray(pessoas) ? pessoas : [])
    .filter((p) => situacaoNoModal(p, equipeId).situacao === 'nesta_equipe')
    .map((p) => chave(p.usuario_id))
  const escolhidos = (Array.isArray(novos) ? novos : []).map(chave)
  return [...new Set([...atuais, ...escolhidos])].filter(Boolean)
}

module.exports = {
  // Abas
  ABAS,
  ABA_PADRAO,
  IDS_ABAS,
  abaValida,
  // Junção e métricas
  montarPessoas,
  montarEquipes,
  metricasDaEquipe,
  METRICAS_EQUIPE,
  COLUNAS_MEMBRO,
  valorDaColuna,
  tomDaColuna,
  avisoMembrosOcultos,
  // Resumo e alertas
  resumoGeral,
  alertasDaEquipe,
  alertasGerais,
  // Filtros
  filtrarEquipes,
  filtrarPessoas,
  papeisPresentes,
  resumoDoRecorte,
  OPCOES_STATUS_PESSOA,
  FILTRO_EQUIPE_TODAS,
  FILTRO_SEM_EQUIPE,
  // Encerrar
  podeEncerrar,
  // Modal de membros
  MOTIVO_REMOCAO_BLOQUEADA,
  FILTROS_MODAL,
  situacaoNoModal,
  contagensDoModal,
  filtrarPessoasDoModal,
  resumoSelecaoModal,
  corpoDeParticipantes,
  // ─── REEXPORTS ────────────────────────────────────────────────────────────────────────
  // Reexportados, NUNCA copiados (padrão de `paginacao.js` e `lead-identidade.js`): duas
  // implementações da mesma regra fariam a mesma equipe aparecer de um jeito na lista e de
  // outro no detalhe aberto a partir dela.
  COLUNAS,
  ATIVIDADE_HOJE_COLUNAS,
  STATUS,
  LIMITE_NOME,
  AVISO_ENCERRAR,
  rotuloPapel,
  rotuloUltimoAcesso,
  avisoDeInativo,
  atividadeHoje,
  ordenarEquipe,
  ordenarPorAtividadeHoje,
  descreverAtividade,
  cargaAtual,
  temTrabalhoSemDono,
  estadoDaEquipe,
  resumoDeMembros,
  estadoDaPessoa,
  conflitosDaSelecao,
  validarFormulario,
  textoConfirmarEncerramento,
  agruparEquipes,
  nichosOcupados,
  formatarDinheiro,
  detalheMaisAntigo,
  resumoDaEquipe,
}
