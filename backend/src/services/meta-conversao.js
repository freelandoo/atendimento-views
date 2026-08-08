'use strict'

// Regras PURAS da integração Meta por empresa. Sem banco, sem rede, sem IA.
//
// Tudo o que decide "este fato vira evento?", "com que nome?", "com que chave?" e
// "vale a pena tentar de novo?" mora aqui, para poder ser testado sem Postgres e sem
// tocar a API da Meta. A orquestração (ler banco, cifrar, enviar) fica em
// meta-dispatch.js; o SQL em db/conversao-eventos.js e db/meta-integracoes.js.

// ─── Estados e tipos (espelham as CHECK da migration 057) ──────────────────────

// Resultado interno da reunião. `cancelada` e `no_show` NÃO estão aqui porque não
// são conversão: são resultado interno e nunca chegam à Meta (decisão de produto).
const TIPOS_CONVERSAO = Object.freeze([
  'reuniao_agendada',
  'reuniao_realizada',
  'reuniao_realizada_com_venda',
])

const STATUS_EVENTO = Object.freeze(['pendente', 'enviado', 'falhou', 'ignorado', 'corrigido'])
const STATUS_INTEGRACAO = Object.freeze(['em_teste', 'ativa', 'precisa_atencao', 'desativada'])
const ENTIDADE_TIPOS = Object.freeze(['agenda_app', 'agenda_vendas'])

// Status de reunião que representam resultado INTERNO: existem no produto, aparecem
// no painel, e nunca viram evento na Meta. Vale para as duas agendas (os enums de
// vendas.agenda_eventos e app.agenda_eventos coincidem nestes dois valores).
const STATUS_REUNIAO_INTERNOS = Object.freeze(['cancelado', 'nao_compareceu'])

// ─── Mapeamento interno → taxonomia da Meta ───────────────────────────────────
//
// Com action_source='business_messaging' (Click-to-WhatsApp) a Meta aceita a
// taxonomia de MENSAGENS, não os nomes de pixel. Mapeamento adotado:
//
//   reuniao_agendada            → LeadSubmitted  (o contato escolheu data e horário)
//   reuniao_realizada           → QualifiedLead  (a reunião aconteceu de fato)
//   reuniao_realizada_com_venda → Purchase       (+ value e currency obrigatórios)
//
// Três nomes DISTINTOS de propósito: a Meta deduplica por event_id dentro de uma
// janela, e reusar o mesmo nome faria a reunião realizada apagar a agendada.
//
// AVISO OPERACIONAL: o AGENTS.md registra `QualifiedLead` REJEITADO em produção
// (subcode 2804066) numa versão anterior da taxonomia; a documentação vigente o
// lista como suportado. Por isso "Testar conexão" exercita TODOS os eventos
// habilitados em modo teste ANTES de a integração poder ser ativada — se a Meta
// ainda recusar, o admin descobre no teste, não em produção.
const EVENTO_META = Object.freeze({
  reuniao_agendada: 'LeadSubmitted',
  reuniao_realizada: 'QualifiedLead',
  reuniao_realizada_com_venda: 'Purchase',
})

// Coluna de habilitação (app.meta_integracoes) de cada tipo interno.
const CAMPO_HABILITADO = Object.freeze({
  reuniao_agendada: 'evento_agendada',
  reuniao_realizada: 'evento_realizada',
  reuniao_realizada_com_venda: 'evento_venda',
})

// Prefixo curto do tipo na chave de idempotência. Curto porque o event_id viaja para
// a Meta; estável porque mudá-lo reenviaria como novo tudo o que já foi enviado.
const PREFIXO_TIPO = Object.freeze({
  reuniao_agendada: 'ra',
  reuniao_realizada: 'rr',
  reuniao_realizada_com_venda: 'rv',
})

function nomeMetaDoTipo(tipo) {
  return EVENTO_META[tipo] || null
}

function eventoHabilitado(integracao = {}, tipo) {
  const campo = CAMPO_HABILITADO[tipo]
  return campo ? integracao[campo] === true : false
}

/** Tipos internos habilitados nesta integração, na ordem natural do funil. */
function tiposHabilitados(integracao = {}) {
  return TIPOS_CONVERSAO.filter((t) => eventoHabilitado(integracao, t))
}

// ─── Idempotência ─────────────────────────────────────────────────────────────

/**
 * Chave determinística do fato de negócio.
 *
 * Formato: `<tipo>:<entidade_tipo>:<entidade_id>`.
 *
 * A chave identifica a ENTIDADE (a reunião) e o TIPO do evento — nunca o telefone.
 * Consequências que o modelo antigo (`${telefone}:${event_name}`) não tinha:
 *   - o mesmo contato pode fechar duas vendas em duas reuniões, e as duas contam;
 *   - salvar a mesma reunião de novo devolve a MESMA chave, então o índice único
 *     (empresa_id, event_id) recusa a segunda linha e nada é enviado duas vezes.
 *
 * `empresa_id` não entra na string: ele é coluna do índice único. Duas empresas
 * jamais compartilham entidade, e manter a chave curta ajuda no Gerenciador da Meta.
 */
function montarEventId({ tipo, entidadeTipo, entidadeId }) {
  const prefixo = PREFIXO_TIPO[tipo]
  if (!prefixo) throw new Error(`Tipo de conversão desconhecido: ${tipo}`)
  if (!ENTIDADE_TIPOS.includes(entidadeTipo)) {
    throw new Error(`Entidade de conversão desconhecida: ${entidadeTipo}`)
  }
  const id = String(entidadeId == null ? '' : entidadeId).trim()
  if (!id) throw new Error('Conversão sem entidade de origem')
  return `${prefixo}:${entidadeTipo}:${id}`
}

// ─── Normalização de dados pessoais ───────────────────────────────────────────

/** Telefone só com dígitos. Chave de junção com a atribuição; nunca de idempotência. */
function normalizarTelefone(valor) {
  const d = String(valor == null ? '' : valor).replace(/\D/g, '')
  return d || null
}

/** Telefone mascarado para tela/log: preserva DDI+DDD e os 4 últimos. */
function mascararTelefone(valor) {
  const d = normalizarTelefone(valor)
  if (!d) return null
  if (d.length <= 4) return '*'.repeat(d.length)
  return `${d.slice(0, Math.min(4, d.length - 4))}${'*'.repeat(Math.max(0, d.length - 8))}${d.slice(-4)}`
}

// ─── Validação da venda ───────────────────────────────────────────────────────

const MOEDA_PADRAO = 'BRL'

/**
 * Valor + moeda de uma venda. Retorna { ok, valor, moeda, motivo }.
 * Venda sem valor NÃO vira evento — é critério de aceite, e é a diferença entre
 * mandar receita real e mandar receita zero para o algoritmo do anunciante.
 */
function validarVenda({ valor, moeda } = {}) {
  const n = Number(valor)
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, motivo: 'venda_sem_valor' }
  }
  const m = String(moeda || MOEDA_PADRAO).trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(m)) {
    return { ok: false, motivo: 'moeda_invalida' }
  }
  // 2 casas: a Meta trata value como decimal; centavo a mais vira ruído de receita.
  return { ok: true, valor: Math.round(n * 100) / 100, moeda: m }
}

// ─── Elegibilidade de um fato ─────────────────────────────────────────────────

/**
 * Um fato de reunião deve virar linha no ledger?
 *
 * @param {object} fato  { tipo, statusReuniao, temAtribuicao, valor, moeda }
 * @param {object} integracao  linha de app.meta_integracoes
 * @returns {{ok:boolean, motivo?:string, valor?:number, moeda?:string}}
 */
function avaliarFato(fato = {}, integracao = {}) {
  const { tipo, statusReuniao, temAtribuicao } = fato

  if (!TIPOS_CONVERSAO.includes(tipo)) return { ok: false, motivo: 'tipo_desconhecido' }
  if (!eventoHabilitado(integracao, tipo)) return { ok: false, motivo: 'evento_desabilitado' }

  // Reunião cancelada ou não comparecida é resultado INTERNO. A regra vale inclusive
  // para o evento de AGENDAMENTO: uma reunião que já nasceu cancelada nunca chegou a
  // ser uma conversão. (Este é o defeito R-4 do motor antigo, que só perguntava se
  // existia reunião e mandava cancelamento e no-show como conversão.)
  if (STATUS_REUNIAO_INTERNOS.includes(String(statusReuniao || ''))) {
    return { ok: false, motivo: 'reuniao_cancelada_ou_no_show' }
  }

  // Sem clique de anúncio não há o que atribuir: o evento não teria a quem creditar.
  // Normal e esperado para lead de prospecção ativa — não é erro.
  if (temAtribuicao !== true) return { ok: false, motivo: 'sem_atribuicao' }

  if (tipo === 'reuniao_realizada_com_venda') {
    const venda = validarVenda(fato)
    if (!venda.ok) return { ok: false, motivo: venda.motivo }
    return { ok: true, valor: venda.valor, moeda: venda.moeda }
  }

  return { ok: true }
}

// ─── Retentativa ──────────────────────────────────────────────────────────────

// A Meta aceita evento de mensagem com até 7 DIAS de atraso. O teto de tentativas
// abaixo consome ~13h no pior caso — folgado dentro da janela e curto o bastante
// para o operador ver a falha enquanto ela ainda importa.
const MAX_TENTATIVAS = 6
const BACKOFF_MIN = Object.freeze([1, 5, 25, 120, 360, 720])

/** Minutos até a próxima tentativa após a tentativa `numeroTentativa` (1-based). */
function minutosAteProximaTentativa(numeroTentativa) {
  const i = Math.max(1, Number(numeroTentativa) || 1) - 1
  return BACKOFF_MIN[Math.min(i, BACKOFF_MIN.length - 1)]
}

// Códigos da Graph API que não adianta repetir: o problema é a configuração do
// tenant, não a rede. Estes derrubam a integração para 'precisa_atencao'.
const ERROS_PERMANENTES_CODIGO = new Set([
  190, // token inválido / expirado / revogado
  102, // sessão inválida
  200, // permissão insuficiente
  803, // objeto (dataset) inexistente
])
const ERROS_PERMANENTES_SUBCODIGO = new Set([
  2804066, // nome de evento não aceito para Click-to-WhatsApp
  2804116, // falta page_id / whatsapp_business_account_id no user_data
])

/**
 * Decide o destino de um evento depois de uma tentativa falha.
 * @returns {{permanente:boolean, desativarIntegracao:boolean, esgotou:boolean}}
 */
function classificarFalha({ httpStatus, codigo, subcodigo, tentativas } = {}) {
  const cod = Number(codigo)
  const sub = Number(subcodigo)
  const permanente =
    ERROS_PERMANENTES_CODIGO.has(cod) ||
    ERROS_PERMANENTES_SUBCODIGO.has(sub) ||
    // 4xx que não seja 429: a Meta rejeitou o conteúdo; repetir devolve o mesmo erro.
    (Number(httpStatus) >= 400 && Number(httpStatus) < 500 && Number(httpStatus) !== 429)
  const esgotou = (Number(tentativas) || 0) >= MAX_TENTATIVAS
  return {
    permanente,
    // Credencial/configuração ruim afeta TODOS os eventos da empresa, não só este:
    // a integração inteira vira "precisa de atenção" e para de queimar tentativas.
    desativarIntegracao: ERROS_PERMANENTES_CODIGO.has(cod) || ERROS_PERMANENTES_SUBCODIGO.has(sub),
    esgotou: permanente || esgotou,
  }
}

// ─── Mensagens de erro para o operador ────────────────────────────────────────

const MENSAGEM_POR_SUBCODIGO = Object.freeze({
  2804116: 'Falta o ID da Página ou da conta WhatsApp Business. Preencha um dos dois e teste de novo.',
  2804066: 'A Meta não aceitou o nome deste evento para anúncios de Click-to-WhatsApp.',
})
const MENSAGEM_POR_CODIGO = Object.freeze({
  190: 'Token inválido ou expirado. Gere um novo no Gerenciador de Negócios e cole aqui.',
  102: 'A sessão do token expirou. Gere um novo token no Gerenciador de Negócios.',
  200: 'O token não tem permissão para enviar eventos a este conjunto de dados.',
  803: 'Conjunto de dados (Dataset/Pixel) não encontrado. Confira o ID informado.',
  4: 'A Meta está limitando o volume de envios agora. Vamos tentar de novo automaticamente.',
  17: 'A Meta está limitando o volume de envios agora. Vamos tentar de novo automaticamente.',
})

/**
 * Traduz o erro da Meta para uma frase segura de mostrar na tela.
 *
 * SANITIZAÇÃO: devolve SEMPRE texto de uma lista conhecida ou uma frase genérica com
 * o código. A mensagem crua da Meta pode ecoar o payload enviado (que inclui
 * ctwa_clid e identificadores) — ela não pode chegar à tela nem ao log.
 */
function mensagemDeErro({ codigo, subcodigo, httpStatus } = {}) {
  const sub = Number(subcodigo)
  if (MENSAGEM_POR_SUBCODIGO[sub]) return MENSAGEM_POR_SUBCODIGO[sub]
  const cod = Number(codigo)
  if (MENSAGEM_POR_CODIGO[cod]) return MENSAGEM_POR_CODIGO[cod]
  const st = Number(httpStatus)
  if (st === 429) return 'A Meta está limitando o volume de envios agora. Vamos tentar de novo automaticamente.'
  if (st >= 500) return 'A Meta está indisponível no momento. Vamos tentar de novo automaticamente.'
  if (st >= 400) return `A Meta recusou o envio (código ${st}). Confira o conjunto de dados e o token.`
  return 'Não foi possível falar com a Meta. Vamos tentar de novo automaticamente.'
}

// Motivo de "ignorado" traduzido para a tela — o operador precisa entender por que um
// fato não virou conversão sem abrir o banco.
const MENSAGEM_POR_MOTIVO = Object.freeze({
  evento_desabilitado: 'Este evento está desligado na configuração da empresa.',
  reuniao_cancelada_ou_no_show: 'A reunião foi cancelada ou o contato não compareceu — não vai para a Meta.',
  sem_atribuicao: 'O contato não veio de um anúncio (sem clique rastreado) — não há a que atribuir.',
  venda_sem_valor: 'A venda foi registrada sem valor. Informe o valor para que ela vire conversão.',
  moeda_invalida: 'A moeda informada não é válida (use 3 letras, ex.: BRL).',
  integracao_inativa: 'A integração com a Meta não está ativa.',
  empresa_nao_resolvida: 'Não foi possível identificar a empresa desta reunião — envio bloqueado por segurança.',
  tipo_desconhecido: 'Tipo de evento não reconhecido.',
})

function mensagemDeMotivo(motivo) {
  return MENSAGEM_POR_MOTIVO[String(motivo || '')] || 'Este resultado não gerou conversão na Meta.'
}

module.exports = {
  TIPOS_CONVERSAO,
  STATUS_EVENTO,
  STATUS_INTEGRACAO,
  ENTIDADE_TIPOS,
  STATUS_REUNIAO_INTERNOS,
  EVENTO_META,
  CAMPO_HABILITADO,
  MOEDA_PADRAO,
  MAX_TENTATIVAS,
  nomeMetaDoTipo,
  eventoHabilitado,
  tiposHabilitados,
  montarEventId,
  normalizarTelefone,
  mascararTelefone,
  validarVenda,
  avaliarFato,
  minutosAteProximaTentativa,
  classificarFalha,
  mensagemDeErro,
  mensagemDeMotivo,
}
