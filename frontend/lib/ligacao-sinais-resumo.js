'use strict'
// Resumo PURO dos sinais da Operação da Ligação (substitui lib/ligacao-marcas).
//
// Antes existiam DUAS estruturas medindo interesse/resistência: as marcas 🟢/🔴 (só na
// memória do React — sumiam no refresh) e os chips de sinais (persistidos na hora). Foram
// unificadas em app.ligacao_sinais. Este módulo só DERIVA o que a tela mostra a partir dos
// sinais já persistidos; a fonte oficial gravada na ligação é a derivação equivalente do
// servidor (src/db/ligacoes.js → derivarEtapasDeSinais). Mantenha as duas em sincronia.

/** @typedef {{ tipo: 'interesse'|'resistencia', etapa_tipo: string|null }} Sinal */

/**
 * Conta interesse/resistência e deriva a ÚLTIMA etapa de cada tipo.
 * Espera a lista em ordem cronológica (a API devolve ORDER BY registrado_em ASC).
 */
function resumoSinais(sinais) {
  let interesse = 0
  let resistencia = 0
  let etapaMaiorInteresse = null
  let etapaPerda = null
  for (const s of sinais || []) {
    if (!s) continue
    if (s.tipo === 'interesse') {
      interesse += 1
      if (s.etapa_tipo) etapaMaiorInteresse = s.etapa_tipo
    } else if (s.tipo === 'resistencia') {
      resistencia += 1
      if (s.etapa_tipo) etapaPerda = s.etapa_tipo
    }
  }
  return { interesse, resistencia, etapaMaiorInteresse, etapaPerda }
}

module.exports = { resumoSinais }
