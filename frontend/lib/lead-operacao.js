'use strict'
// Banco de Leads em EQUIPE — APRESENTAÇÃO PURA. CRM em equipe, Etapas 3, 4 e 5.
//
// Cobre três vereditos que o backend já resolveu e a tela só TRADUZ:
//   Etapa 3 — `qualificacao`: o lead passou pela triagem?
//   Etapa 4 — `responsavel_id`: de quem é o lead?
//   Etapa 5 — `canal`/`confirmado_por`: a abordagem foi COMPROVADA ou DECLARADA?
//
// Regra de ouro (a mesma de `lib/site-rotulos.js` e `lib/capacidades.js`): **a regra vive no
// backend; aqui só se traduz**. Este módulo não decide quem pode abordar, não recalcula
// qualificação e não reimplementa `podeAbordar` — duplicar faria a tela e o servidor divergirem
// em silêncio, e a divergência apareceria como "o botão estava lá e deu 403".
//
// Sem React, sem rede, sem DOM: testável com `node --test`.

// ─── Etapa 3: qualificação ───────────────────────────────────────────────────────────────

const QUALIFICACAO_ROTULO = {
  pendente: 'Aguardando triagem',
  aprovado: 'Aprovado',
  descartado: 'Descartado',
  legado: 'Sem triagem registrada',
}

const QUALIFICACAO_DETALHE = {
  pendente: 'Ninguém analisou este lead ainda. Ele não entra na operação comercial.',
  aprovado: 'Uma pessoa aprovou este lead para ser trabalhado.',
  descartado: 'Uma pessoa recusou este lead. Ele não é abordado por nenhum canal.',
  // `legado` NÃO é "aprovado": é a ausência de prova, nomeada. Dizer isso na tela é o que impede
  // o operador de achar que a carteira inteira foi triada.
  legado: 'Estava na carteira antes da triagem existir. Continua sendo trabalhado, mas ninguém o avaliou.',
}

// `descartado` é o único que o operador precisa enxergar como problema; `pendente` é trabalho a
// fazer; `legado` é informação. Cor nunca é o único sinal — todo selo carrega rótulo em texto.
const QUALIFICACAO_TOM = {
  pendente: 'atencao',
  aprovado: 'positivo',
  descartado: 'negativo',
  legado: 'neutro',
}

/** Selo de qualificação, pronto para a tela. Valor desconhecido vira "—", nunca some. */
function seloQualificacao(qualificacao) {
  const q = String(qualificacao || '')
  if (!QUALIFICACAO_ROTULO[q]) {
    return { rotulo: q || '—', detalhe: '', tom: 'neutro', conhecido: false }
  }
  return {
    rotulo: QUALIFICACAO_ROTULO[q],
    detalhe: QUALIFICACAO_DETALHE[q],
    tom: QUALIFICACAO_TOM[q],
    conhecido: true,
  }
}

/**
 * O lead pode ser abordado?
 *
 * **Espelha `services/lead-qualificacao.js`** e existe só para a tela não oferecer um botão que
 * vai responder 422. O servidor continua sendo a autoridade — se os dois discordarem, quem vale
 * é ele. Valor ausente NEGA, pelo mesmo motivo do backend: um payload que esqueceu a coluna não
 * pode abrir a porta por omissão.
 */
function podeAbordar(lead) {
  const q = String((lead || {}).qualificacao || '')
  return q === 'aprovado' || q === 'legado'
}

// ─── Etapa 4: responsável ────────────────────────────────────────────────────────────────

const ESCOPO_LEAD = Object.freeze({
  MEUS: 'meus',
  LIVRES: 'livres',
  TODOS: 'todos',
})

const ESCOPO_ROTULO = {
  meus: 'Meus leads',
  livres: 'Livres',
  todos: 'Todos',
  meus_e_livres: 'Meus e livres',
}

/**
 * As opções de recorte que esta pessoa pode escolher.
 * Quem não pode ver a carteira inteira não recebe "Todos" — oferecer uma opção que o servidor
 * rebaixa faria a tela mostrar menos do que prometeu.
 */
function opcoesEscopo(podeVerTodos) {
  const base = [
    { valor: ESCOPO_LEAD.MEUS, rotulo: ESCOPO_ROTULO.meus },
    { valor: ESCOPO_LEAD.LIVRES, rotulo: ESCOPO_ROTULO.livres },
  ]
  if (podeVerTodos) base.push({ valor: ESCOPO_LEAD.TODOS, rotulo: ESCOPO_ROTULO.todos })
  return base
}

/** O que a tela deve dizer sobre o recorte que RECEBEU (vem no `meta.escopo` da API). */
function rotuloEscopoEfetivo(escopo) {
  return ESCOPO_ROTULO[String(escopo || '')] || 'Todos'
}

/**
 * De quem é este lead, do ponto de vista de quem olha.
 * `livre` é estado de primeira classe — não é "erro" nem "pendência".
 */
function donoDoLead(lead, usuarioId) {
  const dono = (lead || {}).responsavel_id || null
  if (!dono) return { estado: 'livre', rotulo: 'Livre', meu: false }
  if (String(dono) === String(usuarioId)) return { estado: 'meu', rotulo: 'Você', meu: true }
  return { estado: 'de_outro', rotulo: lead.responsavel_nome || 'Outro vendedor', meu: false }
}

/**
 * O que a pessoa pode fazer com o responsável deste lead.
 *
 * Três ações distintas, e a separação importa: **assumir** um lead livre é de qualquer vendedor;
 * **devolver** o próprio para a fila também; **transferir** o de outra pessoa exige capacidade.
 */
function acoesDeResponsavel(lead, { usuarioId, podeAssumir = false, podeTransferir = false } = {}) {
  const dono = donoDoLead(lead, usuarioId)
  return {
    assumir: dono.estado === 'livre' && podeAssumir && podeAbordar(lead),
    devolver: dono.meu,
    transferir: podeTransferir && dono.estado !== 'livre',
    atribuir: podeTransferir && dono.estado === 'livre',
    // Por que o botão de assumir não aparece, quando não aparece. Botão sumido sem explicação é
    // o que faz o operador achar que a tela quebrou.
    //
    // O nome da pessoa entra COMO ESTÁ: aplicar `toLowerCase()` aqui produzia "Já é de ana." —
    // nome próprio destruído por uma normalização pensada para outra coisa.
    motivoSemAssumir: dono.estado === 'meu' ? 'Este lead já é seu.'
      : dono.estado === 'de_outro' ? `Já é de ${dono.rotulo}.`
        : !podeAbordar(lead) ? 'Este lead ainda não foi liberado para a operação comercial.'
          : !podeAssumir ? 'Você não pode assumir leads.'
            : '',
  }
}

// ─── Etapa 5: abordagem manual ───────────────────────────────────────────────────────────

/**
 * Como descrever uma abordagem — e este é o ponto mais importante do módulo.
 *
 * O backend devolve `prova` já resolvido (`services/abordagem-manual.js` → `forcaDaProva`). A
 * tela **não recalcula**: um número que soma entrega confirmada com declaração do vendedor não se
 * sustenta, e a única defesa contra isso é a descrição vir junto do dado.
 *
 * `comprovado: false` **precisa** aparecer como texto, não só como cor.
 */
function descreverAbordagem(disparo) {
  const d = disparo || {}
  const prova = d.prova || {}
  const comprovado = prova.comprovado === true
  return {
    rotulo: prova.rotulo || '—',
    detalhe: prova.detalhe || '',
    comprovado,
    // O aviso existe para a tela nunca exibir uma declaração como se fosse entrega.
    aviso: comprovado ? '' : 'Sem confirmação de entrega.',
    tom: comprovado ? 'positivo' : 'neutro',
    manual: d.canal === 'manual_wa_me',
  }
}

/**
 * Rótulo do botão de abordagem manual, conforme o estado.
 * "Abrir WhatsApp" e "Marcar como enviado" são AÇÕES DIFERENTES, e a tela não pode juntá-las num
 * botão só: abrir não é enviar.
 */
function rotuloAcaoManual(ultimoDisparo) {
  const d = ultimoDisparo || {}
  if (d.canal === 'manual_wa_me' && d.status === 'aberto') {
    return { abrir: 'Abrir de novo', confirmar: 'Marcar como enviado', pendente: true }
  }
  return { abrir: 'Abrir WhatsApp', confirmar: 'Marcar como enviado', pendente: false }
}

/**
 * A mensagem cabe no que o WhatsApp aceita?
 * O limite existe no backend (`LIMITE_MENSAGEM`); aqui ele é só o contador da caixa de texto.
 */
const LIMITE_MENSAGEM = 1000
function contagemMensagem(texto) {
  const n = String(texto == null ? '' : texto).length
  return { usados: n, limite: LIMITE_MENSAGEM, excedeu: n > LIMITE_MENSAGEM, restantes: LIMITE_MENSAGEM - n }
}

module.exports = {
  QUALIFICACAO_ROTULO,
  ESCOPO_LEAD,
  LIMITE_MENSAGEM,
  seloQualificacao,
  podeAbordar,
  opcoesEscopo,
  rotuloEscopoEfetivo,
  donoDoLead,
  acoesDeResponsavel,
  descreverAbordagem,
  rotuloAcaoManual,
  contagemMensagem,
}
