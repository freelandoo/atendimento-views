'use strict'
// Cadencia comercial na ficha do lead — APRESENTACAO PURA.
//
// A regra de negocio vem do backend (`services/follow-up-recomendacao.js`). Este modulo so
// escreve o plano recebido: estagio, limites e proxima sugestao. A tela nao recalcula teto,
// sinal, nem ritmo.

const { quandoEmTexto } = require('./lead-proxima-acao')

const SINAL = Object.freeze({
  frio: { rotulo: 'Frio', classe: 'border-line bg-surface-2 text-ink-2' },
  morno: { rotulo: 'Morno', classe: 'border-amber-200 bg-amber-50 text-amber-800' },
  quente: { rotulo: 'Quente', classe: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  parado: { rotulo: 'Parado', classe: 'border-line bg-surface-2 text-ink-3' },
})

function numero(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function limite(l, singular, plural) {
  const usados = numero(l && l.usados)
  const teto = numero(l && l.teto)
  const restante = Math.max(0, numero(l && l.restante))
  const nome = teto === 1 ? singular : plural
  return {
    texto: teto > 0 ? `${usados}/${teto} ${nome}` : `Sem ${plural}`,
    detalhe: teto > 0 ? `${restante} restante${restante === 1 ? '' : 's'}` : 'Sem novas tentativas',
    atingido: !!(l && l.atingido),
  }
}

function resumoCadencia(plano, agora = new Date()) {
  if (!plano || !plano.estagio) return null
  const sinal = SINAL[plano.estagio.sinal] || SINAL.frio
  const followUps = limite(plano.limites && plano.limites.followUps, 'follow-up', 'follow-ups')
  const ligacoes = limite(plano.limites && plano.limites.ligacoes, 'ligação', 'ligações')
  const recomendacao = plano.recomendacao || {}
  const quando = quandoEmTexto(recomendacao.agendado_para, agora)
  const acao = String(recomendacao.proxima_acao || '').trim()
  const canal = String(recomendacao.canal || '').trim()
  const proxima = recomendacao.acao === 'nenhuma'
    ? 'Nenhuma nova tentativa recomendada'
    : [acao || 'Próxima tentativa', canal && canal !== 'nenhuma' ? `por ${canal}` : '', quando].filter(Boolean).join(' · ')
  const avisos = Array.isArray(plano.avisos) ? plano.avisos.filter(Boolean) : []
  return {
    titulo: plano.estagio.rotulo || 'Cadência comercial',
    sinal: sinal.rotulo,
    classeSinal: sinal.classe,
    ritmo: Array.isArray(plano.estagio.ritmo) && plano.estagio.ritmo.length ? plano.estagio.ritmo.join(' · ') : '',
    followUps,
    ligacoes,
    proxima,
    motivo: recomendacao.motivo || '',
    aviso: avisos[0] || '',
  }
}

module.exports = { resumoCadencia }
