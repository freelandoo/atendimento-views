// @ts-check
'use strict'

const FLAG_ATENDE_CONTATOS_EXTERNOS = 'atende_contatos_externos'

function atendeContatosExternos(configJson) {
  return configJson?.[FLAG_ATENDE_CONTATOS_EXTERNOS] === true
}

function mensagemEhDeProspect(contextoProspeccao) {
  return !!contextoProspeccao?.prospect
}

// Permissão para CAPTURAR e responder. Contato externo sem permissão é DESCARTADO no
// webhook (nem grava conversa), não só pausado. As quatro permissões:
//   - prospect (o número casa um prospect enviado/respondeu);
//   - conversaExiste: a operação já iniciou (envio manual pelo app OU abordagem do
//     prospectado — os dois criam a conversa no envio; cold inbound nunca cria);
//   - veioDeAnuncio: clicou no anúncio (CTWA) — é lead, entra igual prospect;
//   - atende_contatos_externos ligado na instância.
function avaliarEscopoAtendimentoInstancia({
  contextoProspeccao = null,
  configJson = null,
  conversaExiste = false,
  veioDeAnuncio = false,
} = {}) {
  if (mensagemEhDeProspect(contextoProspeccao)) {
    return { podeResponder: true, podeCapturar: true, origem: 'prospeccao' }
  }
  if (conversaExiste) {
    return { podeResponder: true, podeCapturar: true, origem: 'conversa_iniciada' }
  }
  if (veioDeAnuncio) {
    return { podeResponder: true, podeCapturar: true, origem: 'anuncio' }
  }
  if (atendeContatosExternos(configJson)) {
    return { podeResponder: true, podeCapturar: true, origem: 'contato_externo_liberado' }
  }
  return { podeResponder: false, podeCapturar: false, origem: 'contato_externo_bloqueado' }
}

module.exports = {
  FLAG_ATENDE_CONTATOS_EXTERNOS,
  atendeContatosExternos,
  mensagemEhDeProspect,
  avaliarEscopoAtendimentoInstancia,
}
