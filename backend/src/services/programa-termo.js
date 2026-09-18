'use strict'
// Termo da Operacao Comercial — TEXTO VERSIONADO, no fonte.
//
// Por que no fonte e nao numa tabela editavel: um termo editavel por tela exige tela de edicao,
// revisao e publicacao — e nada disso existe na Etapa 1. Pior: um texto que muda sem versao faz
// o registro de aceite mentir (a pessoa aceitou outra coisa). Aqui, mudar o texto exige subir a
// VERSAO no mesmo diff, e a versao nova volta a exigir o aceite de quem ja tinha aceitado.
//
// ⚠️ RASCUNHO v1: o conteudo abaixo foi redigido para ser simples e honesto, nao para substituir
// revisao juridica. Ele e' para ser lido e ajustado pelo operador. Ao editar o texto, SUBA a
// versao — ha teste que falha se o hash gravado no fonte divergir do texto.

const { createHash } = require('node:crypto')

// A versao e' TEXTO, nao numero: ela entra em `app.programa_aceites.termo_versao` e no indice de
// idempotencia. Trocar o texto sem trocar a versao faz o sistema afirmar que a pessoa aceitou
// algo que ela nao leu.
const VERSAO = '1.0'

const TITULO = 'Termo da Operacao Comercial'

// Uma secao por assunto. A tela renderiza na ordem; o hash cobre o texto inteiro.
const SECOES = Object.freeze([
  {
    titulo: 'O que e a Operacao Comercial',
    paragrafos: [
      'A Operacao Comercial e o programa de vendas desta empresa dentro do Atendimento Views. ' +
      'Ao entrar, voce passa a receber leads ja aprovados para abordar, ligar, atender e agendar ' +
      'reunioes, usando as ferramentas do proprio sistema.',
      'Sua participacao e voluntaria e pode ser encerrada por voce ou pela empresa a qualquer ' +
      'momento. Este termo trata das regras do programa, nao de vinculo empregaticio.',
    ],
  },
  {
    titulo: 'Idade minima',
    paragrafos: [
      'A participacao na Operacao Comercial e restrita a pessoas com 18 anos ou mais. ' +
      'Ao aceitar, voce declara que tem 18 anos completos.',
    ],
  },
  {
    titulo: 'Como voce e remunerado',
    paragrafos: [
      'A comissao e calculada sobre o faturamento originado por voce e so e liberada quando o ' +
      'cliente efetivamente PAGA. Venda fechada e ainda nao paga nao gera comissao.',
      'O percentual aplicado a cada venda e o percentual vigente no momento em que a comissao e ' +
      'creditada, conforme o plano de comissao publicado pela empresa. Quando voce alcanca uma ' +
      'faixa maior, ela vale para as proximas vendas — o que ja foi creditado nao e recalculado.',
      'O plano de comissao vigente fica visivel para voce dentro do sistema, na tela de Comissao. ' +
      'Mudancas no plano sao publicadas como uma versao nova e valem dali para frente.',
    ],
  },
  {
    titulo: 'Como voce deve tratar os leads',
    paragrafos: [
      'Os contatos, telefones, conversas e dados de leads pertencem a empresa. Eles sao ' +
      'fornecidos para o seu trabalho dentro do sistema e nao podem ser copiados, exportados, ' +
      'repassados a terceiros ou usados em qualquer outra atividade, durante ou depois da sua ' +
      'participacao no programa.',
      'Na abordagem, voce se identifica pelo nome e pela empresa, nao promete o que o produto nao ' +
      'entrega e nao inventa preco, prazo ou condicao. Quem pede para nao ser contatado deixa de ' +
      'ser contatado.',
      'Nao e permitido disparar mensagens em massa por fora do sistema, usar listas compradas nem ' +
      'contornar os limites de envio configurados. Esses limites existem para proteger os numeros ' +
      'de WhatsApp da empresa, que sao o que mantem todo mundo trabalhando.',
    ],
  },
  {
    titulo: 'Registro do que acontece no sistema',
    paragrafos: [
      'Suas acoes no sistema ficam registradas: ligacoes realizadas, mensagens enviadas, ' +
      'follow-ups, reunioes agendadas e vendas registradas. Esse registro existe para calcular ' +
      'comissao, resolver duvidas e manter o historico do atendimento ao cliente.',
      'Seus dados de cadastro (nome, e-mail) sao tratados conforme a Lei Geral de Protecao de ' +
      'Dados. Voce pode pedir a empresa acesso aos seus dados ou a correcao deles.',
    ],
  },
  {
    titulo: 'Encerramento',
    paragrafos: [
      'Se a sua participacao terminar, o acesso ao sistema e encerrado e os leads voltam para a ' +
      'empresa. As comissoes ja creditadas por pagamentos ja recebidos continuam devidas.',
      'A empresa pode atualizar este termo. Quando isso acontecer, voce vera a versao nova e ' +
      'precisara aceita-la para continuar na Operacao Comercial.',
    ],
  },
])

// O texto canonico — e' ele que e' assinado pelo hash. Montado a partir das secoes para nao
// existir uma segunda copia do conteudo que pudesse divergir da que a tela mostra.
const TEXTO = SECOES
  .map((s) => `${s.titulo}\n${s.paragrafos.join('\n')}`)
  .join('\n\n')

/** SHA-256 do texto canonico. Prova QUAL texto foi aceito, nao so' quando. */
function hashDoTexto(texto) {
  return createHash('sha256').update(String(texto == null ? '' : texto), 'utf8').digest('hex')
}

const HASH = hashDoTexto(TEXTO)

/**
 * O termo vigente, pronto para a tela e para o registro.
 * Devolve copia congelada: ninguem reescreve o termo em memoria.
 */
function termoVigente() {
  return Object.freeze({
    versao: VERSAO,
    titulo: TITULO,
    secoes: SECOES,
    texto: TEXTO,
    hash: HASH,
  })
}

module.exports = { VERSAO, TITULO, SECOES, TEXTO, HASH, hashDoTexto, termoVigente }
