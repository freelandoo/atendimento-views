'use strict'
// Bloco de texto compacto com o histórico COMERCIAL do contato — quantas ligações já
// houve, duração/resultado da última e as anotações do operador (resultado_nota /
// próxima ação dos follow-ups) — para alimentar a geração de mensagem da IA (follow-up
// e 1ª abordagem) com sinais reais, não só a qualificação cadastral/ICP.
//
// Read-only: REUSA historicoDoContato (db/follow-ups.js), que já lê ligações
// (duracao_seg, resultado, motivo_perda), follow-ups, e-mails e auto já enviados —
// nenhuma consulta nova. NUNCA lança: em qualquer falha retorna '' e o caller segue
// sem o bloco (comportamento atual preservado).
const { historicoDoContato } = require('../db/follow-ups')

function soDigitos(v) { return String(v || '').replace(/\D/g, '') }

function fmtDuracao(seg) {
  const s = Number(seg)
  if (!Number.isFinite(s) || s <= 0) return ''
  const m = Math.floor(s / 60)
  const r = s % 60
  return m ? `${m}min${r ? ` ${r}s` : ''}` : `${r}s`
}

function diasAtras(ocorridoEm) {
  const t = new Date(ocorridoEm).getTime()
  if (!Number.isFinite(t)) return ''
  const d = Math.floor((Date.now() - t) / 86400000)
  if (d <= 0) return 'hoje'
  if (d === 1) return 'ontem'
  return `há ${d} dias`
}

/**
 * @returns {Promise<string>} bloco em PT-BR ou '' (sem histórico / falha / telefone inválido)
 */
async function montarBlocoHistoricoComercial(pool, empresaId, telefone, { limit = 20, _historico } = {}) {
  try {
    const dig = soDigitos(telefone)
    if (!pool || !empresaId || dig.length < 8) return ''
    const ler = _historico || historicoDoContato
    const rows = await ler(pool, empresaId, dig, { limit })
    if (!Array.isArray(rows) || !rows.length) return ''

    const linhas = []

    // rows vem ordenado por ocorrido_em DESC (mais recente primeiro).
    const ligacoes = rows.filter((r) => String(r.tipo || '').startsWith('ligacao'))
    if (ligacoes.length) {
      const ult = ligacoes[0]
      const dur = fmtDuracao(ult.duracao_seg)
      const det = [ult.rotulo, dur && `durou ${dur}`, ult.detalhe].filter(Boolean).join(', ')
      linhas.push(`- Ligações: ${ligacoes.length} registrada(s); última ${diasAtras(ult.ocorrido_em)}${det ? `: ${det}` : ''}`)
    }

    // Anotações do operador nos follow-ups (próxima ação combinada + nota do resultado).
    const anotacoes = rows
      .filter((r) => String(r.tipo || '').startsWith('followup') && (r.detalhe || r.rotulo))
      .slice(0, 3)
      .map((r) => [r.rotulo, r.detalhe].filter(Boolean).join(' — '))
      .filter(Boolean)
    for (const a of anotacoes) linhas.push(`- Anotação: ${String(a).slice(0, 200)}`)

    return linhas.join('\n')
  } catch {
    return ''
  }
}

module.exports = { montarBlocoHistoricoComercial }
