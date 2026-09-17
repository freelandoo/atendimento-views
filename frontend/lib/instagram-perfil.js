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
 * Atividade do perfil. Chega PRONTA da API em `instagram_atividade` — a regra (cortes de 30/90
 * dias, leitura dos posts) vive em `backend/src/services/instagram-atividade.js`.
 *
 * `nao_verificado` e AUSENCIA sao coisas diferentes e a tela precisa preservar isso: o primeiro
 * e' "olhei e nao deu para saber" (perfil privado, fonte sem data); o segundo e' "ninguem olhou".
 * Nenhum dos dois autoriza dizer que o negocio esta' parado.
 */
const ROTULO_ATIVIDADE = Object.freeze({
  ativo_recente: 'Postou nos ultimos 30 dias',
  atividade_morna: 'Ultimo post ha 1 a 3 meses',
  atividade_antiga: 'Sem postar ha mais de 3 meses',
  sem_posts: 'Perfil sem nenhuma publicacao',
  nao_verificado: 'Atividade nao verificada',
})

const TOM_ATIVIDADE = Object.freeze({
  ativo_recente: 'ok',
  atividade_morna: 'atencao',
  atividade_antiga: 'neutro',
  sem_posts: 'neutro',
  nao_verificado: 'neutro',
})

/**
 * O estado da atividade, com o aviso de CONFIABILIDADE junto.
 *
 * `confiavel` e' falso quando a medida saiu de um perfil apenas CANDIDATO: ali a atividade e'
 * verdade sobre um perfil que talvez nem seja do lead. Serve para priorizar a revisao humana
 * (vale olhar antes um perfil ativo), nunca para pontuar o lead — foi o que o operador declarou
 * em 2026-09-16. Por isso o rotulo carrega a ressalva em TEXTO, e nao so' numa cor.
 */
function estadoAtividade(lead) {
  const l = lead || {}
  const chave = texto(l.instagram_atividade)
  if (!chave) return { chave: '', rotulo: '', tom: 'neutro', confiavel: false, ressalva: '' }
  const confiavel = texto(l.instagram_confianca) === 'confirmado'
  return {
    chave,
    rotulo: ROTULO_ATIVIDADE[chave] || chave,
    tom: confiavel ? (TOM_ATIVIDADE[chave] || 'neutro') : 'neutro',
    confiavel,
    ressalva: confiavel ? '' : 'medido num perfil ainda nao confirmado',
    ultimo_post_em: texto(l.instagram_ultimo_post_em) || null,
  }
}

/** Estado do trabalho de enriquecimento em si — complementar, nunca bloqueia a operacao. */
const ROTULO_ETAPA = Object.freeze({
  pendente: 'Instagram na fila',
  processando: 'Verificando o Instagram...',
  revisao_humana: 'Perfil aguardando sua confirmacao',
  falhou: 'Nao foi possivel verificar o Instagram',
})

/**
 * O que dizer sobre a atividade, em uma frase; '' quando nao ha' o que dizer.
 *
 * Antes esta funcao afirmava, para todo perfil confirmado, que atividade "ainda nao e verificada"
 * — era verdade enquanto nao existia leitura de posts. Desde a sonda de 2026-09-17 ela existe, e
 * manter a frase antiga faria a tela negar um dado que o sistema tem.
 */
function avisoAtividade(lead) {
  const atividade = estadoAtividade(lead)
  if (atividade.chave && atividade.chave !== 'nao_verificado') {
    return atividade.confiavel ? '' : `${atividade.rotulo} — ${atividade.ressalva}.`
  }
  const etapa = texto((lead || {}).instagram_etapa_status)
  if (etapa === 'pendente' || etapa === 'processando') return `${ROTULO_ETAPA[etapa]}`
  if (estadoInstagram(lead).chave === 'confirmado') {
    return 'Atividade recente (postagens) ainda nao foi verificada neste perfil.'
  }
  return ''
}

/** O rotulo curto do enriquecimento para a linha da listagem; '' quando nao ha' trabalho aberto. */
function rotuloEnriquecimento(lead) {
  const l = lead || {}
  const atividade = estadoAtividade(l)
  if (atividade.chave && atividade.chave !== 'nao_verificado') return atividade.rotulo
  return ROTULO_ETAPA[texto(l.instagram_etapa_status)] || ''
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
  ROTULO_ATIVIDADE,
  ROTULO_ETAPA,
  TOM_ATIVIDADE,
  estadoAtividade,
  rotuloEnriquecimento,
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
