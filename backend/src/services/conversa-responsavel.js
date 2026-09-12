'use strict'
// Ownership da CONVERSA — módulo PURO. CRM em equipe, Etapa 7.
// Sem banco, sem HTTP, sem IA, sem rede.
// Ver docs/plano-execucao-crm-equipe.md §6 (Etapa 7).
//
// ─── O QUE DISTINGUE ESTE MÓDULO DO DE LEAD (Etapa 4) ────────────────────────────────────
// A forma é a mesma (dono na linha, claim atômico, histórico), mas UMA regra é oposta e é a mais
// importante daqui:
//
//   **Ninguém é impedido de RESPONDER uma conversa alheia.**
//
// Travar a resposta no meio de um atendimento causa dano maior que a duplicidade: o cliente fica
// sem resposta porque o sistema decidiu que a pessoa errada estava na tela. Ownership de conversa
// é para ORGANIZAR e dar visibilidade — não para bloquear atendimento. O que o ownership
// restringe é o RECORTE (o que cada um vê por padrão), não o ato de atender.
//
// A consequência aceita: dois atendentes podem responder a mesma conversa. Mitigação: a conversa
// mostra quem é o responsável, e o histórico mostra quem passou por ela.

// Reusa o vocabulário de ações do lead, de propósito: é a mesma pergunta de gestão sobre outra
// entidade. Dois vocabulários divergentes fariam o painel do admin ter duas colunas que
// significam a mesma coisa. Espelha a CHECK conversa_resp_hist_acao_chk (migration 074).
const { ACOES, ACOES_VALORES, acaoDaMudanca } = require('./lead-responsavel')

const MOTIVOS = Object.freeze({
  OK: 'ok',
  JA_TEM_RESPONSAVEL: 'ja_tem_responsavel',
  NAO_E_O_RESPONSAVEL: 'nao_e_o_responsavel',
  SEM_PERMISSAO: 'sem_permissao',
  MESMO_RESPONSAVEL: 'mesmo_responsavel',
  SEM_CONVERSA: 'sem_conversa',
})

/**
 * O atendente pode ASSUMIR esta conversa?
 * Só a que está sem dono. A corrida é resolvida pelo banco (`UPDATE ... WHERE responsavel_id IS
 * NULL RETURNING`); esta função habilita o botão e recusa cedo.
 */
function avaliarAssumir(conversa, usuarioId) {
  if (!conversa) return { permitido: false, motivo: MOTIVOS.SEM_CONVERSA }
  if (!usuarioId) return { permitido: false, motivo: MOTIVOS.SEM_PERMISSAO }
  const dono = conversa.responsavel_id || null
  if (!dono) return { permitido: true, motivo: MOTIVOS.OK }
  if (String(dono) === String(usuarioId)) return { permitido: false, motivo: MOTIVOS.MESMO_RESPONSAVEL }
  return { permitido: false, motivo: MOTIVOS.JA_TEM_RESPONSAVEL }
}

/**
 * Pode mudar o responsável desta conversa?
 * `podeTransferir` chega PRONTO (avaliado por `services/acesso-capacidades.js`) — a matriz de
 * permissão não vaza para cá. Devolver a PRÓPRIA conversa para a fila não é transferência.
 */
function avaliarTransferir(conversa, { usuarioId, podeTransferir, destinoId } = {}) {
  if (!conversa) return { permitido: false, motivo: MOTIVOS.SEM_CONVERSA }
  const dono = conversa.responsavel_id || null
  const destino = destinoId || null
  if (dono && destino && String(dono) === String(destino)) {
    return { permitido: false, motivo: MOTIVOS.MESMO_RESPONSAVEL }
  }
  if (!destino && dono && String(dono) === String(usuarioId)) {
    return { permitido: true, motivo: MOTIVOS.OK }
  }
  if (!podeTransferir) return { permitido: false, motivo: MOTIVOS.SEM_PERMISSAO }
  return { permitido: true, motivo: MOTIVOS.OK }
}

/**
 * Pode RESPONDER esta conversa?
 *
 * **Sempre que a pessoa alcança a conversa.** Existe como função — e não como ausência de função —
 * para que a regra fique escrita e testada: alguém, mais tarde, vai querer "travar a conversa do
 * colega", e é aqui que a conversa sobre isso tem de acontecer.
 *
 * Devolve `avisar` quando a conversa é de outra pessoa: a tela mostra "atendida por X" antes do
 * compositor. Avisar resolve o problema real (dois atendentes sem saber um do outro) sem criar o
 * problema pior (cliente sem resposta).
 */
function avaliarResponder(conversa, usuarioId) {
  const dono = (conversa || {}).responsavel_id || null
  const alheia = !!dono && String(dono) !== String(usuarioId)
  return { permitido: true, avisar: alheia, motivo: alheia ? MOTIVOS.JA_TEM_RESPONSAVEL : MOTIVOS.OK }
}

function rotuloMotivo(motivo) {
  switch (motivo) {
    case MOTIVOS.JA_TEM_RESPONSAVEL: return 'esta conversa ja tem responsavel'
    case MOTIVOS.NAO_E_O_RESPONSAVEL: return 'voce nao e o responsavel por esta conversa'
    case MOTIVOS.SEM_PERMISSAO: return 'voce nao pode mexer no responsavel desta conversa'
    case MOTIVOS.MESMO_RESPONSAVEL: return 'a conversa ja esta com este responsavel'
    case MOTIVOS.SEM_CONVERSA: return 'conversa nao encontrada'
    default: return ''
  }
}

// ─── Recorte de leitura ──────────────────────────────────────────────────────────────────

const ESCOPO = Object.freeze({
  MINHAS: 'minhas',
  NAO_ATRIBUIDAS: 'nao_atribuidas',
  TODAS: 'todas',
})

/**
 * O fragmento de WHERE do recorte por atendente.
 *
 * O recorte de quem NÃO pode ver todas não amplia mais a fila para "não atribuídas". O limite real
 * vem de `sqlAlcance`: a pessoa vê as conversas atribuídas a ela e as que chegaram pela própria
 * instância. Isso impede que um vendedor abra conversas soltas, compartilhadas ou de outro usuário.
 *
 * @returns {{sql: string, usaUsuario: boolean}}
 */
function sqlEscopo(escopo, { podeVerTodas = false, alias = 'c', placeholder = '$1' } = {}) {
  const a = alias ? `${alias}.` : ''
  const pedido = ESCOPO[String(escopo || '').toUpperCase().replace('NAO-ATRIBUIDAS', 'NAO_ATRIBUIDAS')]
    || (podeVerTodas ? ESCOPO.TODAS : null)

  if (pedido === ESCOPO.NAO_ATRIBUIDAS) return { sql: `${a}responsavel_id IS NULL`, usaUsuario: false }
  if (pedido === ESCOPO.MINHAS) return { sql: `${a}responsavel_id = ${placeholder}`, usaUsuario: true }
  if (pedido === ESCOPO.TODAS && podeVerTodas) return { sql: '', usaUsuario: false }
  // Pediu um recorte que não pode — ou não pediu nada: mantém só o limite de alcance.
  return { sql: '', usaUsuario: false }
}

/**
 * ─── O ALCANCE (o que a pessoa PODE ver), separado do ESCOPO (o filtro que a tela pediu) ────
 *
 * Por que dois fragmentos e não um: `sqlEscopo` traduz a ESCOLHA do operador (minhas / não
 * atribuídas / todas); este traduz o LIMITE de quem ele é. Um filtro de tela nunca pode ampliar
 * o limite, e o limite não pode virar filtro — foi misturar os dois que fez o recorte de lead
 * abrir vazio. A rota aplica os dois com `AND`.
 *
 * ⚠️ POR QUE A INSTÂNCIA, E NÃO SÓ O RESPONSÁVEL
 * `responsavel_id` exige claim manual e **nada o popula automaticamente** — na prática toda
 * conversa está sem dono, e "minhas + não atribuídas" devolve a empresa inteira. O sinal
 * PROVÁVEL é outro e já está gravado: o webhook resolve a instância que recebeu a mensagem
 * (`vendas.conversas.evolution_instance`), e a instância tem responsável desde a migration 075.
 * Conversa que chegou pelo número do vendedor É do vendedor, sem ninguém precisar clicar.
 *
 * As duas parcelas:
 *   1. atribuída a mim — decisão explícita de alguém vence qualquer inferência;
 *   2. chegou pela MINHA instância — o vínculo provado;
 *
 * O que ela EXCLUI, e é o ponto: conversa sem dono, conversa compartilhada da empresa e conversa
 * que chegou pelo número de outro vendedor.
 *
 * ⚠️ Isto **não** é resolução de instância de ENVIO. Aqui se pergunta "esta conversa é do
 * escopo desta pessoa?"; lá se pergunta "por onde sai a mensagem?", e `usuario_id` continua
 * proibido de participar daquela resposta (`services/instancia-envio.js`, guarda de regressão).
 *
 * @returns {{sql: string, usaUsuario: boolean}} `sql` vazio = sem limite (vê todas).
 */
function sqlAlcance({ podeVerTodas = false, alias = 'c', phUsuario = '$1', phEmpresa = '$2' } = {}) {
  if (podeVerTodas) return { sql: '', usaUsuario: false }
  const a = alias ? `${alias}.` : ''
  const daMinhaInstancia = `EXISTS (
        SELECT 1 FROM app.empresa_whatsapp_instances ewi_meu
         WHERE ewi_meu.empresa_id = ${phEmpresa}::uuid
           AND ewi_meu.evolution_instance = ${a}evolution_instance
           AND ewi_meu.usuario_id = ${phUsuario}::uuid)`
  return {
    sql: `(${a}responsavel_id = ${phUsuario}::uuid
       OR ${daMinhaInstancia})`,
    usaUsuario: true,
  }
}

/** Rótulo do alcance, para a tela DECLARAR o recorte em vez de encolher em silêncio. */
function rotuloAlcance(podeVerTodas) {
  return podeVerTodas
    ? 'todas as conversas da empresa'
    : 'as conversas atribuídas a você e as do seu número'
}

/** O recorte que a pessoa EFETIVAMENTE recebeu, para a tela ser honesta. */
function escopoEfetivo(escopo, podeVerTodas) {
  const chave = String(escopo || '').toUpperCase().replace('NAO-ATRIBUIDAS', 'NAO_ATRIBUIDAS')
  const pedido = ESCOPO[chave] || (podeVerTodas ? ESCOPO.TODAS : null)
  if (pedido === ESCOPO.NAO_ATRIBUIDAS) return ESCOPO.NAO_ATRIBUIDAS
  if (pedido === ESCOPO.MINHAS) return ESCOPO.MINHAS
  if (pedido === ESCOPO.TODAS && podeVerTodas) return ESCOPO.TODAS
  return 'proprias'
}

module.exports = {
  ACOES,
  ACOES_VALORES,
  MOTIVOS,
  ESCOPO,
  acaoDaMudanca,
  avaliarAssumir,
  avaliarTransferir,
  avaliarResponder,
  rotuloMotivo,
  sqlEscopo,
  sqlAlcance,
  rotuloAlcance,
  escopoEfetivo,
}
