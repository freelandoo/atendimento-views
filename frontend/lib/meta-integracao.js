// Lógica PURA da tela Configurações › Integrações › Meta Conversions.
//
// Fica fora do .tsx pelo mesmo motivo dos outros módulos de `lib/`: rótulo de estado,
// texto de ajuda e regra de "o que o botão pode fazer agora" são decisões testáveis
// sem montar React.
//
// O que NÃO mora aqui, de propósito: qualquer autorização. Quem pode ver e mudar a
// credencial é decidido no backend (requireAuth + requireRole + requireEmpresaAccess).
// A tela apenas evita mostrar controle que o servidor recusaria.

/** Estados possíveis. `nao_configurada` é a AUSÊNCIA de configuração, não um valor salvo. */
const ESTADOS = ['nao_configurada', 'em_teste', 'ativa', 'precisa_atencao', 'desativada']

const ROTULO_ESTADO = {
  nao_configurada: 'Não configurada',
  em_teste: 'Em teste',
  ativa: 'Ativa',
  precisa_atencao: 'Precisa de atenção',
  desativada: 'Desativada',
}

const DESCRICAO_ESTADO = {
  nao_configurada: 'Informe o conjunto de dados e o token da sua conta Meta para começar.',
  em_teste: 'Configuração salva. Teste a conexão para poder ativar o envio.',
  ativa: 'Enviando as conversões escolhidas para a sua conta Meta.',
  precisa_atencao: 'A Meta recusou o último envio. Corrija e teste de novo.',
  desativada: 'Nada está sendo enviado. Os resultados continuam registrados aqui.',
}

// Paleta por estado — mesma família de cores usada nos selos do resto do painel.
const TOM_ESTADO = {
  nao_configurada: 'bg-slate-100 text-slate-600',
  em_teste: 'bg-amber-50 text-amber-700',
  ativa: 'bg-emerald-50 text-emerald-700',
  precisa_atencao: 'bg-rose-50 text-rose-700',
  desativada: 'bg-slate-100 text-slate-500',
}

/** Estado da integração a partir da resposta da API. `null` = nunca configurada. */
function estadoDaIntegracao(integracao) {
  if (!integracao) return 'nao_configurada'
  const s = integracao.status
  return ESTADOS.includes(s) ? s : 'nao_configurada'
}

function rotuloEstado(estado) {
  return ROTULO_ESTADO[estado] || ROTULO_ESTADO.nao_configurada
}

function descricaoEstado(estado) {
  return DESCRICAO_ESTADO[estado] || DESCRICAO_ESTADO.nao_configurada
}

function tomEstado(estado) {
  return TOM_ESTADO[estado] || TOM_ESTADO.nao_configurada
}

// ─── Eventos e ajuda contextual ───────────────────────────────────────────────

// A ordem é a do funil. `ajuda` é o texto do tooltip ao lado de cada evento — ele
// existe para o dono do negócio entender O QUE dispara o envio sem precisar de
// documentação, e para deixar explícito o que NÃO é enviado.
const EVENTOS = [
  {
    chave: 'reuniao_agendada',
    nome: 'Reunião agendada',
    resumo: 'O contato escolheu data e horário.',
    ajuda: 'Enviado quando o contato escolhe data e horário para a reunião. Se a reunião já nascer cancelada, nada é enviado.',
  },
  {
    chave: 'reuniao_realizada',
    nome: 'Reunião realizada',
    resumo: 'A reunião aconteceu de fato.',
    ajuda: 'Enviado quando a reunião é marcada como concluída. Reunião cancelada e contato que não compareceu ficam só aqui dentro — nunca vão para a Meta.',
  },
  {
    chave: 'reuniao_realizada_com_venda',
    nome: 'Reunião realizada com venda',
    resumo: 'A reunião terminou em venda.',
    ajuda: 'Enviado quando a reunião concluída tem um valor de venda registrado. Sem valor informado, o evento de venda não é criado.',
  },
]

const AJUDA_CAMPO = {
  dataset_id: 'O ID do conjunto de dados (antigo Pixel) da sua conta Meta. Só números — você encontra no Gerenciador de Eventos.',
  waba_id: 'ID da sua conta do WhatsApp Business. Para anúncios de Click-to-WhatsApp, a Meta exige este ID ou o da Página.',
  page_id: 'ID da Página do Facebook que roda os anúncios. Use quando você não tiver o ID da conta WhatsApp Business.',
  access_token: 'Token de acesso gerado no Gerenciador de Negócios. Ele é guardado criptografado e nunca é exibido de volta — só os 4 últimos caracteres.',
  test_event_code: 'Opcional. Com ele, os envios aparecem em "Testar eventos" no Gerenciador e não entram na otimização das campanhas.',
}

// ─── Formulário ───────────────────────────────────────────────────────────────

/**
 * Espelha a validação do backend para dar resposta imediata. NÃO substitui a do
 * servidor — o backend valida de novo, e é a validação dele que vale.
 */
function validarFormulario(form = {}, { jaConfigurada = false } = {}) {
  const erros = {}
  const dataset = String(form.dataset_id || '').trim()
  if (!dataset) erros.dataset_id = 'Informe o ID do conjunto de dados.'
  else if (!/^[0-9]{5,}$/.test(dataset)) erros.dataset_id = 'O ID do conjunto de dados tem só números.'

  const page = String(form.page_id || '').trim()
  const waba = String(form.waba_id || '').trim()
  if (!page && !waba) {
    erros.destino = 'Informe o ID da conta WhatsApp Business ou o da Página do Facebook.'
  }

  const token = String(form.access_token || '').trim()
  // Numa integração já salva o campo fica vazio (o token não volta da API); enviar o
  // formulário sem token nesse caso significa "trocar tudo, menos o token" — o que o
  // backend não suporta hoje. Então exigimos digitar de novo, e dizemos isso.
  if (!token) {
    erros.access_token = jaConfigurada
      ? 'Cole o token novamente para salvar as alterações.'
      : 'Informe o token de acesso da Meta.'
  }

  return { ok: Object.keys(erros).length === 0, erros }
}

/** Ao menos um evento precisa estar ligado para o teste (e para o envio) fazer sentido. */
function algumEventoLigado(eventos = {}) {
  return EVENTOS.some((e) => eventos[e.chave] === true)
}

/**
 * O que a tela pode oferecer agora. Regras espelhadas do backend:
 *  - testar exige configuração salva e ao menos um evento ligado;
 *  - ativar exige último teste bem-sucedido (o backend recusa com 409 se não houver).
 */
function acoesDisponiveis(integracao) {
  const estado = estadoDaIntegracao(integracao)
  const existe = estado !== 'nao_configurada'
  const eventos = (integracao && integracao.eventos) || {}
  const temEvento = algumEventoLigado(eventos)
  return {
    podeTestar: existe && temEvento,
    // Desligar todos os eventos depois de um teste bem-sucedido não pode deixar o
    // botão Ativar aceso: ativar sem evento algum liga uma integração que não envia
    // nada. (O backend chega ao mesmo resultado — sem evento, o teste falha.)
    podeAtivar: existe && temEvento && integracao.ultimo_teste_ok === true && estado !== 'ativa',
    podeDesativar: existe && estado === 'ativa',
    podeRemover: existe,
    // Motivo por que "Ativar" está bloqueado — bloquear sem explicar é o que gera suporte.
    motivoAtivarBloqueado: !existe
      ? 'Salve a configuração antes de ativar.'
      : !temEvento
        ? 'Ligue pelo menos um evento antes de ativar.'
        : integracao.ultimo_teste_ok !== true
          ? 'Teste a conexão com a Meta antes de ativar.'
          : null,
  }
}

// ─── Histórico ────────────────────────────────────────────────────────────────

const ROTULO_STATUS_EVENTO = {
  pendente: 'Aguardando envio',
  enviado: 'Enviado',
  falhou: 'Falhou',
  ignorado: 'Não enviado',
  corrigido: 'Corrigido depois do envio',
}

const TOM_STATUS_EVENTO = {
  pendente: 'bg-slate-100 text-slate-600',
  enviado: 'bg-emerald-50 text-emerald-700',
  falhou: 'bg-rose-50 text-rose-700',
  ignorado: 'bg-slate-100 text-slate-500',
  corrigido: 'bg-amber-50 text-amber-700',
}

function rotuloStatusEvento(status) {
  return ROTULO_STATUS_EVENTO[status] || status || '—'
}

function tomStatusEvento(status) {
  return TOM_STATUS_EVENTO[status] || TOM_STATUS_EVENTO.ignorado
}

function rotuloTipoEvento(tipo) {
  const e = EVENTOS.find((x) => x.chave === tipo)
  return e ? e.nome : tipo
}

/** Valor em moeda. Sem valor devolve traço — nunca "R$ 0,00", que mentiria. */
function formatarValor(valor, moeda) {
  if (valor == null || !Number.isFinite(Number(valor))) return '—'
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda || 'BRL' }).format(Number(valor))
  } catch (_) {
    return `${moeda || 'BRL'} ${Number(valor).toFixed(2)}`
  }
}

/**
 * Uma frase explicando a linha do histórico. Prioridade: erro > motivo de não envio >
 * correção. Um evento "não enviado" sem explicação é o que faz o operador achar que
 * o sistema perdeu a conversão dele.
 */
function explicacaoDoEvento(ev = {}) {
  if (ev.status === 'falhou' || ev.status === 'pendente') return ev.erro || null
  if (ev.status === 'ignorado') return ev.motivo || null
  if (ev.status === 'corrigido') {
    return 'O valor mudou depois do envio. A Meta não aceita correção de conversão já registrada, então o valor novo fica registrado só aqui.'
  }
  return null
}

module.exports = {
  ESTADOS,
  EVENTOS,
  AJUDA_CAMPO,
  estadoDaIntegracao,
  rotuloEstado,
  descricaoEstado,
  tomEstado,
  validarFormulario,
  algumEventoLigado,
  acoesDisponiveis,
  rotuloStatusEvento,
  tomStatusEvento,
  rotuloTipoEvento,
  formatarValor,
  explicacaoDoEvento,
}
