'use strict'
// Ordem de TRABALHO do Banco de Leads — APRESENTAÇÃO PURA.
//
// Quem CLASSIFICA o lead na fila é o backend (`services/lead-fila-trabalho.js`), dentro da
// própria consulta: o veredito chega pronto no campo `faixa_trabalho` e a lista já vem ordenada.
// Aqui só se traduz o nome da faixa em frase — mesma regra de ouro de `lib/site-rotulos.js` e
// `lib/capacidades.js`.
//
// PROIBIDO reimplementar a classificação aqui (olhar `status`, `rodado_em`, `telefone`,
// `mensagem_gerada`…). Foi exatamente a tela decidir a própria ordem que produziu o defeito que
// este módulo existe para corrigir: o backend mandava por `updated_at DESC`, a tela reordenava
// por "cadastro menos completo primeiro", e o lead SEM TELEFONE ficava em primeiro lugar.
// Há guarda de regressão em `lead-fila-trabalho.test.js`.
//
// Sem React, sem rede, sem DOM: testável com `node --test`.

/** Faixas, na ordem da fila. Espelha o backend — a fonte é ele. */
const ORDEM_FAIXAS = [
  'cliente_esperando',
  'pronto_enviar',
  'nunca_abordado',
  'abordado_sem_resposta',
  'falta_contato',
  'em_espera',
  'fora_da_fila',
]

const FAIXA = {
  cliente_esperando: {
    rotulo: 'Respondeu',
    dica: 'O cliente respondeu e está esperando. É o único trabalho com alguém do outro lado.',
    tom: 'urgente',
  },
  pronto_enviar: {
    rotulo: 'Pronto para enviar',
    dica: 'A mensagem já foi gerada. Falta revisar e enviar.',
    tom: 'pronto',
  },
  nunca_abordado: {
    rotulo: 'Não trabalhado',
    dica: 'Ninguém falou com este lead ainda — nem pelo disparo, nem pelo WhatsApp na mão.',
    tom: 'novo',
  },
  abordado_sem_resposta: {
    rotulo: 'Sem resposta',
    dica: 'Já foi abordado e não respondeu. É retomada.',
    tom: 'neutro',
  },
  falta_contato: {
    rotulo: 'Falta contato',
    dica: 'Sem telefone utilizável. É trabalho de completar o cadastro, não de vender.',
    tom: 'atencao',
  },
  em_espera: {
    rotulo: 'Em espera',
    dica: 'Tem compromisso marcado ou está travado. Volta para a fila sozinho na data.',
    tom: 'espera',
  },
  fora_da_fila: {
    rotulo: 'Fora da fila',
    dica: 'Negócio fechado ou lead recusado. Fica como histórico.',
    tom: 'neutro',
  },
}

/**
 * Selo da faixa. Faixa desconhecida (backend mais novo que a tela) devolve `null` em vez de
 * inventar rótulo — some o selo, e a ordem continua sendo a que o servidor mandou.
 */
function seloFaixa(faixa) {
  const chave = String(faixa || '')
  return FAIXA[chave] ? { chave, ...FAIXA[chave] } : null
}

/**
 * A janela está cortando carteira?
 *
 * A listagem devolve no máximo `limite` leads e a tela pagina DENTRO dessa janela. Com a ordem
 * de trabalho isso deixou de esconder o urgente (a janela passou a ser dos mais urgentes), mas
 * continua existindo — e o operador precisa saber, senão acha que a carteira é do tamanho do que
 * está vendo.
 */
function avisoDeJanela(meta) {
  const total = Number(meta && meta.total_carteira)
  const mostrando = Number(meta && meta.total)
  if (!Number.isFinite(total) || !Number.isFinite(mostrando) || total <= mostrando) return null
  return {
    total,
    mostrando,
    texto: `Mostrando os ${mostrando} leads mais urgentes de ${total}. Use a busca ou os filtros para alcançar o resto.`,
  }
}

module.exports = { ORDEM_FAIXAS, seloFaixa, avisoDeJanela }
