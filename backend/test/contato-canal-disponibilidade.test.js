'use strict'

// DISPONIBILIDADE DE CANAL POR CONTATO (migration 066) — modulo puro + guardas de regressao.
//
// O que estes testes protegem, em uma frase: quem diz que um contato NAO tem WhatsApp e uma
// PESSOA. Falha de envio, `exists:false` do Evolution, timeout do provider e instabilidade
// externa nao sao verificacao — e nenhum caminho automatico pode virar veredito sobre o
// contato. Varias guardas abaixo leem o FONTE de proposito: e a unica forma de a promessa
// quebrar o build quando alguem a violar.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const D = require('../src/services/contato-canal-disponibilidade')

const RAIZ = path.join(__dirname, '..')
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')

const MIGRATION = ler('sql/migrations/066_contato_canal_disponibilidade.sql')
const MIGRATION_EMAIL = ler('sql/migrations/067_follow_up_canal_email.sql')
const FONTE_SERVICO = ler('src/services/contato-canal-disponibilidade.js')
const FONTE_DB = ler('src/db/contato-canal-disponibilidade.js')

/**
 * Fonte sem comentarios. As guardas abaixo perguntam o que o CODIGO faz, e os dois modulos
 * explicam em prosa justamente os conceitos que o codigo nao pode ter (Evolution, falha de
 * envio, `tem_whatsapp`). Casar no arquivo cru transformaria a explicacao da regra em
 * violacao da regra — e o caminho para o teste passar seria apagar a explicacao.
 */
function semComentarios(fonte) {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const CODIGO_SERVICO = semComentarios(FONTE_SERVICO)
const CODIGO_DB = semComentarios(FONTE_DB)

// ─── Vocabulario fechado ──────────────────────────────────────────────────────

test('os dois vocabularios sao fechados — nada de canal ou origem inventados', () => {
  assert.deepEqual([...D.CANAIS_CURAVEIS], ['whatsapp', 'email'])
  assert.deepEqual([...D.ORIGEM_MARCACAO], ['operador'])
  assert.equal(D.CANAL_SEM_WHATSAPP, 'ligacao')
  assert.deepEqual([...D.ORDEM_CANAIS], ['whatsapp', 'email', 'ligacao'],
    'a ordem pedida pelo operador: sem WhatsApp -> e-mail confirmado -> ligacao')
})

test('`ligacao` NAO e canal curavel — o telefone e a identidade do contato', () => {
  // A resposta seria sempre "disponivel" e a linha nao diria nada. E tambem o que garante
  // que sempre existe um ultimo recurso para onde mandar o trabalho.
  assert.ok(!D.CANAIS_CURAVEIS.includes('ligacao'))
  assert.throws(() => D.validarMarcacao({ canal: 'ligacao', disponivel: false }), /canal invalido/)
})

test('o canal de e-mail so existe porque o EXECUTOR existe', () => {
  // Ate a migration 067 o valor era proibido (Decisao 4 de 2026-08-12): um canal que nenhuma
  // tela sabe executar produz itens que entram na fila e nunca saem dela. Se alguem remover o
  // executor, este teste e o lembrete de que o canal tem de sair junto.
  assert.equal(D.EMAIL_CANAL.suportado, true)
  assert.equal(D.EMAIL_CANAL.executor, 'central_follow_ups')
  assert.equal(D.EMAIL_CANAL.exige_endereco, true)
  const executor = ler('src/services/followup-email.js')
  assert.match(executor, /async function enviarEmailFollowUp/,
    'o canal email depende de um executor de verdade em services/followup-email.js')
  const rotas = ler('src/routes/api-follow-ups.js')
  assert.match(rotas, /itens\/:id\/email\/enviar/,
    'sem rota de envio, o item de e-mail entraria na fila e nunca sairia dela')
})

test('e-mail de cadastro e CANDIDATO, nunca confirmado sozinho', () => {
  assert.equal(D.EMAIL_CANDIDATO.confirma, false)
  // O destino do envio nao pode sair do cadastro: o executor resolve o destinatario pelo
  // veredito humano, e a unica funcao que le cadastro devolve "candidatos" para a TELA.
  const executor = semComentarios(ler('src/services/followup-email.js'))
  assert.doesNotMatch(executor, /prospects/,
    'o executor nao pode buscar endereco no cadastro: destino e sempre o e-mail confirmado')
  assert.match(executor, /emailConfirmadoDoContato/)
})

// ─── validarMarcacao: veredito nao nasce de coercao de tipo ───────────────────

test('validarMarcacao aceita os dois vereditos e sempre carimba origem operador', () => {
  assert.deepEqual(D.validarMarcacao({ canal: 'whatsapp', disponivel: false }),
    { canal: 'whatsapp', disponivel: false, motivo: null, endereco: null, origem: 'operador' })
  assert.deepEqual(D.validarMarcacao({ canal: 'whatsapp', disponivel: true }),
    { canal: 'whatsapp', disponivel: true, motivo: null, endereco: null, origem: 'operador' })
})

test('origem NAO e parametro — passar outra coisa nao muda o que e gravado', () => {
  // Aceita-la de fora abriria a porta para um job passar 'automatico' e um erro de transporte
  // virar veredito sobre o contato.
  const r = D.validarMarcacao({ canal: 'whatsapp', disponivel: false, origem: 'automatico' })
  assert.equal(r.origem, 'operador')
})

test('disponivel exige booleano DE VERDADE — string nao e veredito', () => {
  // `Boolean('false')` e `true`: por coercao o operador teria marcado o OPOSTO do que quis.
  for (const valor of ['false', 'true', 0, 1, '', null, undefined]) {
    assert.throws(() => D.validarMarcacao({ canal: 'whatsapp', disponivel: valor }),
      /booleano/, `disponivel=${JSON.stringify(valor)} deveria ser recusado`)
  }
})

test('canal fora da lista e recusado', () => {
  assert.throws(() => D.validarMarcacao({ canal: 'sms', disponivel: false }), /canal invalido/)
  assert.throws(() => D.validarMarcacao({ canal: 'ligacao', disponivel: false }), /canal invalido/)
  assert.throws(() => D.validarMarcacao({ canal: undefined, disponivel: false }), /canal invalido/)
})

// ─── E-mail: confirmar e dizer PARA ONDE ──────────────────────────────────────

test('confirmar e-mail EXIGE endereco — canal sem destino nao e canal', () => {
  assert.throws(() => D.validarMarcacao({ canal: 'email', disponivel: true }), /endereco de e-mail/)
  assert.throws(() => D.validarMarcacao({ canal: 'email', disponivel: true, endereco: '  ' }), /endereco de e-mail/)
  assert.equal(D.validarMarcacao({ canal: 'email', disponivel: true, endereco: ' Contato@Empresa.COM ' }).endereco,
    'contato@empresa.com', 'endereco e aparado e normalizado em minusculas')
})

test('negar o e-mail NAO exige endereco, e descarta o que vier', () => {
  // A negacao e sobre o contato receber e-mail, nao sobre um endereco especifico. Guardar um
  // destino junto de "nao tem e-mail" deixaria a linha se contradizendo.
  const r = D.validarMarcacao({ canal: 'email', disponivel: false, endereco: 'x@y.com' })
  assert.equal(r.endereco, null)
})

test('WhatsApp nao aceita endereco proprio — a identidade dele e o telefone', () => {
  assert.throws(() => D.validarMarcacao({ canal: 'whatsapp', disponivel: true, endereco: 'x@y.com' }),
    /nao tem endereco proprio/)
})

test('e-mail invalido e recusado antes de virar canal', () => {
  for (const invalido of ['sem-arroba', 'a@b', 'a b@c.com', 'a@b.com\nbcc: x@y.com', 'a@@b.com', `${'x'.repeat(250)}@b.com`]) {
    assert.throws(() => D.validarMarcacao({ canal: 'email', disponivel: true, endereco: invalido }),
      /e-mail|limite/, `deveria recusar ${JSON.stringify(invalido)}`)
  }
})

test('enderecoEmailConfirmado so devolve destino quando alguem confirmou', () => {
  assert.equal(D.enderecoEmailConfirmado(null), null)
  assert.equal(D.enderecoEmailConfirmado({ canal: 'email', disponivel: false, endereco: 'x@y.com' }), null)
  assert.equal(D.enderecoEmailConfirmado({ canal: 'email', disponivel: true, endereco: null }), null)
  assert.equal(D.enderecoEmailConfirmado({ canal: 'whatsapp', disponivel: true, endereco: 'x@y.com' }), null)
  assert.equal(D.enderecoEmailConfirmado({ canal: 'email', disponivel: true, endereco: 'X@Y.com' }), 'x@y.com')
})

test('motivo e opcional, aparado e limitado', () => {
  assert.equal(D.validarMarcacao({ canal: 'whatsapp', disponivel: false, motivo: '   ' }).motivo, null)
  assert.equal(D.validarMarcacao({ canal: 'whatsapp', disponivel: false, motivo: ' so fixo ' }).motivo, 'so fixo')
  assert.throws(
    () => D.validarMarcacao({ canal: 'whatsapp', disponivel: false, motivo: 'x'.repeat(D.LIMITE_MOTIVO + 1) }),
    /limite/)
})

// ─── Tri-estado: "nao sei" nao e "nao tem" ────────────────────────────────────

test('disponibilidadeInformada distingue ausente de false', () => {
  assert.equal(D.disponibilidadeInformada(undefined), undefined)
  assert.equal(D.disponibilidadeInformada(null), undefined)
  assert.equal(D.disponibilidadeInformada(false), false)
  assert.equal(D.disponibilidadeInformada(true), true)
  assert.throws(() => D.disponibilidadeInformada('false'), /booleano/)
  assert.throws(() => D.disponibilidadeInformada(0), /booleano/)
})

// ─── A regra de prioridade de canal ───────────────────────────────────────────

test('WhatsApp indisponivel SEM e-mail confirmado manda o item para ligacao', () => {
  assert.deepEqual(D.resolverCanalFollowUp('whatsapp', false),
    { canal: 'ligacao', trocou: true, motivo: 'contato marcado como sem WhatsApp' })
  assert.equal(D.resolverCanalFollowUp('whatsapp', false, null).canal, 'ligacao')
  assert.equal(D.resolverCanalFollowUp('whatsapp', false, '   ').canal, 'ligacao',
    'endereco vazio nao e e-mail confirmado')
})

test('WhatsApp indisponivel COM e-mail confirmado manda o item para o e-mail', () => {
  // E a prioridade pedida pelo operador: "sem WhatsApp -> e-mail confirmado -> ligacao".
  // Ate a migration 067 o primeiro salto nao tinha para onde ir e todo mundo caia em ligacao.
  const r = D.resolverCanalFollowUp('whatsapp', false, 'contato@empresa.com')
  assert.equal(r.canal, 'email')
  assert.equal(r.trocou, true)
  assert.match(r.motivo, /e-mail confirmado/)
})

test('item de e-mail so sai de la se uma pessoa disser que o contato nao recebe e-mail', () => {
  for (const veredito of [null, undefined, true]) {
    assert.deepEqual(D.resolverCanalFollowUp('email', false, 'x@y.com', veredito),
      { canal: 'email', trocou: false, motivo: null })
  }
  const r = D.resolverCanalFollowUp('email', false, null, false)
  assert.equal(r.canal, 'ligacao', 'sem e-mail e sem WhatsApp, sobra a ligacao — sempre ha telefone')
  assert.match(r.motivo, /sem e-mail/)
})

test('item de e-mail SEM endereco confirmado cai para ligacao — nao fica sem destino', () => {
  // O defeito que a Decisao 4 descreveu, alcancado pelo outro lado: `POST /itens` aceita
  // `canal` do corpo e `email` virou um valor valido. Um item de e-mail sem endereco entraria
  // na fila e nunca sairia dela, porque nao ha para onde enviar. A CHECK do banco protege a
  // tabela de disponibilidade, mas nao enxerga `follow_ups` — a regra tem de viver aqui.
  for (const veredito of [null, undefined]) {
    const r = D.resolverCanalFollowUp('email', null, null, veredito)
    assert.equal(r.canal, 'ligacao')
    assert.equal(r.trocou, true)
    assert.match(r.motivo, /sem endereco confirmado/)
  }
  // Endereco em branco ou malformado tambem nao e destino.
  assert.equal(D.resolverCanalFollowUp('email', null, '   ', null).canal, 'ligacao')
  assert.equal(D.resolverCanalFollowUp('email', null, 'nao-e-email', null).canal, 'ligacao')
})

test('item de e-mail NUNCA volta sozinho para o WhatsApp', () => {
  // Quem tirou o item do WhatsApp foi uma decisao registrada; desfaze-la aqui seria decidir
  // por quem decidiu (mesma regra do desfazer da migration 066).
  assert.equal(D.resolverCanalFollowUp('email', true, 'x@y.com', true).canal, 'email')
  assert.equal(D.resolverCanalFollowUp('email', true, 'x@y.com', false).canal, 'ligacao')
})

test('"ninguem verificou" (null) MANTEM o WhatsApp — comportamento historico', () => {
  // Tratar `null` como `false` mandaria todo contato novo para ligacao: o oposto do que o
  // sistema faz hoje, e uma decisao que ninguem tomou.
  assert.deepEqual(D.resolverCanalFollowUp('whatsapp', null),
    { canal: 'whatsapp', trocou: false, motivo: null })
  assert.deepEqual(D.resolverCanalFollowUp('whatsapp', undefined),
    { canal: 'whatsapp', trocou: false, motivo: null })
})

test('WhatsApp confirmado (true) mantem o WhatsApp — e o desfazer', () => {
  assert.deepEqual(D.resolverCanalFollowUp('whatsapp', true),
    { canal: 'whatsapp', trocou: false, motivo: null })
})

test('item que JA e de ligacao nao e tocado por marcacao de WhatsApp', () => {
  // A marcacao nao diz nada sobre um item de outro canal; trocar seria decidir por quem
  // escolheu. Vale inclusive quando o contato tem WhatsApp: desfazer nao devolve o trabalho
  // para o WhatsApp sozinho.
  for (const veredito of [false, true, null]) {
    assert.deepEqual(D.resolverCanalFollowUp('ligacao', veredito),
      { canal: 'ligacao', trocou: false, motivo: null })
  }
})

test('canalDescartadoPeloOperador so acende com marcacao EXPLICITA', () => {
  assert.equal(D.canalDescartadoPeloOperador('whatsapp', false), true)
  assert.equal(D.canalDescartadoPeloOperador('whatsapp', null), false)
  assert.equal(D.canalDescartadoPeloOperador('whatsapp', true), false)
  assert.equal(D.canalDescartadoPeloOperador('ligacao', false), false)
  assert.equal(D.canalDescartadoPeloOperador('email', false, false), true)
  assert.equal(D.canalDescartadoPeloOperador('email', false, null), false,
    'a marcacao de WhatsApp nao diz nada sobre o canal de e-mail')
})

// ─── Guardas de regressao: o automatico nao pode escrever aqui ────────────────

test('o modulo PURO nao conhece falha de envio, Evolution nem provider', () => {
  // Se este teste comecar a falhar, alguem esta tentando transformar ruido de transporte em
  // veredito sobre o contato — que e exatamente o defeito que a migration 066 existe para
  // impedir. A saida nao e afrouxar o teste: e nao escrever essa funcao.
  const proibidos = [
    /evolution/i, /exists\s*:/i, /\bsemWhatsapp\b/i, /marcarDisparoFalhou/i,
    /statusCode\s*===?\s*\d{3}\s*&&/i, /\btimeout\b/i, /\bprovider\b/i,
  ]
  for (const re of proibidos) {
    assert.doesNotMatch(CODIGO_SERVICO, re,
      `services/contato-canal-disponibilidade.js nao pode mencionar ${re}: disponibilidade e veredito HUMANO`)
  }
})

test('o modulo PURO nao faz I/O — sem banco, HTTP, IA ou rede', () => {
  for (const re of [/require\(['"]pg['"]\)/, /\bfetch\(/, /axios/, /require\(['"]\.\.\/db/, /generateAIResponse/]) {
    assert.doesNotMatch(CODIGO_SERVICO, re, 'o modulo de regra e PURO')
  }
})

test('a camada de dados so tem UMA escrita, e ela exige um usuario', () => {
  // Uma segunda escrita seria a porta por onde um worker marcaria disponibilidade.
  const escritas = CODIGO_DB.match(/INSERT INTO|UPDATE\s+app\.|DELETE FROM/g) || []
  assert.equal(escritas.length, 1, `esperava 1 escrita em db/contato-canal-disponibilidade.js, achei ${escritas.length}`)
  assert.match(CODIGO_DB, /marcarDisponibilidade\s*\([^)]*\{\s*usuarioId/,
    'marcarDisponibilidade precisa receber usuarioId: quem marca e uma pessoa autenticada')
})

test('toda query da camada de dados e escopada por empresa', () => {
  const queries = CODIGO_DB.match(/`[^`]*(?:SELECT|INSERT INTO)[^`]*`/g) || []
  assert.equal(queries.length, 3, `esperava as 3 queries do modulo, achei ${queries.length}`)
  for (const q of queries) {
    assert.match(q, /empresa_id/, 'query sem escopo de empresa vazaria dado entre tenants')
  }
})

// ─── Guardas de regressao sobre a MIGRATION ───────────────────────────────────

test('a CHECK de origem e fechada em operador e NAO tem DEFAULT', () => {
  // Sem DEFAULT pelo mesmo motivo de `empresa_whatsapp_instances.origem_vinculo` (061): um
  // DEFAULT autorizaria em silencio qualquer INSERT futuro que esquecesse a coluna.
  assert.match(MIGRATION, /contato_canal_disp_origem_chk\s+CHECK\s*\(origem\s+IN\s*\('operador'\)\)/)
  assert.doesNotMatch(MIGRATION, /origem\s+TEXT\s+NOT NULL\s+DEFAULT/i)
})

test('disponivel e NOT NULL — "nao sei" e a AUSENCIA de linha, nunca um NULL', () => {
  assert.match(MIGRATION, /disponivel\s+BOOLEAN\s+NOT NULL/)
  assert.doesNotMatch(MIGRATION, /disponivel\s+BOOLEAN\s*,/)
})

test('a migration e ADITIVA — nao muta, nao apaga e nao move dado existente', () => {
  for (const re of [/\bUPDATE\s+/i, /\bDELETE\s+FROM/i, /\bDROP\s+/i, /\bALTER\s+TABLE/i, /\bTRUNCATE/i, /\bINSERT\s+INTO/i]) {
    assert.doesNotMatch(MIGRATION, re, 'a 066 so cria tabela, indices e comentarios')
  }
})

test('a tabela NAO tem FK para vendas.conversas', () => {
  // `vendas.conversas.numero` e UNIQUE **GLOBAL** (init.sql:6): a FK exigiria que a conversa
  // ja existisse e ainda assim nao provaria mesma empresa. Mesma regra da migration 062.
  assert.doesNotMatch(MIGRATION, /REFERENCES\s+vendas\.conversas/i)
  assert.match(MIGRATION, /REFERENCES\s+app\.empresas\(id\)\s+ON DELETE CASCADE/)
})

test('a identidade do contato e (empresa, telefone, canal), com unicidade no BANCO', () => {
  assert.match(MIGRATION, /CREATE UNIQUE INDEX[\s\S]*contato_canal_disp_uk[\s\S]*\(empresa_id,\s*telefone_digitos,\s*canal\)/)
})

// ─── Guardas sobre a MIGRATION 067 (o canal de e-mail) ────────────────────────

test('a 067 alarga as duas CHECKs de canal — e so alarga', () => {
  assert.match(MIGRATION_EMAIL, /ADD CONSTRAINT follow_ups_canal_chk\s+CHECK \(canal IN \('whatsapp', 'ligacao', 'email'\)\)/)
  assert.match(MIGRATION_EMAIL, /ADD CONSTRAINT contato_canal_disp_canal_chk\s+CHECK \(canal IN \('whatsapp', 'email'\)\)/)
  // A garantia de "so humano" da 066 nao pode ser afrouxada de carona.
  assert.doesNotMatch(MIGRATION_EMAIL, /contato_canal_disp_origem_chk/,
    'a CHECK de origem nao e tocada: quem marca disponibilidade continua sendo uma pessoa')
})

test('a 067 nao muta, nao apaga e nao move dado existente', () => {
  for (const re of [/\bUPDATE\s+/i, /\bDELETE\s+FROM/i, /\bDROP\s+TABLE/i, /\bDROP\s+COLUMN/i, /\bTRUNCATE/i, /\bINSERT\s+INTO/i]) {
    assert.doesNotMatch(MIGRATION_EMAIL, re,
      'a 067 so alarga CHECKs, acrescenta coluna nullable e cria tabela nova')
  }
})

test('confirmar e-mail exige endereco TAMBEM no banco', () => {
  // A regra nao pode viver so na aplicacao: um INSERT futuro que esquecesse o endereco
  // criaria um item roteavel para lugar nenhum — exatamente o defeito que a Decisao 4 previu.
  assert.match(MIGRATION_EMAIL,
    /contato_canal_disp_email_confirmado_chk[\s\S]*?CHECK \(canal <> 'email' OR disponivel = false OR endereco IS NOT NULL\)/)
  assert.match(MIGRATION_EMAIL,
    /contato_canal_disp_endereco_chk[\s\S]*?CHECK \(canal = 'email' OR endereco IS NULL\)/)
})

test('`prospects.tem_whatsapp` NAO e lido nem escrito por este modulo', () => {
  // Aquela coluna e escrita AUTOMATICAMENTE por rodar-leads.js quando o Evolution responde
  // `exists:false`. Misturar as duas tornaria impossivel distinguir "o operador verificou" de
  // "o provider errou uma vez". Ela continua existindo e governando o Banco de Leads.
  for (const fonte of [CODIGO_SERVICO, CODIGO_DB]) {
    assert.doesNotMatch(fonte, /tem_whatsapp/,
      'inferencia tecnica e curadoria humana nao podem morar na mesma fonte')
  }
})
