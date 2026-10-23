// @ts-check
'use strict'

/**
 * Tradução do ESTADO REAL do modo Automático (`GET .../banco-leads/auto/estado`).
 *
 * Módulo PURO: só TRADUZ o veredito que a API já resolveu — mesmo contrato de
 * `lib/site-rotulos.js` e `lib/capacidades.js`. Ele **não** decide se o automático está rodando,
 * não conta leads e não julga instância: quem sabe isso é o worker, e uma segunda régua aqui
 * faria o painel contradizer o que o sistema de fato faz (a tela antiga derivava o status das
 * instâncias carregadas e podia discordar do ciclo real).
 *
 * Cor nunca é o único sinal: todo estado carrega título E explicação em texto.
 */

/** Estados possíveis, espelhando os motivos que `_autoEmpresa` devolve no worker. */
const ESTADOS = /** @type {const} */ ({
  modo_manual: {
    titulo: 'Automático desligado',
    detalhe: 'Esta empresa está em outro modo de disparo. Nenhum envio automático acontece.',
    tom: 'neutro',
  },
  pausado: {
    titulo: 'Parado',
    detalhe: 'O Automático está configurado, mas a rotina não foi ligada.',
    tom: 'neutro',
  },
  aguardando_intervalo: {
    titulo: 'Aguardando o intervalo',
    detalhe: 'O ciclo anterior já saiu. O próximo lead sai quando o intervalo fechar.',
    tom: 'info',
  },
  pronto: {
    titulo: 'Rodando',
    detalhe: 'Há instância pronta e lead no recorte. O próximo ciclo dispara na hora marcada.',
    tom: 'ok',
  },
  sem_instancia_pronta: {
    titulo: 'Sem instância pronta',
    detalhe: 'Nenhum número está apto a enviar agora. Veja o motivo de cada um na lista abaixo.',
    tom: 'alerta',
  },
  aguardando_cooldown_pool: {
    titulo: 'Todos os números em descanso',
    detalhe: 'As instâncias do rodízio enviaram há pouco. O ciclo volta quando o descanso terminar.',
    tom: 'info',
  },
  teto_diario_pool: {
    titulo: 'Teto do dia atingido',
    detalhe: 'O limite diário de primeiras abordagens da empresa foi alcançado. Recomeça amanhã.',
    tom: 'alerta',
  },
  teto_diario_instancias: {
    titulo: 'Teto por número atingido',
    detalhe: 'Cada número do rodízio já bateu a parte dele do teto diário.',
    tom: 'alerta',
  },
  sem_lead_elegivel: {
    titulo: 'Sem lead no recorte',
    detalhe: 'O recorte atual não alcança nenhum lead abordável. Amplie o recorte ou traga leads novos.',
    tom: 'alerta',
  },
})

/** Por que um número está fora do rodízio. Lista fechada — sem texto livre do servidor. */
const MOTIVOS_FORA = /** @type {const} */ ({
  desativada: 'Número desativado',
  sem_saudacao: 'Falta configurar a saudação',
  aguardando_cooldown: 'Descansando desde o último envio',
  teto_da_instancia: 'Já bateu a parte dele do teto do dia',
  fora_do_pool: 'Fora do rodízio agora',
})

/**
 * Estado desconhecido aparece COMO ELE MESMO, nunca escondido e nunca traduzido para outro:
 * um motivo novo no worker não pode desaparecer do painel (mesma disciplina de
 * `lib/capacidades.js` com capacidade desconhecida).
 */
function leituraEstado(estado) {
  const chave = String(estado || '')
  const conhecido = /** @type {any} */ (ESTADOS)[chave]
  if (conhecido) return { chave, ...conhecido }
  return {
    chave,
    titulo: chave || 'Estado não informado',
    detalhe: 'O sistema devolveu um estado que esta tela ainda não sabe explicar.',
    tom: 'neutro',
  }
}

function motivoFora(motivo) {
  const chave = String(motivo || '')
  if (!chave) return null
  return /** @type {any} */ (MOTIVOS_FORA)[chave] || chave
}

/** Classes por tom. Cor é REFORÇO — o título em texto vem sempre junto. */
function classesTom(tom) {
  if (tom === 'ok') return 'border-estado-ok/30 bg-estado-ok/5 text-estado-ok'
  if (tom === 'alerta') return 'border-estado-warn/30 bg-estado-warn/5 text-estado-warn'
  if (tom === 'info') return 'border-estado-info/30 bg-estado-info/5 text-estado-info'
  return 'border-line bg-surface-2 text-ink-2'
}

/** "em 12 min" / "em 45 s" / null quando não há espera declarada. */
function textoEspera(segundos) {
  const s = Number(segundos)
  if (!Number.isFinite(s) || s <= 0) return null
  if (s < 90) return `em ${Math.ceil(s)} s`
  return `em ${Math.ceil(s / 60)} min`
}

/**
 * O recorte em uma frase. Nicho vazio NÃO é falha de configuração: é a carteira inteira, e a
 * tela diz isso em vez de deixar o campo em branco.
 */
function textoRecorte(recorte) {
  const modo = recorte && recorte.modo
  const nicho = recorte && recorte.nicho
  if (modo === 'nicho' && nicho) return `Somente o nicho “${nicho}”`
  return 'Todos os nichos da carteira'
}

/**
 * A frase da contagem. "Candidatos", nunca "elegíveis": janela local do país, compliance e
 * continuidade da instância só se decidem lead a lead, na hora do ciclo — e quem lê o número
 * precisa saber que ele é o universo ANTES desses três filtros.
 */
function textoCandidatos(total) {
  const n = Number(total) || 0
  if (n === 0) return 'Nenhum lead candidato neste recorte'
  return `${n} lead${n === 1 ? '' : 's'} candidato${n === 1 ? '' : 's'} neste recorte`
}

const RESSALVA_CANDIDATOS =
  'Candidatos = leads abordáveis no recorte. A janela do país, o opt-out e a continuidade da '
  + 'instância são checados lead a lead, no momento do ciclo.'

module.exports = {
  ESTADOS,
  MOTIVOS_FORA,
  RESSALVA_CANDIDATOS,
  leituraEstado,
  motivoFora,
  classesTom,
  textoEspera,
  textoRecorte,
  textoCandidatos,
}
