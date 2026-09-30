'use strict'
// META PESSOAL — apresentação PURA (sem React, sem rede). A tela só traduz: o veredito
// (progresso {alvo, fracao, faltam, alcancado}) vem pronto da API.
//
// `proximidade` é REEXPORTADA de minha-operacao.js (mesmo padrão de reexport de paginacao.js):
// a barra de meta é a MESMA do painel "Minha Operação", e duas cópias divergiriam na mesma tela.
const { proximidade } = require('./minha-operacao')

// ISO: 1=segunda .. 7=domingo, a mesma numeração da migration 111.
const DIAS = Object.freeze([
  { iso: 1, curto: 'Seg', longo: 'Segunda' },
  { iso: 2, curto: 'Ter', longo: 'Terça' },
  { iso: 3, curto: 'Qua', longo: 'Quarta' },
  { iso: 4, curto: 'Qui', longo: 'Quinta' },
  { iso: 5, curto: 'Sex', longo: 'Sexta' },
  { iso: 6, curto: 'Sáb', longo: 'Sábado' },
  { iso: 7, curto: 'Dom', longo: 'Domingo' },
])

const DIAS_UTEIS_PADRAO = Object.freeze([1, 2, 3, 4, 5])

// Rótulo de cada barra. `contatos` = modo geral (mensagem + ligação juntas); no separado,
// uma barra por canal. A tela só traduz — a chave vem pronta da API.
const ROTULO_CANAL = Object.freeze({
  contatos: 'Contatos',
  ligacoes: 'Ligações',
  mensagens: 'Mensagens',
})

const rotuloCanal = (chave) => ROTULO_CANAL[chave] || chave

/** Rótulo curto dos dias atendidos, na ordem da semana: "Seg, Ter, Qua, Qui, Sex". */
function rotuloDias(dias) {
  const set = new Set((dias || []).map(Number))
  return DIAS.filter((d) => set.has(d.iso)).map((d) => d.curto).join(', ') || '—'
}

module.exports = { proximidade, DIAS, DIAS_UTEIS_PADRAO, rotuloDias, ROTULO_CANAL, rotuloCanal }
