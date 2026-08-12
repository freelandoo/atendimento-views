'use strict'
// Vocabulário de APRESENTAÇÃO da próxima ação (a entidade `app.follow_ups`, migration 062).
//
// Regra de ouro deste projeto, repetida aqui: o front TRADUZ o veredito do backend, nunca
// recalcula a regra. Quem decide canal, prazo, prioridade, status e origem é o backend
// (`services/follow-up-modelo.js`); este módulo só sabe transformar isso em texto, ordem e
// destino de navegação.
//
// Este é o DONO do vocabulário da entidade. `lib/followups-fila.js` importa daqui e
// reexporta — o mesmo padrão de `lib/paginacao.js` e `lib/lead-identidade.js`. Duas cópias
// fariam o mesmo follow-up aparecer com um rótulo na fila e outro na tela de ligações.
//
// Sem React, sem rede, sem DOM: testável com `node --test`.

/** Por onde a ação é executada. Ícone textual porque cor nunca é a única informação. */
const CANAL_LABEL = Object.freeze({ whatsapp: 'WhatsApp', ligacao: 'Ligação', email: 'E-mail' })
const CANAL_ICONE = Object.freeze({ whatsapp: '💬', ligacao: '📞', email: '✉️' })

/**
 * QUAL TELA EXECUTA o item — a regra de roteamento do fluxo, num lugar só.
 * Espelha `telaExecutora` do backend; o teste trava os dois valores.
 *
 * `email` executa na PRÓPRIA fila (compositor + envio, migration 067): não existe uma
 * "Central de E-mails", e criar uma tela nova para compor uma mensagem 1:1 duplicaria o
 * compositor manual que a fila já tem.
 */
const DESTINO_POR_CANAL = Object.freeze({
  whatsapp: 'central_mensagens',
  ligacao: 'central_ligacoes',
  email: 'central_follow_ups',
})

/** O que gerou a ação. É contexto do item, nunca uma aba. */
const ORIGEM_LABEL = Object.freeze({
  ligacao: 'Ligação',
  mensagem: 'Mensagem',
  automacao: 'Automação',
  manual: 'Criado manualmente',
})

const STATUS_FOLLOWUP_LABEL = Object.freeze({
  aguardando: 'Aguardando',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  falha: 'Falha',
})

const PRIORIDADE_LABEL = Object.freeze({
  alta: 'Prioridade alta',
  media: 'Prioridade média',
  baixa: 'Prioridade baixa',
})

const PRIORIDADE_OPCOES = Object.freeze([
  { valor: 'alta', label: 'Alta' },
  { valor: 'media', label: 'Média' },
  { valor: 'baixa', label: 'Baixa' },
])

// ─── Disponibilidade de canal do CONTATO (migration 066) ─────────────────────
//
// Três estados, e o terceiro não é o segundo: `true` = o operador verificou e tem WhatsApp;
// `false` = verificou e não tem; `null` = ninguém verificou. Mostrar "não tem" onde ninguém
// olhou seria afirmar, na tela, algo que pessoa nenhuma disse.
//
// Quem DECIDE o canal é o backend (`services/contato-canal-disponibilidade.js`); o que está
// aqui é o texto da consequência, no mesmo espírito de `CANAL_OPCOES` — rótulo de formulário,
// não recálculo de regra. O canal que vale é sempre o que volta na resposta do reagendamento.
const DISPONIBILIDADE_WHATSAPP_LABEL = Object.freeze({
  true: 'Tem WhatsApp',
  false: 'Sem WhatsApp',
  null: 'WhatsApp não verificado',
})

/** Texto do checkbox do reagendamento. Fala do CONTATO, não deste follow-up. */
const MARCAR_SEM_WHATSAPP_LABEL = 'Este contato não tem WhatsApp'
const MARCAR_SEM_WHATSAPP_AJUDA =
  'Marque só se você verificou. O sistema nunca conclui isso sozinho por falha de envio.'

/**
 * Consequência do "sem WhatsApp" no follow-up aberto, quando NÃO há e-mail confirmado. O
 * destino é a ligação — o contato sempre tem telefone, porque o telefone é a identidade dele.
 */
const AVISO_TROCA_PARA_LIGACAO =
  'Ao salvar, este follow-up passa a ser feito por Ligação — este contato não tem e-mail confirmado.'

/** Mesma consequência, com e-mail confirmado: o salto do meio da ordem passou a existir. */
const AVISO_TROCA_PARA_EMAIL =
  'Ao salvar, este follow-up passa a ser feito por E-mail, no endereço confirmado.'

/**
 * O texto da consequência é decidido AQUI, e não no componente, porque ele depende de duas
 * declarações ao mesmo tempo (WhatsApp e e-mail) e da ordem "sem WhatsApp → e-mail confirmado
 * → ligação". A tela só desenha o que esta função devolver; quem decide o canal de verdade é
 * o backend, e o canal que vale é sempre o que volta na resposta do reagendamento.
 *
 * @param {{canal?: string, semWhatsapp?: boolean, emailConfirmado?: string|null}} estado
 * @returns {string|null} aviso, ou `null` quando nada muda de canal.
 */
function avisoDaTrocaDeCanal(estado = {}) {
  if (estado.canal !== 'whatsapp' || !estado.semWhatsapp) return null
  return texto(estado.emailConfirmado) ? AVISO_TROCA_PARA_EMAIL : AVISO_TROCA_PARA_LIGACAO
}

/** Aviso na fila: item num canal que o operador marcou como indisponível para o contato. */
const AVISO_CANAL_DESCARTADO = 'Contato marcado como sem WhatsApp'
const AVISO_CANAL_EMAIL_DESCARTADO = 'Contato marcado como sem e-mail'

// ─── E-mail do contato (migration 067) ───────────────────────────────────────
//
// Mesmo tri-estado do WhatsApp, com uma diferença que é a regra do canal: confirmar exige
// dizer PARA ONDE. Sem endereço não há canal — e um item de e-mail sem destino entraria na
// fila e nunca sairia dela, que é exatamente o motivo pelo qual este canal só nasceu junto
// do executor.
const DISPONIBILIDADE_EMAIL_LABEL = Object.freeze({
  true: 'Tem e-mail confirmado',
  false: 'Sem e-mail',
  null: 'E-mail não verificado',
})

const MARCAR_EMAIL_LABEL = 'Este contato tem e-mail confirmado'
const MARCAR_EMAIL_AJUDA =
  'Marque só se você confirmou com o contato. E-mail que veio do cadastro é sugestão, não confirmação.'

/**
 * Limites do compositor. Espelham `LIMITE_ASSUNTO`/`LIMITE_CORPO` de
 * `backend/src/services/followup-email.js` — a validação que VALE é a de lá; estes existem
 * só para o `maxLength` do campo avisar antes, em vez de o operador perder o texto num 400.
 * Um teste lê o fonte do backend e falha se os dois pares divergirem.
 */
const LIMITE_ASSUNTO_EMAIL = 200
const LIMITE_CORPO_EMAIL = 20000

/** Texto de apoio do compositor, num lugar só — a tela desenha, não redige regra. */
const EMAIL_DESTINO_AJUDA =
  'O e-mail sai para o endereço confirmado por uma pessoa. Para trocar o destino, use Reagendar.'
const EMAIL_CANDIDATOS_AJUDA =
  'Estes endereços vieram do cadastro do lead. São sugestões: ninguém verificou que recebem. '
  + 'Confirme um deles em Reagendar para liberar o envio.'

function rotuloDisponibilidadeEmail(valor) {
  if (valor === true) return DISPONIBILIDADE_EMAIL_LABEL.true
  if (valor === false) return DISPONIBILIDADE_EMAIL_LABEL.false
  return DISPONIBILIDADE_EMAIL_LABEL.null
}

/**
 * Validação de forma do endereço, só para o operador não perder o formulário num 400. A
 * validação que vale é a do backend (fonte única), e nenhuma regex decide se um endereço
 * RECEBE — é por isso que quem confirma é uma pessoa.
 */
function emailValido(valor) {
  const t = texto(valor).toLowerCase()
  if (!t || t.length > 254) return false
  if (/[\s<>",;\\]/.test(t)) return false
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(t)
}

/** Estado inicial do controle de e-mail no reagendamento. Espelha o backend, não adivinha. */
function estadoEmailInicial(item) {
  const v = item && item.email_disponivel
  return v === true || v === false ? v : null
}

/**
 * Parte de e-mail do payload do reagendamento.
 *
 * Só envia quando o operador MUDOU alguma coisa nesta tela: o veredito, ou o endereço de um
 * e-mail que já estava confirmado. Reenviar o mesmo valor gravaria `marcado_por`/`marcado_em`
 * novos e uma linha de auditoria a cada mexida na data — passaria a parecer que alguém
 * reverificou o contato toda vez.
 *
 * @param {boolean|null} inicial  veredito que o backend informou ao abrir o modal.
 * @param {boolean|null} escolhido  veredito selecionado agora.
 * @param {string} endereco  endereço digitado/escolhido agora.
 * @param {string|null} enderecoInicial  endereço confirmado que o backend informou.
 * @param {string} motivo  nota opcional do operador.
 */
function patchEmailDisponibilidade(inicial, escolhido, endereco, enderecoInicial, motivo) {
  if (escolhido !== true && escolhido !== false) return {}
  const novo = texto(endereco).toLowerCase()
  const antigo = texto(enderecoInicial).toLowerCase()
  const mudouVeredito = escolhido !== inicial
  const mudouEndereco = escolhido === true && novo !== antigo
  if (!mudouVeredito && !mudouEndereco) return {}
  const patch = { email_disponivel: escolhido }
  if (escolhido === true) patch.email_endereco = novo
  const nota = texto(motivo)
  // O motivo só acompanha a marcação de indisponibilidade, como no WhatsApp: explicar por que
  // um contato TEM e-mail não é informação que alguém vá procurar depois.
  if (escolhido === false && nota) patch.email_motivo = nota
  return patch
}

/**
 * O que o veredito de e-mail vira quando o operador marca/desmarca "Este contato tem e-mail
 * confirmado". Espelha `alternarSemWhatsapp`, com o sinal invertido (aqui o marcado é a
 * afirmação POSITIVA):
 *   - marcar   → `true` (confirmado; o endereço vai junto no payload);
 *   - desmarcar o que ESTAVA confirmado → `false`: é a única forma reversível que existe, e
 *     ela apaga o endereço — deixar o destino gravado depois de tirar a confirmação daria
 *     rumo a um canal que o operador acabou de descartar;
 *   - desmarcar o que ninguém tinha verificado → `null`: não registra uma verificação que
 *     não houve.
 */
function alternarTemEmail(inicial, marcado) {
  if (marcado) return true
  return inicial === true ? false : (inicial === false ? false : null)
}

function rotuloDisponibilidadeWhatsapp(valor) {
  if (valor === true) return DISPONIBILIDADE_WHATSAPP_LABEL.true
  if (valor === false) return DISPONIBILIDADE_WHATSAPP_LABEL.false
  return DISPONIBILIDADE_WHATSAPP_LABEL.null
}

/**
 * "Este item está num canal que o contato não tem?" Só é verdade com marcação EXPLÍCITA de
 * indisponibilidade — `null`/`undefined` nunca acendem o aviso.
 */
function canalDescartadoPeloOperador(item) {
  if (!item) return false
  if (item.canal === 'whatsapp') return item.whatsapp_disponivel === false
  if (item.canal === 'email') return item.email_disponivel === false
  return false
}

/**
 * Estado inicial do controle de disponibilidade no reagendamento. Espelha o que o backend
 * já disse sobre o CONTATO — nunca um palpite da tela.
 */
function estadoDisponibilidadeInicial(item) {
  const v = item && item.whatsapp_disponivel
  return v === true || v === false ? v : null
}

/**
 * O que o veredito vira quando o operador marca/desmarca "Este contato não tem WhatsApp".
 *
 * Desmarcar NÃO é sempre a mesma coisa, e é por isso que a regra não fica no componente:
 *   - se o contato já estava marcado como SEM WhatsApp, desmarcar é DESFAZER — uma afirmação
 *     nova ("tem WhatsApp"), que precisa ser gravada;
 *   - se ninguém tinha verificado, desmarcar é só não afirmar nada. Voltar para `null` mantém
 *     o contato como não verificado, em vez de registrar uma verificação que não houve.
 *
 * @param {boolean|null} inicial  o que o backend informou ao abrir o modal.
 * @param {boolean} marcado  estado do controle agora.
 * @returns {boolean|null} veredito escolhido.
 */
function alternarSemWhatsapp(inicial, marcado) {
  if (marcado) return false
  return inicial === false ? true : (inicial === true ? true : null)
}

/**
 * Monta a parte de disponibilidade do payload do reagendamento.
 *
 * Só envia `whatsapp_disponivel` quando o operador MUDOU o veredito nesta tela. Reenviar o
 * mesmo valor gravaria uma marcação nova (`marcado_por`/`marcado_em` novos) e uma linha de
 * auditoria a cada reagendamento — passaria a parecer que alguém reverificou o contato toda
 * vez que mexeu na data.
 *
 * @param {boolean|null} inicial  o que o backend informou ao abrir o modal.
 * @param {boolean|null} escolhido  o que está selecionado agora.
 */
function patchDisponibilidade(inicial, escolhido, motivo) {
  if (escolhido !== true && escolhido !== false) return {}
  if (escolhido === inicial) return {}
  const patch = { whatsapp_disponivel: escolhido }
  const nota = typeof motivo === 'string' ? motivo.trim() : ''
  // O motivo só acompanha a marcação de indisponibilidade: explicar por que um contato TEM
  // WhatsApp não é informação que alguém vá procurar depois.
  if (escolhido === false && nota) patch.disponibilidade_motivo = nota
  return patch
}

/**
 * Opções da etapa "Próxima ação" do encerramento da ligação.
 * `nenhuma` é a PRIMEIRA e é uma resposta legítima — não um default escondido. Sem ela, o
 * formulário empurraria o operador a inventar um compromisso para conseguir salvar.
 */
const CANAL_OPCOES = Object.freeze([
  { valor: 'nenhuma', label: 'Sem próxima ação', ajuda: 'A ligação é registrada e nada entra na fila de follow-ups.' },
  { valor: 'whatsapp', label: 'WhatsApp', ajuda: 'Entra na fila e é executado na Central de Mensagens.' },
  { valor: 'ligacao', label: 'Nova ligação', ajuda: 'Entra na fila e é executado na Central de Ligações.' },
])

function texto(v) {
  return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim())
}

function rotuloCanal(canal) {
  return CANAL_LABEL[canal] || null
}

function iconeCanal(canal) {
  return CANAL_ICONE[canal] || null
}

function destinoDoCanal(canal) {
  return DESTINO_POR_CANAL[canal] || null
}

function rotuloOrigem(origem) {
  return ORIGEM_LABEL[origem] || null
}

function rotuloStatusFollowUp(status) {
  return STATUS_FOLLOWUP_LABEL[status] || null
}

function dataValida(iso) {
  if (!iso) return null
  const d = iso instanceof Date ? iso : new Date(iso)
  return Number.isNaN(d.valueOf()) ? null : d
}

function mesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * "hoje às 10:00" / "amanhã às 10:00" / "12/08 às 10:00".
 * O prazo é o que o operador lê primeiro; uma data absoluta para "amanhã" obriga a fazer
 * conta de cabeça a cada linha da fila.
 */
function formatarQuando(iso, agora = new Date()) {
  const d = dataValida(iso)
  if (!d) return null
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1)
  const ontem = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1)
  if (mesmoDia(d, agora)) return `hoje às ${hora}`
  if (mesmoDia(d, amanha)) return `amanhã às ${hora}`
  if (mesmoDia(d, ontem)) return `ontem às ${hora}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`
}

/** Urgência do prazo de um item PERSISTIDO. Só é "atrasado" o que ainda está em aberto. */
function classificarPrazoFollowUp(iso, agora = new Date(), aberto = true) {
  const d = dataValida(iso)
  if (!d) return null
  if (mesmoDia(d, agora)) return d.getTime() < agora.getTime() && aberto ? 'atrasado' : 'hoje'
  if (d.getTime() < agora.getTime()) return aberto ? 'atrasado' : 'passado'
  return 'futuro'
}

/**
 * Resumo curto da próxima ação — é TUDO o que a Central de Ligações mostra sobre ela.
 * A Central de Ligações não vira fila de mensagens: ela diz o que foi combinado e oferece o
 * caminho para o item; quem gerencia a fila é a tela de Follow-ups.
 */
function resumoProximaAcao(followUp, agora = new Date()) {
  if (!followUp || !followUp.canal) return null
  const canal = rotuloCanal(followUp.canal)
  const quando = formatarQuando(followUp.agendado_para, agora)
  const acao = texto(followUp.proxima_acao)
  const partes = [canal, quando].filter(Boolean).join(' ')
  return acao ? `${acao} — ${partes}` : `Próxima ação: ${partes}`
}

/**
 * Sugestão de próxima ação a partir do RESULTADO da chamada. É sugestão, não decisão: todos
 * os campos continuam editáveis, e "Sem próxima ação" continua a um clique. Existe para o
 * caso comum não exigir digitação — não para escolher pelo operador.
 */
const SUGESTAO_POR_RESULTADO = Object.freeze({
  atendeu: { canal: 'whatsapp', proxima_acao: 'Retomar por WhatsApp', prioridade: 'media', horas: 24 },
  nao_atendeu: { canal: 'ligacao', proxima_acao: 'Ligar novamente', prioridade: 'media', horas: 24 },
  caixa_postal: { canal: 'ligacao', proxima_acao: 'Ligar novamente', prioridade: 'media', horas: 24 },
  ocupado: { canal: 'ligacao', proxima_acao: 'Ligar novamente', prioridade: 'alta', horas: 4 },
  reagendou: { canal: 'ligacao', proxima_acao: 'Ligar no horário combinado', prioridade: 'alta', horas: 24 },
  // Número inválido não gera próxima ação: não há para onde ligar nem para onde escrever.
  numero_invalido: { canal: 'nenhuma', proxima_acao: '', prioridade: 'media', horas: 0 },
})

function sugerirProximaAcao(resultado, agora = new Date()) {
  const s = SUGESTAO_POR_RESULTADO[resultado] || { canal: 'nenhuma', proxima_acao: '', prioridade: 'media', horas: 24 }
  return {
    canal: s.canal,
    proxima_acao: s.proxima_acao,
    prioridade: s.prioridade,
    agendado_para: s.canal === 'nenhuma' ? '' : paraInputLocal(new Date(agora.getTime() + s.horas * 3600 * 1000)),
    responsavel_id: '',
  }
}

/**
 * `<input type="datetime-local">` fala horário LOCAL sem fuso, e `toISOString()` devolve UTC.
 * Converter errado aqui desloca todo compromisso em 3 horas — em produção isso vira ligação
 * na hora errada, não bug de tela.
 */
function paraInputLocal(data) {
  const d = dataValida(data)
  if (!d) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Caminho inverso: o valor do input local vira instante absoluto (ISO com fuso). */
function deInputLocal(valor) {
  const t = texto(valor)
  if (!t) return null
  const d = new Date(t)
  return Number.isNaN(d.valueOf()) ? null : d.toISOString()
}

/**
 * Valida a etapa "Próxima ação" ANTES de enviar. A validação de verdade é a do backend
 * (fonte única); esta existe só para o operador não perder o resumo inteiro num 400.
 */
function validarProximaAcao(form = {}) {
  const erros = {}
  const canal = texto(form.canal) || 'nenhuma'
  if (canal === 'nenhuma') return { ok: true, erros }
  if (!CANAL_LABEL[canal]) erros.canal = 'Escolha WhatsApp, nova ligação ou "sem próxima ação".'
  if (!texto(form.proxima_acao)) erros.proxima_acao = 'Descreva o que precisa ser feito.'
  const quando = deInputLocal(form.agendado_para)
  if (!quando) erros.agendado_para = 'Informe a data e a hora.'
  if (form.prioridade && !PRIORIDADE_LABEL[form.prioridade]) erros.prioridade = 'Prioridade inválida.'
  return { ok: Object.keys(erros).length === 0, erros }
}

/**
 * Monta o bloco `follow_up` do encerramento. Devolve `null` para "sem próxima ação" — e é
 * `null` mesmo, não um objeto vazio: o backend trata ausência como "nada a criar".
 */
function montarPayloadProximaAcao(form = {}) {
  const canal = texto(form.canal) || 'nenhuma'
  if (canal === 'nenhuma') return null
  return {
    canal,
    proxima_acao: texto(form.proxima_acao),
    agendado_para: deInputLocal(form.agendado_para),
    prioridade: texto(form.prioridade) || 'media',
    responsavel_id: texto(form.responsavel_id) || null,
  }
}

/**
 * Normaliza um follow-up PERSISTIDO no formato de item da fila.
 *
 * Duas decisões que valem a leitura:
 *
 * 1. `aguardando` com prazo no FUTURO fica na situação "aguardando"; com prazo vencido, hoje
 *    ou agora, vira "aberto". É a diferença entre "tem um compromisso marcado" e "precisa ser
 *    feito" — sem ela, um follow-up para o mês que vem disputaria espaço com o trabalho de
 *    hoje no topo da fila.
 * 2. A prioridade vem gravada no item (uma pessoa escolheu), então ela SEMPRE existe aqui —
 *    ao contrário do item do automático, que nunca passou pelo call score.
 */
function itemDeFollowUp(f, agora = new Date()) {
  const aberto = f.status === 'aguardando'
  const prazoQuando = classificarPrazoFollowUp(f.agendado_para, agora, aberto)
  const situacao = !aberto
    ? (f.status === 'concluido' ? 'concluido' : f.status === 'cancelado' ? 'cancelado' : 'falha')
    : (prazoQuando === 'futuro' ? 'aguardando' : 'aberto')
  return {
    followup_id: f.id,
    followup_status: f.status,
    canal: f.canal,
    origem: f.origem,
    responsavel_id: f.responsavel_id || null,
    responsavel_nome: texto(f.responsavel_nome) || null,
    campanha_lead_id: f.campanha_lead_id || null,
    // O id da CAMPANHA acompanha o do lead: sem ele o botao "Ir para a ligacao" nao
    // conseguiria abrir a fila certa, e a Central de Ligacoes so' trabalha por campanha.
    campanha_id: f.campanha_id || null,
    campanha_nome: texto(f.campanha_nome) || null,
    prospect_id: f.prospect_id || null,
    ligacao_id: f.ligacao_id || null,
    ligacao_resultado: texto(f.ligacao_resultado) || null,
    ligacao_em: f.ligacao_em || null,
    conversa_numero: texto(f.conversa_numero) || null,
    observacao: texto(f.observacao) || null,
    resultado_nota: texto(f.resultado_nota) || null,
    situacao,
    prazo: f.agendado_para || null,
    prazo_quando: prazoQuando,
    prazo_label: formatarQuando(f.agendado_para, agora),
    prioridade: PRIORIDADE_LABEL[f.prioridade] ? f.prioridade : null,
    acao_label: texto(f.proxima_acao) || null,
    destino: destinoDoCanal(f.canal),
    // Veredito HUMANO sobre o WhatsApp do contato (migration 066). Tri-estado: `null` é
    // "ninguém verificou" e nunca vira `false` aqui — a coerção que a tela faria seria
    // exatamente a inferência que este módulo existe para impedir.
    whatsapp_disponivel: f.whatsapp_disponivel === true || f.whatsapp_disponivel === false
      ? f.whatsapp_disponivel
      : null,
    whatsapp_motivo: texto(f.whatsapp_motivo) || null,
    // Mesmo tri-estado para o e-mail (migration 067). O ENDEREÇO só chega quando foi
    // confirmado — o backend não devolve destino de um canal marcado como indisponível.
    email_disponivel: f.email_disponivel === true || f.email_disponivel === false
      ? f.email_disponivel
      : null,
    email_endereco: texto(f.email_endereco) || null,
    email_motivo: texto(f.email_motivo) || null,
  }
}

/**
 * Contexto de origem passado ao painel de conversa quando o item é aberto pela fila.
 * São DADOS, não uma requisição: o painel é o mesmo nas duas portas de entrada e não pode
 * depender de uma rota admin-only que a Central de Mensagens não tem permissão de chamar.
 */
function contextoDeOrigem(item, agora = new Date()) {
  if (!item || !item.followup_id) return null
  const linhas = []
  if (item.acao_label) linhas.push(item.acao_label)
  const quando = item.prazo_label || formatarQuando(item.prazo, agora)
  if (quando) linhas.push(`Prazo: ${quando}`)
  if (item.ligacao_resultado) {
    const data = item.ligacao_em ? formatarQuando(item.ligacao_em, agora) : null
    linhas.push(`Veio da ligação${data ? ` de ${data}` : ''} — resultado: ${item.ligacao_resultado}`)
  } else if (item.origem) {
    linhas.push(`Origem: ${rotuloOrigem(item.origem)}`)
  }
  if (item.campanha_nome) linhas.push(`Campanha: ${item.campanha_nome}`)
  if (item.responsavel_nome) linhas.push(`Responsável: ${item.responsavel_nome}`)
  if (item.observacao) linhas.push(item.observacao)
  return { titulo: `Follow-up por ${rotuloCanal(item.canal) || 'WhatsApp'}`, linhas }
}

/** Rótulos dos eventos da linha do tempo do contato (`GET /contatos/:telefone/historico`). */
const EVENTO_LABEL = Object.freeze({
  ligacao_encerrada: 'Ligação encerrada',
  ligacao_registrada: 'Ligação registrada',
  followup_criado: 'Follow-up criado',
  followup_concluido: 'Follow-up concluído',
  followup_cancelado: 'Follow-up cancelado',
  followup_falha: 'Follow-up com falha',
  // E-mails entram na linha do tempo porque, ao contrário das mensagens de WhatsApp, não há
  // outra tela que os mostre. Sai o assunto, nunca o corpo.
  email_enviado: 'E-mail enviado',
  email_falhou: 'E-mail não enviado',
})

function rotuloEvento(tipo) {
  return EVENTO_LABEL[tipo] || 'Evento'
}

module.exports = {
  CANAL_LABEL,
  CANAL_ICONE,
  CANAL_OPCOES,
  ORIGEM_LABEL,
  STATUS_FOLLOWUP_LABEL,
  PRIORIDADE_LABEL,
  PRIORIDADE_OPCOES,
  DESTINO_POR_CANAL,
  EVENTO_LABEL,
  // Disponibilidade de canal do CONTATO (migration 066). Tradução do veredito HUMANO que o
  // backend já deu — a tela não recalcula canal nem infere indisponibilidade.
  DISPONIBILIDADE_WHATSAPP_LABEL,
  MARCAR_SEM_WHATSAPP_LABEL,
  MARCAR_SEM_WHATSAPP_AJUDA,
  AVISO_TROCA_PARA_LIGACAO,
  AVISO_TROCA_PARA_EMAIL,
  AVISO_CANAL_DESCARTADO,
  AVISO_CANAL_EMAIL_DESCARTADO,
  avisoDaTrocaDeCanal,
  rotuloDisponibilidadeWhatsapp,
  canalDescartadoPeloOperador,
  estadoDisponibilidadeInicial,
  alternarSemWhatsapp,
  patchDisponibilidade,
  // E-mail do contato (migration 067). Mesmo contrato: tradução do veredito humano que o
  // backend já deu — a tela não decide canal nem infere confirmação a partir do cadastro.
  DISPONIBILIDADE_EMAIL_LABEL,
  MARCAR_EMAIL_LABEL,
  MARCAR_EMAIL_AJUDA,
  LIMITE_ASSUNTO_EMAIL,
  LIMITE_CORPO_EMAIL,
  EMAIL_DESTINO_AJUDA,
  EMAIL_CANDIDATOS_AJUDA,
  rotuloDisponibilidadeEmail,
  emailValido,
  estadoEmailInicial,
  alternarTemEmail,
  patchEmailDisponibilidade,
  rotuloCanal,
  iconeCanal,
  destinoDoCanal,
  rotuloOrigem,
  rotuloStatusFollowUp,
  rotuloEvento,
  formatarQuando,
  classificarPrazoFollowUp,
  resumoProximaAcao,
  sugerirProximaAcao,
  paraInputLocal,
  deInputLocal,
  validarProximaAcao,
  montarPayloadProximaAcao,
  itemDeFollowUp,
  contextoDeOrigem,
}
