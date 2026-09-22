'use strict'
/**
 * QUADRO DO DIA — regras PURAS (sem banco, HTTP, IA ou rede).
 *
 * O que ele responde: "esta movimentação é válida?", "este card pode ser concluído com o que
 * existe?", "que dia operacional é hoje?". O que ele NÃO responde: de quem é o lead, se a
 * pessoa pode vê-lo, se ele está na carteira dela — isso é recorte, e o recorte já tem dono
 * (`services/lead-responsavel.js` + `sqlEscopo`, aplicados na rota).
 *
 * ⚠️ A REGRA QUE GOVERNA O MÓDULO: `etapa` é o ESTADO DO DIA, nunca o ciclo comercial.
 * Mover um card não escreve `prospects.status`, `qualificacao`, `responsavel_id` nem `icp_*`,
 * não assume lead de ninguém e não dispara abordagem. Planejar é organizar o próprio trabalho;
 * mudar o funil continua sendo ato explícito, pelos fluxos que já existem. Há guarda de
 * regressão que lê o fonte da camada de dados.
 */

// Ordem das colunas = ordem do trabalho. Espelha a CHECK `plano_dia_etapa_chk` (migration 095).
const ETAPAS = Object.freeze(['para_hoje', 'em_trabalho', 'aguardando_retorno', 'feito'])

// Como o lead entrou no dia. Espelha `plano_dia_origem_chk`.
const ORIGENS_ENTRADA = Object.freeze(['escolha_manual', 'sugestao_vencidos', 'sugestao_agenda'])

// Espelha `plano_dia_conclusao_tipo_chk`.
//   `atividade_registrada` = o SISTEMA viu o registro (ligação, reunião, abordagem, follow-up).
//   `autodeclarada`        = uma PESSOA disse que fez. Não é prova, e quem exibir é obrigado a
//                            dizer isso — mesma disciplina de `confirmado_por` na abordagem
//                            manual (migration 073).
const CONCLUSOES = Object.freeze(['atividade_registrada', 'autodeclarada'])

const ETAPA_PADRAO = 'para_hoje'
const TIMEZONE = () => process.env.APP_TIMEZONE || process.env.TZ || 'America/Sao_Paulo'

/** O dia operacional de agora, em APP_TIMEZONE. `en-CA` devolve YYYY-MM-DD. */
function diaOperacional(agora = new Date(), tz = TIMEZONE()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora)
}

/**
 * Normaliza o dia pedido. Formato inválido devolve `null` — e quem chama trata como "use hoje",
 * nunca como uma data qualquer: silenciosamente cair num dia errado faria o operador achar que
 * o planejamento sumiu.
 */
function diaValido(valor) {
  const v = String(valor || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  // Rejeita 2026-02-31 e afins: `Date` normaliza em silêncio, e um dia inexistente viraria uma
  // coluna de quadro que nunca casa com o que a pessoa planejou.
  return d.toISOString().slice(0, 10) === v ? v : null
}

function etapaValida(valor) {
  const v = String(valor || '').trim().toLowerCase()
  return ETAPAS.includes(v) ? v : null
}

function origemValida(valor) {
  const v = String(valor || '').trim().toLowerCase()
  return ORIGENS_ENTRADA.includes(v) ? v : null
}

/**
 * ⚠️ NÃO EXISTE MÁQUINA DE ESTADOS entre as colunas, e isso é decisão, não esquecimento.
 * Um quadro serve para reorganizar: proibir "voltar" de `aguardando_retorno` para `para_hoje`
 * transformaria um erro de arraste num estado do qual não se sai. A única transição com
 * consequência é a ENTRADA em `feito`, que exige evidência (ver `validarConclusao`).
 */
function validarMovimento({ etapaDestino, conclusao } = {}) {
  const destino = etapaValida(etapaDestino)
  if (!destino) {
    return { ok: false, code: 'ETAPA_INVALIDA', motivo: 'Coluna desconhecida.' }
  }
  if (destino !== 'feito') return { ok: true, etapa: destino, conclusao: null }
  const c = validarConclusao(conclusao)
  if (!c.ok) return c
  return { ok: true, etapa: destino, conclusao: c.conclusao }
}

/**
 * "Feito hoje" EXIGE evidência, com saída honesta (decisão do operador, 2026-09-22):
 *   • houve atividade registrada hoje para este lead ⇒ `atividade_registrada`;
 *   • não houve ⇒ aceita, mas só com NOTA, e fica marcado como `autodeclarada`.
 *
 * Sem a nota não há nada: um card em "Feito" sem evidência e sem explicação faria a coluna
 * significar apenas "alguém arrastou", e a contagem do dia deixaria de valer qualquer coisa.
 */
function validarConclusao({ temAtividadeRegistrada = false, nota = '' } = {}) {
  if (temAtividadeRegistrada) {
    return { ok: true, conclusao: { tipo: 'atividade_registrada', nota: String(nota || '').trim() || null } }
  }
  const texto = String(nota || '').trim()
  if (!texto) {
    return {
      ok: false,
      code: 'CONCLUSAO_SEM_EVIDENCIA',
      motivo: 'Não encontrei ligação, reunião ou abordagem registrada hoje para este lead. '
        + 'Registre a ação pela conversa, ou escreva o que foi feito para concluir assim mesmo.',
    }
  }
  return { ok: true, conclusao: { tipo: 'autodeclarada', nota: texto } }
}

/**
 * Como o card concluído deve ser LIDO. Autodeclaração nunca aparece como se fosse evidência —
 * quem exibir é obrigado a carregar a ressalva (mesma regra de `forcaDaProva` na abordagem
 * manual).
 */
function forcaDaConclusao(tipo) {
  if (tipo === 'atividade_registrada') {
    return { chave: 'atividade_registrada', rotulo: 'Ação registrada', prova: true }
  }
  if (tipo === 'autodeclarada') {
    return { chave: 'autodeclarada', rotulo: 'Autodeclarado', prova: false }
  }
  return { chave: 'sem_conclusao', rotulo: 'Em aberto', prova: false }
}

/**
 * O que o replanejamento alcança. **Só o que ficou em aberto**, e nunca automaticamente:
 * pendência não some à meia-noite e não se move sozinha para o dia seguinte — o operador vê a
 * prévia e manda. Card `feito` fica onde está: ele é o registro do dia em que aconteceu.
 */
function replanejavel(item) {
  const etapa = etapaValida(item && item.etapa)
  return !!etapa && etapa !== 'feito'
}

/** Posição nova no fim de uma coluna. Esparso para reordenar sem reescrever a coluna toda. */
function proximaOrdem(ordens = []) {
  const nums = ordens.map((n) => Number(n)).filter((n) => Number.isFinite(n))
  return nums.length ? Math.max(...nums) + 10 : 10
}

module.exports = {
  ETAPAS,
  ORIGENS_ENTRADA,
  CONCLUSOES,
  ETAPA_PADRAO,
  diaOperacional,
  diaValido,
  etapaValida,
  origemValida,
  validarMovimento,
  validarConclusao,
  forcaDaConclusao,
  replanejavel,
  proximaOrdem,
}
