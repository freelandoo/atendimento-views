'use strict'
// Config do Banco de Leads por EMPRESA (modo de disparo + geração por IA + agenda
// do Automático). Acesso a banco isolado, como manda a arquitetura. A tabela é
// criada pela migration 020; quando ainda não há linha, devolve o default virtual
// (sem persistir) para o boot/GET nunca falhar.
const MODOS = new Set(['manual', 'semi_automatico', 'automatico'])

const CAMPOS = `empresa_id, modo, gerar_ia, instrucoes_ia, auto_ativo, auto_instancia_id,
  janela_inicio, janela_fim, teto_diario, intervalo_min, intervalo_max, auto_proximo_disparo_em`

function defaultConfig(empresaId) {
  return {
    empresa_id: empresaId,
    modo: 'manual',
    gerar_ia: true,
    instrucoes_ia: null,
    auto_ativo: false,
    auto_instancia_id: null,
    janela_inicio: '08:00',
    janela_fim: '18:00',
    teto_diario: 40,
    intervalo_min: 15,
    intervalo_max: 30,
    auto_proximo_disparo_em: null,
  }
}

async function obterConfigBancoLeads(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS} FROM app.banco_leads_config WHERE empresa_id = $1`,
    [empresaId]
  )
  return rows[0] || defaultConfig(empresaId)
}

// Teto diário é fixo em 40 (limite de segurança anti-ban — o volume real é limitado
// pelo intervalo × janela). Intervalo em minutos, travado na faixa 15–30 pedida.
const TETO_FIXO = 40
function normalizarHora(valor, padrao) {
  const m = String(valor || '').trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return padrao
  const h = Number(m[1]); const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return padrao
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}
function clampInt(v, def, lo, hi) {
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, lo), hi)
}

function normalizarTimestampOuNull(valor, padrao) {
  if (valor === undefined) return padrao
  if (valor == null || String(valor).trim() === '') return null
  const data = new Date(valor)
  return Number.isNaN(data.getTime()) ? padrao : data
}

// Upsert parcial: só os campos presentes no patch mudam; o resto preserva o atual.
async function salvarConfigBancoLeads(pool, empresaId, patch = {}) {
  const atual = await obterConfigBancoLeads(pool, empresaId)
  const modo = MODOS.has(patch.modo) ? patch.modo : atual.modo
  const gerarIa = typeof patch.gerar_ia === 'boolean' ? patch.gerar_ia : atual.gerar_ia
  const instrucoesIa = patch.instrucoes_ia === undefined
    ? atual.instrucoes_ia
    : (patch.instrucoes_ia == null || String(patch.instrucoes_ia).trim() === ''
        ? null
        : String(patch.instrucoes_ia).slice(0, 2000))
  // Campos do modo Automático.
  const autoAtivo = typeof patch.auto_ativo === 'boolean' ? patch.auto_ativo : atual.auto_ativo
  const autoInstanciaId = patch.auto_instancia_id === undefined
    ? atual.auto_instancia_id
    : (patch.auto_instancia_id == null || String(patch.auto_instancia_id).trim() === '' ? null : String(patch.auto_instancia_id))
  const janelaInicio = patch.janela_inicio === undefined ? atual.janela_inicio : normalizarHora(patch.janela_inicio, atual.janela_inicio)
  const janelaFim = patch.janela_fim === undefined ? atual.janela_fim : normalizarHora(patch.janela_fim, atual.janela_fim)
  const intervaloMin = patch.intervalo_min === undefined ? atual.intervalo_min : clampInt(patch.intervalo_min, atual.intervalo_min, 15, 30)
  let intervaloMax = patch.intervalo_max === undefined ? atual.intervalo_max : clampInt(patch.intervalo_max, atual.intervalo_max, 15, 30)
  if (intervaloMax < intervaloMin) intervaloMax = intervaloMin
  const autoProximoDisparoEm = normalizarTimestampOuNull(
    patch.auto_proximo_disparo_em,
    atual.auto_proximo_disparo_em
  )

  const { rows } = await pool.query(
    `INSERT INTO app.banco_leads_config
       (empresa_id, modo, gerar_ia, instrucoes_ia, auto_ativo, auto_instancia_id, janela_inicio, janela_fim, teto_diario, intervalo_min, intervalo_max, auto_proximo_disparo_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (empresa_id) DO UPDATE
       SET modo = EXCLUDED.modo,
           gerar_ia = EXCLUDED.gerar_ia,
           instrucoes_ia = EXCLUDED.instrucoes_ia,
           auto_ativo = EXCLUDED.auto_ativo,
           auto_instancia_id = EXCLUDED.auto_instancia_id,
           janela_inicio = EXCLUDED.janela_inicio,
           janela_fim = EXCLUDED.janela_fim,
           teto_diario = EXCLUDED.teto_diario,
           intervalo_min = EXCLUDED.intervalo_min,
           intervalo_max = EXCLUDED.intervalo_max,
           auto_proximo_disparo_em = EXCLUDED.auto_proximo_disparo_em,
           atualizado_em = NOW()
     RETURNING ${CAMPOS}`,
    [empresaId, modo, gerarIa, instrucoesIa, autoAtivo, autoInstanciaId, janelaInicio, janelaFim, TETO_FIXO, intervaloMin, intervaloMax, autoProximoDisparoEm]
  )
  return rows[0]
}

module.exports = { obterConfigBancoLeads, salvarConfigBancoLeads, MODOS, defaultConfig, TETO_FIXO }
