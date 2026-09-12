'use strict'
// Banco de Leads em equipe — apresentação pura (Etapas 3, 4 e 5).
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const L = require('./lead-operacao')

// ─── Etapa 3: qualificação ───────────────────────────────────────────────────────────────

test('o selo distingue os 4 estados, e `legado` NAO se passa por aprovado', () => {
  // `legado` e' a ausencia de prova, NOMEADA. Dizer isso na tela e' o que impede o operador de
  // achar que a carteira inteira foi triada.
  assert.equal(L.seloQualificacao('aprovado').rotulo, 'Aprovado')
  assert.equal(L.seloQualificacao('legado').rotulo, 'Sem triagem registrada')
  assert.notEqual(L.seloQualificacao('legado').rotulo, L.seloQualificacao('aprovado').rotulo)
  assert.match(L.seloQualificacao('legado').detalhe, /ningu[ée]m o avaliou/)
  assert.equal(L.seloQualificacao('pendente').tom, 'atencao')
  assert.equal(L.seloQualificacao('descartado').tom, 'negativo')
})

test('valor desconhecido aparece como ele mesmo, nunca some', () => {
  const s = L.seloQualificacao('valor_novo_do_servidor')
  assert.equal(s.rotulo, 'valor_novo_do_servidor')
  assert.equal(s.conhecido, false)
  assert.equal(L.seloQualificacao(null).rotulo, '—')
})

test('podeAbordar espelha o backend: so aprovado e legado, e AUSENTE nega', () => {
  assert.equal(L.podeAbordar({ qualificacao: 'aprovado' }), true)
  assert.equal(L.podeAbordar({ qualificacao: 'legado' }), true)
  assert.equal(L.podeAbordar({ qualificacao: 'pendente' }), false)
  assert.equal(L.podeAbordar({ qualificacao: 'descartado' }), false)
  // Um payload que esqueceu a coluna nao pode abrir a porta por omissao.
  assert.equal(L.podeAbordar({}), false)
  assert.equal(L.podeAbordar(null), false)
})

// ─── Etapa 4: responsável ────────────────────────────────────────────────────────────────

test('"livre" e estado de primeira classe, nao pendencia', () => {
  const livre = L.donoDoLead({ responsavel_id: null }, 'u1')
  assert.equal(livre.estado, 'livre')
  assert.equal(livre.rotulo, 'Livre')
  assert.equal(livre.meu, false)
})

test('donoDoLead distingue meu, de outro e livre', () => {
  assert.equal(L.donoDoLead({ responsavel_id: 'u1' }, 'u1').estado, 'meu')
  assert.equal(L.donoDoLead({ responsavel_id: 'u1' }, 'u1').rotulo, 'Você')
  const outro = L.donoDoLead({ responsavel_id: 'u2', responsavel_nome: 'Ana' }, 'u1')
  assert.equal(outro.estado, 'de_outro')
  assert.equal(outro.rotulo, 'Ana')
  // Sem o nome, ainda assim NAO se mostra o id.
  assert.equal(L.donoDoLead({ responsavel_id: 'u2' }, 'u1').rotulo, 'Outro vendedor')
})

test('as TRES acoes de responsavel sao distintas', () => {
  const livre = { qualificacao: 'aprovado', responsavel_id: null }
  const meu = { qualificacao: 'aprovado', responsavel_id: 'u1' }
  const deOutro = { qualificacao: 'aprovado', responsavel_id: 'u2' }

  // Assumir: qualquer vendedor, no que esta livre.
  assert.equal(L.acoesDeResponsavel(livre, { usuarioId: 'u1', podeAssumir: true }).assumir, true)
  assert.equal(L.acoesDeResponsavel(deOutro, { usuarioId: 'u1', podeAssumir: true }).assumir, false)
  // Devolver: so o proprio dono, e NAO exige capacidade de transferir.
  assert.equal(L.acoesDeResponsavel(meu, { usuarioId: 'u1', podeTransferir: false }).devolver, true)
  assert.equal(L.acoesDeResponsavel(deOutro, { usuarioId: 'u1', podeTransferir: false }).devolver, false)
  // Transferir: o de outra pessoa, so com capacidade.
  assert.equal(L.acoesDeResponsavel(deOutro, { usuarioId: 'u1', podeTransferir: true }).transferir, true)
  assert.equal(L.acoesDeResponsavel(deOutro, { usuarioId: 'u1', podeTransferir: false }).transferir, false)
})

test('a PORTA tambem barra o botao de assumir, com motivo', () => {
  // Botao sumido sem explicacao e' o que faz o operador achar que a tela quebrou.
  const naoTriado = { qualificacao: 'pendente', responsavel_id: null }
  const r = L.acoesDeResponsavel(naoTriado, { usuarioId: 'u1', podeAssumir: true })
  assert.equal(r.assumir, false)
  assert.match(r.motivoSemAssumir, /liberado para a opera/)

  const deOutro = { qualificacao: 'aprovado', responsavel_id: 'u2', responsavel_nome: 'Ana' }
  assert.match(L.acoesDeResponsavel(deOutro, { usuarioId: 'u1', podeAssumir: true }).motivoSemAssumir, /Ana/)

  const semPermissao = { qualificacao: 'aprovado', responsavel_id: null }
  assert.match(L.acoesDeResponsavel(semPermissao, { usuarioId: 'u1', podeAssumir: false }).motivoSemAssumir, /n[ãa]o pode assumir/)

  // Quando PODE, nao ha motivo — o campo fica vazio.
  assert.equal(L.acoesDeResponsavel(semPermissao, { usuarioId: 'u1', podeAssumir: true }).motivoSemAssumir, '')
})

test('quem nao ve todos NAO recebe a opcao "Todos"', () => {
  // Oferecer uma opcao que o servidor rebaixa faria a tela mostrar menos do que prometeu.
  // "Todos" e o PADRAO de quem pode (valor ''), e simplesmente nao existe para quem nao pode.
  // Duas opcoes com o mesmo significado ('' e 'todos') seriam ruido, entao a comparacao e pelo
  // rotulo — que e o que o operador le.
  const rotulos = (p) => L.opcoesEscopo(p).map((o) => o.rotulo)
  assert.ok(!rotulos(false).includes('Todos os leads'), 'a opcao que o servidor rebaixaria nao pode ser oferecida')
  assert.ok(rotulos(true).includes('Todos os leads'))
})

test('a PRIMEIRA opcao e sempre o padrao do servidor (valor vazio)', () => {
  // Sem ela, o <select> comecava em '' sem nenhuma opcao correspondente: exibia "Meus leads" e
  // enviava outra coisa, e nao havia como voltar ao padrao depois de filtrar.
  for (const pode of [false, true]) {
    assert.equal(L.opcoesEscopo(pode)[0].valor, '', `padrao ausente para podeVerTodos=${pode}`)
  }
  // E o rotulo do padrao diz a VERDADE sobre o que o servidor devolve em cada caso.
  assert.equal(L.opcoesEscopo(false)[0].rotulo, 'Leads disponíveis')
  assert.equal(L.opcoesEscopo(true)[0].rotulo, 'Todos os leads')
})

test('o escopo EFETIVO do servidor tem rotulo proprio', () => {
  // `meus_e_livres` e o que a API devolve quando rebaixa um pedido de "todos".
  assert.equal(L.rotuloEscopoEfetivo('meus_e_livres'), 'Leads disponíveis')
  assert.equal(L.rotuloEscopoEfetivo('meus'), 'Meus leads')
  assert.equal(L.rotuloEscopoEfetivo('desconhecido'), 'Todos os leads')
})

// ─── Etapa 5: abordagem manual (prova × declaração) ──────────────────────────────────────

test('a tela NAO recalcula a forca da prova — ela vem do backend', () => {
  const doProvider = L.descreverAbordagem({ canal: 'evolution', prova: { comprovado: true, rotulo: 'Entrega confirmada', detalhe: 'ok' } })
  assert.equal(doProvider.comprovado, true)
  assert.equal(doProvider.rotulo, 'Entrega confirmada')
  assert.equal(doProvider.aviso, '', 'entrega confirmada nao leva aviso')
})

test('declaracao do vendedor SEMPRE carrega o aviso em TEXTO', () => {
  // Um numero que soma entrega confirmada com declaracao nao se sustenta. O aviso e' a defesa.
  const declarada = L.descreverAbordagem({
    canal: 'manual_wa_me',
    confirmado_por: 'operador',
    prova: { comprovado: false, rotulo: 'Marcado como enviado', detalhe: 'Quem enviou marcou manualmente.' },
  })
  assert.equal(declarada.comprovado, false)
  assert.match(declarada.aviso, /Sem confirma/)
  assert.equal(declarada.manual, true)
})

test('abertura tambem nao e envio, e o aviso continua la', () => {
  const aberta = L.descreverAbordagem({
    canal: 'manual_wa_me', status: 'aberto',
    prova: { comprovado: false, rotulo: 'WhatsApp aberto', detalhe: '' },
  })
  assert.equal(aberta.comprovado, false)
  assert.ok(aberta.aviso.length > 0)
})

test('descreverAbordagem aguenta payload vazio', () => {
  const vazio = L.descreverAbordagem(null)
  assert.equal(vazio.rotulo, '—')
  assert.equal(vazio.comprovado, false)
  assert.equal(vazio.manual, false)
})

test('ABRIR e MARCAR COMO ENVIADO sao acoes diferentes, nunca um botao so', () => {
  // Abrir nao e' enviar. Juntar as duas num botao faria o clique afirmar o que nao aconteceu.
  const novo = L.rotuloAcaoManual(null)
  assert.equal(novo.abrir, 'Abrir WhatsApp')
  assert.equal(novo.pendente, false)
  assert.notEqual(novo.abrir, novo.confirmar)

  const jaAberto = L.rotuloAcaoManual({ canal: 'manual_wa_me', status: 'aberto' })
  assert.equal(jaAberto.pendente, true)
  assert.equal(jaAberto.abrir, 'Abrir de novo')
})

test('contagemMensagem acompanha o limite do backend', () => {
  assert.deepEqual(L.contagemMensagem('abc'), { usados: 3, limite: 1000, excedeu: false, restantes: 997 })
  assert.equal(L.contagemMensagem('x'.repeat(1001)).excedeu, true)
  assert.equal(L.contagemMensagem(null).usados, 0)
})

// ─── Guardas ─────────────────────────────────────────────────────────────────────────────

test('GUARDA: o front NAO reimplementa a regra do backend', () => {
  const src = fs.readFileSync(path.join(__dirname, 'lead-operacao.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ')
  // Nada de SQL, de fragmento do backend ou de matriz de capacidade aqui.
  for (const proibido of ['sqlAbordavel', 'avaliarAbordagem', 'MATRIZ', 'podeCapacidade', 'forcaDaProva']) {
    assert.ok(!src.includes(proibido), `lead-operacao.js nao pode conter '${proibido}'`)
  }
})

test('GUARDA: a lista de abordaveis do front bate com a do backend', () => {
  // Se as duas divergirem, a tela oferece um botao que responde 422 (ou esconde um que funciona).
  const backend = fs.readFileSync(
    path.join(__dirname, '..', '..', 'backend', 'src', 'services', 'lead-qualificacao.js'), 'utf8'
  )
  const m = backend.match(/const ABORDAVEIS = Object\.freeze\(\[([^\]]*)\]\)/)
  assert.ok(m, 'nao achei ABORDAVEIS no backend')
  const doBackend = m[1].split(',').map((x) => x.trim()).filter(Boolean)
    .map((x) => x.replace(/^QUALIFICACAO\./, '').toLowerCase())
  assert.deepEqual(doBackend.sort(), ['aprovado', 'legado'])
  // E o front concorda, valor a valor.
  for (const v of ['aprovado', 'legado']) assert.equal(L.podeAbordar({ qualificacao: v }), true, v)
  for (const v of ['pendente', 'descartado']) assert.equal(L.podeAbordar({ qualificacao: v }), false, v)
})

test('GUARDA: todo rotulo de qualificacao tem texto proprio', () => {
  for (const [slug, rotulo] of Object.entries(L.QUALIFICACAO_ROTULO)) {
    assert.ok(rotulo && rotulo.length > 3, `rotulo curto para ${slug}`)
    // Comparacao SENSIVEL a caixa: "Aprovado" e' a traducao legitima de `aprovado` (a palavra em
    // portugues e' a mesma). O que a guarda impede e' o slug CRU vazar para a tela.
    assert.notEqual(rotulo, slug, `${slug} nao foi traduzido`)
  }
})
