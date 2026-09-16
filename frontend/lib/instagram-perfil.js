// Rotulos de APRESENTACAO do perfil de Instagram do lead. Camada de exibicao apenas — a REGRA
// vive no backend (`backend/src/services/instagram-perfil.js`) e chega pronta na API em
// `instagram_handle`, `instagram_candidato`, `instagram_origem`, `instagram_confianca` e
// `instagram_evidencia`.
//
// Este arquivo NAO decide se um perfil e' do lead (nao ha' comparacao de nome, telefone ou
// dominio aqui, de proposito) e NAO chama busca. Ele traduz o veredito — mesmo contrato de
// `lib/site-rotulos.js`.
//
// A distincao que a tela precisa preservar: CONFIRMADO e' o Instagram do lead; CANDIDATO e' um
// palpite da busca esperando uma pessoa decidir. Exibir os dois igual faria o operador abordar
// alguem pelo perfil de outro negocio.

/** Estado do que se sabe. `null`/ausente = ninguem verificou, que NAO e' "nao tem". */
const ROTULO_CONFIANCA = Object.freeze({
  confirmado: 'Instagram confirmado',
  candidato: 'Perfil a confirmar',
  nao_encontrado: 'Instagram nao encontrado',
})

const ROTULO_ORIGEM = Object.freeze({
  google_meu_negocio: 'declarado no Google Meu Negocio',
  busca: 'encontrado por busca',
  operador: 'confirmado por voce',
})

/** Tom visual. Cor e' REFORCO: todo estado tambem carrega rotulo em texto. */
const TOM_CONFIANCA = Object.freeze({
  confirmado: 'ok',
  candidato: 'atencao',
  nao_encontrado: 'neutro',
  nao_verificado: 'neutro',
})

function texto(valor) {
  return String(valor == null ? '' : valor).trim()
}

/** Estado consolidado do lead, incluindo o quarto caso: ninguem olhou ainda. */
function estadoInstagram(lead) {
  const l = lead || {}
  const confianca = texto(l.instagram_confianca)
  const handle = texto(l.instagram_handle)
  const candidato = texto(l.instagram_candidato)
  if (confianca === 'confirmado' || (!confianca && handle)) {
    return { chave: 'confirmado', handle, candidato: '', tom: TOM_CONFIANCA.confirmado }
  }
  if (confianca === 'candidato' && candidato) {
    return { chave: 'candidato', handle: '', candidato, tom: TOM_CONFIANCA.candidato }
  }
  if (confianca === 'nao_encontrado') {
    return { chave: 'nao_encontrado', handle: '', candidato: '', tom: TOM_CONFIANCA.nao_encontrado }
  }
  return { chave: 'nao_verificado', handle: '', candidato: '', tom: TOM_CONFIANCA.nao_verificado }
}

/** O titulo do bloco. Nunca afirma atividade — ver `avisoAtividade`. */
function rotuloEstado(lead) {
  const estado = estadoInstagram(lead)
  if (estado.chave === 'nao_verificado') return 'Instagram nao verificado'
  return ROTULO_CONFIANCA[estado.chave]
}

/**
 * De onde veio o veredito, em uma frase curta; '' quando nao ha' o que dizer.
 *
 * `nao_encontrado` com origem `busca` precisa de tratamento proprio: o rotulo da origem diria
 * "encontrado por busca" sobre um lead em que a busca NAO encontrou nada — o oposto do fato.
 */
function rotuloOrigem(lead) {
  const l = lead || {}
  if (texto(l.instagram_confianca) === 'nao_encontrado') {
    return texto(l.instagram_origem) === 'busca' ? 'a busca nao encontrou perfil confiavel' : ''
  }
  return ROTULO_ORIGEM[texto(l.instagram_origem)] || ''
}

function urlPerfil(handle) {
  const h = texto(handle)
  return h ? `https://www.instagram.com/${h}/` : ''
}

/**
 * Os sinais que sustentam (ou nao) o palpite, para a pessoa decidir com o que o sistema viu.
 * Vem prontos do backend em `instagram_evidencia.sinais`; aqui so' se separa o que bateu.
 */
function evidencia(lead) {
  const sinais = ((lead || {}).instagram_evidencia || {}).sinais
  const lista = Array.isArray(sinais) ? sinais : []
  return {
    bateram: lista.filter((s) => s && s.ok),
    naoBateram: lista.filter((s) => s && !s.ok),
    total: lista.length,
  }
}

/**
 * O limite do que o sistema pode afirmar hoje.
 *
 * Perfil confirmado NAO e' perfil ativo: a recencia de postagem exige raspar o perfil (coleta
 * paga) e ainda nao existe. A tela precisa dizer isso, senao "Instagram confirmado" e' lido como
 * "Instagram ativo" e o operador decide com uma informacao que ninguem verificou.
 */
function avisoAtividade(lead) {
  return estadoInstagram(lead).chave === 'confirmado'
    ? 'Atividade recente (postagens) ainda nao e verificada pelo sistema.'
    : ''
}

/**
 * O que a pessoa pode fazer agora. A tela so' desenha o que vier daqui.
 *
 * BUSCA E' OFERECIDA UMA VEZ SO'. Depois de `nao_encontrado` o botao NAO volta: cada clique
 * consome uma query do Google CSE (100/dia no gratuito) e repetir a MESMA busca sobre os MESMOS
 * dados devolveria o mesmo nada. O caminho depois da tentativa e' informar a mao — e' o unico que
 * acrescenta informacao que o sistema ainda nao tem.
 *
 * (Se o cadastro mudar e passar a trazer um link de Instagram, ele e' aproveitado de graca: a
 * propria rota de busca confere `handleDeLinkConhecido` antes de gastar query.)
 */
function acoesDisponiveis(lead) {
  const estado = estadoInstagram(lead)
  return {
    podeProcurar: estado.chave === 'nao_verificado',
    podeConfirmar: estado.chave === 'candidato',
    podeRecusar: estado.chave === 'candidato',
    podeTrocar: estado.chave === 'confirmado',
  }
}

/**
 * O que dizer quando alguem marca "Instagram ativo" no ICP sem perfil registrado.
 *
 * Nao BLOQUEIA a marcacao de proposito: o operador pode ter visto o perfil por fora, e o ICP e'
 * julgamento humano. Mas o sistema so' consegue verificar o que esta' registrado — entao a tela
 * pede o registro em vez de deixar o criterio marcado sobre nada.
 */
function avisoIcpSemPerfil(lead) {
  const chave = estadoInstagram(lead).chave
  if (chave === 'confirmado') return ''
  if (chave === 'candidato') return 'Ha um perfil candidato aguardando confirmacao. Confirme para o sistema poder verificar.'
  if (chave === 'nao_encontrado') return 'A busca nao achou o perfil. Informe o Instagram a mao para o sistema poder verificar.'
  return 'Nenhum Instagram registrado para este lead. Registre para o sistema poder verificar.'
}

module.exports = {
  ROTULO_CONFIANCA,
  ROTULO_ORIGEM,
  TOM_CONFIANCA,
  estadoInstagram,
  rotuloEstado,
  rotuloOrigem,
  urlPerfil,
  evidencia,
  avisoAtividade,
  acoesDisponiveis,
  avisoIcpSemPerfil,
}
