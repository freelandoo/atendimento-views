// @ts-check
'use strict'

const FLAG_ATENDE_CONTATOS_EXTERNOS = 'atende_contatos_externos'

function atendeContatosExternos(configJson) {
  return configJson?.[FLAG_ATENDE_CONTATOS_EXTERNOS] === true
}

function mensagemEhDeProspect(contextoProspeccao) {
  return !!contextoProspeccao?.prospect
}

function avaliarEscopoAtendimentoInstancia({ contextoProspeccao = null, configJson = null } = {}) {
  if (mensagemEhDeProspect(contextoProspeccao)) {
    return { podeResponder: true, origem: 'prospeccao' }
  }
  if (atendeContatosExternos(configJson)) {
    return { podeResponder: true, origem: 'contato_externo_liberado' }
  }
  return { podeResponder: false, origem: 'contato_externo_bloqueado' }
}

module.exports = {
  FLAG_ATENDE_CONTATOS_EXTERNOS,
  atendeContatosExternos,
  mensagemEhDeProspect,
  avaliarEscopoAtendimentoInstancia,
}
