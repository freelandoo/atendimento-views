'use strict'
// Equipes Comerciais — APRESENTAÇÃO PURA da tela de gestão da empresa.
//
// ─── REGRA DE OURO, a mesma de `lib/capacidades.js` e `lib/site-rotulos.js` ──────────────
// Este módulo **só traduz**. Quem decide quem pode gerenciar equipe é o backend
// (`requireCapacidade(MEMBROS_GERENCIAR)`); quem garante "uma equipe ativa por pessoa" é o BANCO
// (`equipe_membros_um_ativo_por_usuario_uk`, migration 088). Aqui não se compara papel, não se
// valida unicidade e não se decide recorte.
//
// ─── O QUE ELE EXISTE PARA RESOLVER ─────────────────────────────────────────────────────
// O backend recusa o segundo vínculo com 409 "uma das pessoas selecionadas já está em outra
// equipe ativa" — sem dizer QUAL. Descobrir no POST obriga o gestor a remontar a seleção às
// cegas. `estadoDaPessoa` deixa isso visível na hora de escolher.

// ─── Estado da equipe ───────────────────────────────────────────────────────────────────

const STATUS = Object.freeze({
  ativa: {
    rotulo: 'Ativa',
    descricao: 'Os membros desta equipe trabalham a carteira deste nicho.',
    tom: 'ativo',
  },
  encerrada: {
    rotulo: 'Encerrada',
    descricao: 'Não recorta mais a operação de ninguém. O histórico foi preservado.',
    tom: 'neutro',
  },
})

function estadoDaEquipe(equipe) {
  const s = STATUS[String(equipe?.status || '').toLowerCase()]
  return s || { rotulo: 'Status desconhecido', descricao: '', tom: 'neutro' }
}

/**
 * O texto do contador de membros.
 * Zero é estado legítimo e precisa dizer a consequência: equipe sem ninguém não recorta nada.
 */
function resumoDeMembros(equipe) {
  const n = Number(equipe?.total_membros) || 0
  if (n === 0) return 'Nenhuma pessoa ainda — esta equipe não recorta a operação de ninguém.'
  return n === 1 ? '1 pessoa' : `${n} pessoas`
}

// ─── O seletor de pessoas ───────────────────────────────────────────────────────────────

/**
 * Como mostrar uma pessoa no seletor, considerando a equipe em que ela já está.
 *
 * `equipeAtualId` é a equipe sendo editada: quem já está NELA aparece como membro, não como
 * conflito. Quem está em OUTRA aparece bloqueado, com o nome da equipe — é a informação que o
 * 409 do backend não dá.
 */
function estadoDaPessoa(pessoa, equipeAtualId) {
  const atual = pessoa?.equipe_atual || null
  if (!atual) return { disponivel: true, jaNesta: false, aviso: null }
  if (equipeAtualId && String(atual.id) === String(equipeAtualId)) {
    return { disponivel: true, jaNesta: true, aviso: null }
  }
  const nicho = atual.nicho_nome ? ` · ${atual.nicho_nome}` : ''
  return {
    disponivel: false,
    jaNesta: false,
    aviso: `Já está em ${atual.nome || 'outra equipe'}${nicho}`,
  }
}

/**
 * O aviso de conflito da seleção inteira, para aparecer ANTES do envio.
 * `null` quando não há conflito — não se ocupa espaço para dizer que está tudo bem.
 */
function conflitosDaSelecao(pessoas, selecionados, equipeAtualId) {
  const escolhidos = new Set((selecionados || []).map(String))
  const presos = (pessoas || [])
    .filter((p) => escolhidos.has(String(p.usuario_id)))
    .filter((p) => !estadoDaPessoa(p, equipeAtualId).disponivel)
  if (!presos.length) return null
  const nomes = presos.map((p) => p.nome || 'sem nome').join(', ')
  return presos.length === 1
    ? `${nomes} já está em outra equipe ativa. Uma pessoa só pode estar em uma equipe por vez — tire-a da outra antes.`
    : `${nomes} já estão em outras equipes ativas. Uma pessoa só pode estar em uma equipe por vez.`
}

// ─── O formulário ───────────────────────────────────────────────────────────────────────

const LIMITE_NOME = 120
const LIMITE_DESCRICAO = 1000

/**
 * O que falta para poder salvar, em linguagem de gente.
 *
 * ⚠️ Não é a validação de verdade — quem valida é o backend
 * (`services/equipes-comerciais.js`). Aqui só evitamos um POST que já se sabe que falharia, e o
 * erro do servidor continua sendo o que manda na tela.
 */
function validarFormulario({ nome, nicho_id: nichoId } = {}) {
  const n = String(nome == null ? '' : nome).trim()
  if (n.length < 2) return { ok: false, motivo: 'Dê um nome à equipe (ao menos 2 caracteres).' }
  if (!String(nichoId || '').trim()) return { ok: false, motivo: 'Escolha o nicho que esta equipe vai trabalhar.' }
  return { ok: true, motivo: null }
}

// ─── Encerrar ───────────────────────────────────────────────────────────────────────────
//
// ⚠️ Encerrar equipe NÃO devolve lead nenhum, e a tela é obrigada a dizer isso.
// A devolução de leads ao remover alguém é uma etapa que AINDA NÃO EXISTE (decisão D4 de
// 2026-09-18: será ação explícita do dono, com aviso de quantos leads voltam). Deixar a tela
// sugerir que encerrar resolve a carteira criaria a expectativa errada — o gestor encerraria a
// equipe achando que os leads voltaram para a fila, e eles continuam com as pessoas.

const AVISO_ENCERRAR = 'Encerrar a equipe para de recortar a operação dos membros e preserva o histórico. Os leads que cada pessoa já assumiu CONTINUAM com ela — devolver leads para a fila é uma ação separada, ainda não disponível nesta tela.'

function textoConfirmarEncerramento(equipe) {
  const nome = equipe?.nome || 'esta equipe'
  const n = Number(equipe?.total_membros) || 0
  const quem = n === 0 ? 'Ela não tem membros.' : n === 1 ? '1 pessoa deixa de ter a operação recortada.' : `${n} pessoas deixam de ter a operação recortada.`
  return `Encerrar ${nome}? ${quem} ${AVISO_ENCERRAR}`
}

// ─── Agrupamento da lista ───────────────────────────────────────────────────────────────

/** Ativas primeiro; encerradas depois, recolhidas. Uma equipe encerrada é histórico, não trabalho. */
function agruparEquipes(equipes) {
  const lista = Array.isArray(equipes) ? equipes : []
  return {
    ativas: lista.filter((e) => e.status === 'ativa'),
    encerradas: lista.filter((e) => e.status !== 'ativa'),
  }
}

/** Nichos que já têm equipe ATIVA — o banco recusa a segunda (`equipes_comerciais_um_nicho_ativo_uk`). */
function nichosOcupados(equipes, equipeAtualId) {
  return new Set(
    (equipes || [])
      .filter((e) => e.status === 'ativa' && String(e.id) !== String(equipeAtualId || ''))
      .map((e) => String(e.nicho_id))
  )
}

module.exports = {
  STATUS,
  LIMITE_NOME,
  LIMITE_DESCRICAO,
  AVISO_ENCERRAR,
  estadoDaEquipe,
  resumoDeMembros,
  estadoDaPessoa,
  conflitosDaSelecao,
  validarFormulario,
  textoConfirmarEncerramento,
  agruparEquipes,
  nichosOcupados,
}
