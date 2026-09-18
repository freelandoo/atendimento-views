'use strict'
// Operacao Comercial, Etapa 1 — APRESENTACAO PURA do aceite do termo.
//
// Regra de ouro, a mesma de `lib/capacidades.js` e `lib/site-rotulos.js`:
// **quem decide vive no BACKEND; aqui so' se traduz o veredito.**
// Este modulo NAO sabe quais papeis estao sujeitos ao programa, NAO compara versao de termo e
// NAO decide bloqueio. Ele recebe `programa_aceite` ja resolvido por `/api/auth/me` (que por sua
// vez veio de `services/programa-aceite.js`) e produz texto e estado de controle.
//
// ⚠️ O REDIRECIONAMENTO DA TELA E' CONVENIENCIA, NAO SEGURANCA. Quem barra e' a API: enquanto o
// aceite estiver pendente, `requireEmpresaAccess` responde 403 ACEITE_PENDENTE em toda rota com
// escopo de empresa. Se alguem apagar este arquivo, o sistema continua bloqueado — so' fica feio.
//
// Sem React, sem rede, sem DOM: testavel com `node --test` (padrao de `lib/paginacao.js`).

// ─── O veredito do backend ──────────────────────────────────────────────────────────────

/**
 * A pessoa precisa passar pela tela de aceite?
 *
 * Ausencia de veredito devolve FALSE de proposito: um payload antigo, um `/me` que falhou ou um
 * campo que ainda nao existe nao podem produzir um redirecionamento que ninguem pediu. Se o
 * bloqueio for real, a proxima chamada a API responde 403 e a tela reage — errar para o lado de
 * "nao redireciona" custa um erro visivel; errar para o outro tranca quem podia entrar.
 */
function precisaAceitar(programaAceite) {
  if (!programaAceite || typeof programaAceite !== 'object') return false
  return programaAceite.liberado === false
}

// Os dois motivos que a tela precisa distinguir. Primeiro acesso e termo atualizado sao
// situacoes diferentes para quem esta lendo: uma e' entrar, a outra e' reler o que mudou.
const EXPLICACAO = {
  aceite_ausente: {
    titulo: 'Bem-vindo à Operação Comercial',
    texto: 'Antes de começar, leia o termo abaixo até o fim. Ele explica como o programa funciona, como você é remunerado e como os leads da empresa devem ser tratados.',
  },
  aceite_desatualizado: {
    titulo: 'O termo da Operação Comercial foi atualizado',
    texto: 'O texto mudou desde a última vez que você aceitou. Leia a versão nova até o fim para continuar usando a operação.',
  },
}

const EXPLICACAO_PADRAO = {
  titulo: 'Termo da Operação Comercial',
  texto: 'Leia o termo abaixo até o fim para continuar.',
}

/** Titulo e texto de abertura da tela, a partir do motivo que o backend mandou. */
function situacaoDoTermo(motivo) {
  return EXPLICACAO[motivo] || EXPLICACAO_PADRAO
}

// ─── A rolagem ──────────────────────────────────────────────────────────────────────────

/**
 * A pessoa rolou o termo ate o fim?
 *
 * Mora aqui, e nao no componente, porque e' REGRA (o botao so' libera depois) e porque a
 * aritmetica tem um detalhe que quebra em silencio: alturas fracionadas por zoom do navegador ou
 * densidade de tela fazem `scrollTop + clientHeight` parar alguns pixels abaixo de
 * `scrollHeight`. Sem a folga, o botao NUNCA libera em alguns aparelhos — e o sintoma seria "o
 * sistema nao deixa eu aceitar".
 *
 * Texto que cabe inteiro na tela (sem barra de rolagem) conta como lido: exigir rolagem de algo
 * que nao rola tambem tranca o botao para sempre.
 */
function rolouAteOFim({ scrollTop, scrollHeight, clientHeight } = {}, folgaPx = 24) {
  const topo = Number(scrollTop)
  const total = Number(scrollHeight)
  const visivel = Number(clientHeight)
  if (!Number.isFinite(topo) || !Number.isFinite(total) || !Number.isFinite(visivel)) return false
  if (total <= visivel) return true
  return topo + visivel >= total - Math.max(0, Number(folgaPx) || 0)
}

// ─── O botao ────────────────────────────────────────────────────────────────────────────

// O que falta, em ordem de leitura da tela. A ordem importa: dizer "marque a maioridade" para
// quem ainda nem rolou o texto manda a pessoa para o lugar errado.
const PENDENCIAS = [
  ['rolouAteFim', 'Role o termo até o final para liberar o aceite.'],
  ['maioridade', 'Confirme que você tem 18 anos ou mais.'],
  ['leuRegras', 'Confirme que leu e aceita as regras do programa.'],
]

/**
 * Estado do botao de aceite.
 *
 * Os TRES sinais sao exigidos, e nenhum deles vale por outro: rolar nao e' consentir, e marcar
 * as caixas sem ler nao e' o que a tela pede. `motivo` existe para o botao desabilitado nunca
 * ficar mudo — controle inerte sem explicacao e' a forma mais comum de a pessoa achar que o
 * sistema quebrou.
 */
function estadoDoBotao({ rolouAteFim, maioridade, leuRegras, enviando } = {}) {
  if (enviando) return { habilitado: false, motivo: 'Registrando seu aceite…', rotulo: 'Registrando…' }
  const sinais = { rolouAteFim: !!rolouAteFim, maioridade: !!maioridade, leuRegras: !!leuRegras }
  const faltando = PENDENCIAS.find(([chave]) => !sinais[chave])
  if (faltando) return { habilitado: false, motivo: faltando[1], rotulo: 'Aceitar e entrar' }
  return { habilitado: true, motivo: '', rotulo: 'Aceitar e entrar' }
}

module.exports = {
  precisaAceitar,
  situacaoDoTermo,
  rolouAteOFim,
  estadoDoBotao,
}
