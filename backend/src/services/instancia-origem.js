'use strict'

// Origem AUTORIZADA do vínculo empresa↔instância — regras PURAS.
//
// POR QUE ESTE MÓDULO EXISTE
// A regra de negócio é uma frase: *uma instância só tem vínculo com uma empresa quando foi
// CRIADA pelo Atendimento Views, dentro daquela empresa*. Instância criada direto no
// Evolution (API externa, painel da infraestrutura, script) não pertence a empresa alguma
// dentro do produto — e não existe tela que a regularize, porque um vínculo criado depois
// não prova nada sobre como a instância nasceu.
//
// Até aqui essa frase não tinha dono no código: `api-whatsapp.js` engolia o 403/409
// "already in use" do Evolution e gravava o vínculo assim mesmo (adoção), e os três pontos
// que inserem vínculo não registravam de onde ele veio. Este módulo é o vocabulário único
// dessa decisão; quem escreve no banco (`routes/api-whatsapp.js`,
// `routes/api-freelandoo.js`, `routes/freelandoo-provision.js`) importa daqui.
//
// SEM BANCO, HTTP, IA OU REDE.

// ─── Os dois valores possíveis de `origem_vinculo` (migration 061) ────────────
//
// `legado` NÃO é uma terceira origem autorizada: é a AUSÊNCIA de evidência, nomeada. São
// as linhas que já existiam quando a evidência passou a ser exigida. Elas continuam
// atendendo por carência deliberada (exigir prova delas pararia todos os números já
// conectados), e é justamente por isso que precisam ficar visíveis.
const ORIGEM_VINCULO = Object.freeze({
  ATENDIMENTO_VIEWS: 'atendimento_views',
  LEGADO: 'legado',
})

const ORIGENS_VINCULO = Object.freeze(Object.values(ORIGEM_VINCULO))

/**
 * Esta origem PROVA que o vínculo nasceu do fluxo autorizado?
 *
 * Só um valor prova. Qualquer outra coisa — inclusive `legado`, `null`, um valor novo
 * escrito errado ou um valor que uma versão futura invente — devolve false: um vocabulário
 * desconhecido não pode virar porta aberta.
 */
function origemComprovada(origem) {
  return origem === ORIGEM_VINCULO.ATENDIMENTO_VIEWS
}

/**
 * Esta origem é reconhecida por esta versão do produto?
 *
 * Separada de `origemComprovada` de propósito: uma é "posso confiar na procedência", a
 * outra é "sei o que este valor significa". Confundir as duas foi o que permitiu, no
 * modelo anterior, tratar ausência de informação como permissão.
 */
function origemConhecida(origem) {
  return ORIGENS_VINCULO.includes(origem)
}

/**
 * O vínculo é apenas tolerado (existia antes da regra) em vez de comprovado?
 * É o que a tela de instâncias marca para o operador auditar e recriar quando quiser.
 */
function vinculoEmCarencia(origem) {
  return origem === ORIGEM_VINCULO.LEGADO
}

/**
 * A evidência a gravar junto de um vínculo que está nascendo AGORA, pelo fluxo autorizado.
 *
 * Não recebe (e não pode receber) a origem como parâmetro: só existe um valor que código
 * novo tem o direito de escrever. Um parâmetro aqui seria o caminho para alguém passar
 * `legado` — ou pior, para reintroduzir a adoção com aparência de decisão informada.
 *
 * @param {string|null} usuarioId quem pediu a criação; null em provisionamento
 *   máquina-a-máquina (freelandoo-provision), que não tem usuário humano na requisição.
 */
function evidenciaDeOrigemAutorizada(usuarioId = null) {
  return {
    origem_vinculo: ORIGEM_VINCULO.ATENDIMENTO_VIEWS,
    origem_vinculo_usuario_id: usuarioId || null,
  }
}

module.exports = {
  ORIGEM_VINCULO,
  ORIGENS_VINCULO,
  origemComprovada,
  origemConhecida,
  vinculoEmCarencia,
  evidenciaDeOrigemAutorizada,
}
