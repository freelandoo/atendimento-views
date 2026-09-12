'use strict'
// Central de Mensagens em EQUIPE — APRESENTAÇÃO PURA. CRM em equipe, Etapa 7.
//
// Traduz dois vereditos que o backend já resolveu (`services/conversa-responsavel.js`):
//   • de quem é a conversa (`responsavel_id`);
//   • que recorte a Central está mostrando (`meta.escopo`).
//
// ─── A REGRA OPOSTA À DO LEAD, E ELA É O CORAÇÃO DESTE MÓDULO ────────────────────────────
// Em lead, não ser o dono BLOQUEIA a abordagem. Em conversa, **responder nunca é bloqueado** —
// travar a resposta no meio de um atendimento deixa o CLIENTE sem resposta porque o sistema
// decidiu que a pessoa errada estava na tela. Por isso `avisoDeAtendimento` devolve um AVISO e
// nunca um impedimento, e por isso não existe aqui nenhuma função do tipo `podeResponder`.
// Quem for acrescentar uma: o teste `conversa-operacao.test.js` cobra essa ausência.
//
// Módulo sem React, sem rede, sem DOM: testável com `node --test`.

// ─── Recorte por atendente ───────────────────────────────────────────────────────────────

// Espelha `ESCOPO` de `services/conversa-responsavel.js`.
const ESCOPO_CONVERSA = Object.freeze({
  MINHAS: 'minhas',
  NAO_ATRIBUIDAS: 'nao_atribuidas',
  TODAS: 'todas',
})

const ESCOPO_ROTULO = {
  minhas: 'Minhas',
  nao_atribuidas: 'Não atribuídas',
  todas: 'Todas',
  proprias: 'Minhas conversas',
}

/**
 * As opções de recorte que esta pessoa pode escolher.
 *
 * Quem não pode ver todas não recebe a fila de "não atribuídas": o servidor já limita a leitura
 * às conversas atribuídas à pessoa e às que chegaram pela própria instância.
 */
function opcoesEscopoConversa(podeVerTodas) {
  if (!podeVerTodas) return [{ valor: '', rotulo: ESCOPO_ROTULO.proprias }]
  return [
    { valor: '', rotulo: ESCOPO_ROTULO.todas },
    { valor: ESCOPO_CONVERSA.MINHAS, rotulo: ESCOPO_ROTULO.minhas },
    { valor: ESCOPO_CONVERSA.NAO_ATRIBUIDAS, rotulo: ESCOPO_ROTULO.nao_atribuidas },
    { valor: ESCOPO_CONVERSA.TODAS, rotulo: ESCOPO_ROTULO.todas },
  ]
}

/** O que a tela deve dizer sobre o recorte que RECEBEU (vem no `meta.escopo` da API). */
function rotuloEscopoEfetivoConversa(escopo) {
  return ESCOPO_ROTULO[String(escopo || '')] || ESCOPO_ROTULO.todas
}

/**
 * O servidor rebaixou o pedido? Recortar em silêncio faria o atendente achar que a Central
 * esvaziou — então a tela precisa dizer o que está mostrando, e só quando houve rebaixamento.
 */
function avisoDeRecorte(escopoPedido, escopoEfetivo) {
  const pedido = String(escopoPedido || '')
  const efetivo = String(escopoEfetivo || '')
  if (!efetivo || efetivo === pedido) return ''
  if (efetivo === 'proprias') {
    return 'Mostrando apenas conversas atribuídas a você e as do seu número.'
  }
  return ''
}

// ─── Atendente da conversa ───────────────────────────────────────────────────────────────

/**
 * De quem é esta conversa, do ponto de vista de quem olha.
 * `nao_atribuida` é estado de primeira classe — é a FILA, não uma pendência de cadastro.
 */
function atendenteDaConversa(conversa, usuarioId) {
  const dono = (conversa || {}).responsavel_id || null
  if (!dono) return { estado: 'nao_atribuida', rotulo: 'Sem atendente', meu: false }
  if (String(dono) === String(usuarioId)) return { estado: 'meu', rotulo: 'Você', meu: true }
  // Sem o nome, ainda assim NUNCA se mostra o id.
  return { estado: 'de_outro', rotulo: (conversa || {}).responsavel_nome || 'Outro atendente', meu: false }
}

/**
 * O aviso que aparece ANTES do compositor quando a conversa é de outra pessoa.
 *
 * Espelha `avaliarResponder`: `podeResponder` é **sempre true**. Ele existe como campo, e não como
 * ausência de campo, para a regra ficar escrita — alguém vai querer "travar a conversa do colega",
 * e é aqui que essa conversa tem de acontecer.
 */
function avisoDeAtendimento(conversa, usuarioId) {
  const dono = atendenteDaConversa(conversa, usuarioId)
  return {
    podeResponder: true,
    avisar: dono.estado === 'de_outro',
    texto: dono.estado === 'de_outro' ? `Esta conversa está com ${dono.rotulo}. Você pode responder mesmo assim.` : '',
  }
}

/**
 * O que a pessoa pode fazer com o atendente desta conversa.
 *
 * Três ações distintas: **assumir** a que está sem dono; **devolver** a própria para a fila (não
 * exige capacidade de transferir — quem pegou pode largar); **transferir** a de outra pessoa, que
 * exige a capacidade de ver a Central inteira, porque quem redistribui precisa enxergar o todo.
 */
function acoesDeAtendente(conversa, { usuarioId, podeAtender = false, podeTransferir = false } = {}) {
  const dono = atendenteDaConversa(conversa, usuarioId)
  return {
    assumir: dono.estado === 'nao_atribuida' && podeAtender,
    devolver: dono.meu && podeAtender,
    transferir: podeTransferir && dono.estado !== 'nao_atribuida',
    atribuir: podeTransferir && dono.estado === 'nao_atribuida',
    // Por que o botão de assumir não aparece, quando não aparece. Botão sumido sem explicação é o
    // que faz o operador achar que a tela quebrou. O nome entra COMO ESTÁ — normalizar destruiria
    // nome próprio ("Já é de ana.").
    motivoSemAssumir: dono.estado === 'meu' ? 'Esta conversa já é sua.'
      : dono.estado === 'de_outro' ? `Já está com ${dono.rotulo}.`
        : !podeAtender ? 'Você não pode assumir conversas.'
          : '',
  }
}

/**
 * Uma linha do histórico de atendentes, pronta para a tela.
 * Os nomes vêm dos joins de `db/conversa-responsavel.js`; id de usuário NUNCA é exibido.
 */
function descreverMudancaDeAtendente(evento) {
  const e = evento || {}
  const acao = String(e.acao || '')
  const de = e.responsavel_anterior_nome || ''
  const para = e.responsavel_novo_nome || ''
  if (acao === 'assumiu') return { rotulo: `${para || 'Alguém'} assumiu`, tom: 'positivo' }
  if (acao === 'liberou') return { rotulo: `${de || 'Alguém'} devolveu para a fila`, tom: 'neutro' }
  if (acao === 'transferiu') return { rotulo: `Transferida de ${de || '—'} para ${para || '—'}`, tom: 'neutro' }
  if (acao === 'atribuiu') return { rotulo: `Atribuída a ${para || '—'}`, tom: 'neutro' }
  return { rotulo: para || de || acao || '—', tom: 'neutro' }
}

module.exports = {
  ESCOPO_CONVERSA,
  ESCOPO_ROTULO,
  opcoesEscopoConversa,
  rotuloEscopoEfetivoConversa,
  avisoDeRecorte,
  atendenteDaConversa,
  avisoDeAtendimento,
  acoesDeAtendente,
  descreverMudancaDeAtendente,
}
