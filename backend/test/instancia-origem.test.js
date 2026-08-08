'use strict'

// Origem AUTORIZADA do vínculo empresa↔instância.
//
// O que estes testes protegem, em uma frase: um vínculo empresa↔instância só nasce do
// fluxo de criação dentro do Atendimento Views, e NÃO existe caminho — rota, botão,
// serviço ou tela — que adote uma instância que já existia no Evolution.
//
// A segunda metade do arquivo é GUARDA DE REGRESSÃO sobre o fonte. É deliberado: o defeito
// original não era uma regra errada, era um `catch` que engolia o "already in use" e seguia
// gravando. Um teste de unidade não pegaria isso de volta; a leitura do arquivo pega.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  ORIGEM_VINCULO,
  ORIGENS_VINCULO,
  origemComprovada,
  origemConhecida,
  vinculoEmCarencia,
  evidenciaDeOrigemAutorizada,
} = require('../src/services/instancia-origem')

const SRC = path.join(__dirname, '..', 'src')
const ler = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

// ─── O invariante central ─────────────────────────────────────────────────────

test('só `atendimento_views` comprova a origem — nem `legado`, nem valor novo, nem vazio', () => {
  assert.equal(origemComprovada(ORIGEM_VINCULO.ATENDIMENTO_VIEWS), true)
  assert.equal(origemComprovada(ORIGEM_VINCULO.LEGADO), false, 'legado é ausência de prova, não prova')
  for (const invalido of [null, undefined, '', 'evolution', 'externa', 'atendimento_views ', 'ATENDIMENTO_VIEWS']) {
    assert.equal(origemComprovada(invalido), false, `"${invalido}" não pode comprovar origem`)
  }
})

test('o vocabulário é fechado e não abre exceção para o desconhecido', () => {
  assert.deepEqual([...ORIGENS_VINCULO].sort(), ['atendimento_views', 'legado'])
  for (const valor of ORIGENS_VINCULO) assert.equal(origemConhecida(valor), true)
  for (const invalido of [null, undefined, 'evolution', 'adotada']) {
    assert.equal(origemConhecida(invalido), false)
  }
})

test('carência marca o legado sem promovê-lo a comprovado', () => {
  assert.equal(vinculoEmCarencia(ORIGEM_VINCULO.LEGADO), true)
  assert.equal(vinculoEmCarencia(ORIGEM_VINCULO.ATENDIMENTO_VIEWS), false)
  assert.equal(vinculoEmCarencia(null), false)
  // As duas perguntas são diferentes de propósito: "posso confiar na procedência?" e
  // "sei o que este valor significa?". Confundi-las foi o que fez ausência de informação
  // virar permissão.
  assert.notEqual(origemComprovada(ORIGEM_VINCULO.LEGADO), origemConhecida(ORIGEM_VINCULO.LEGADO))
})

// ─── A evidência gravada ──────────────────────────────────────────────────────

test('a evidência só sabe escrever um valor, e ele é o autorizado', () => {
  const e = evidenciaDeOrigemAutorizada('user-1')
  assert.equal(e.origem_vinculo, ORIGEM_VINCULO.ATENDIMENTO_VIEWS)
  assert.equal(e.origem_vinculo_usuario_id, 'user-1')
  // Provisionamento máquina-a-máquina não tem usuário humano — e isso não enfraquece a
  // origem, que continua sendo a autorizada.
  assert.equal(evidenciaDeOrigemAutorizada(null).origem_vinculo, ORIGEM_VINCULO.ATENDIMENTO_VIEWS)
  assert.equal(evidenciaDeOrigemAutorizada().origem_vinculo_usuario_id, null)
  assert.equal(evidenciaDeOrigemAutorizada('').origem_vinculo_usuario_id, null)
})

test('a evidência NÃO aceita a origem como parâmetro', () => {
  // Se aceitasse, existiria a chamada que grava `legado` — ou pior, que reabre a adoção
  // com aparência de decisão informada. Tentar forçar não muda nada.
  const forcado = evidenciaDeOrigemAutorizada('user-1', ORIGEM_VINCULO.LEGADO)
  assert.equal(forcado.origem_vinculo, ORIGEM_VINCULO.ATENDIMENTO_VIEWS)
})

// ─── Guardas de regressão sobre o fonte ───────────────────────────────────────

test('todo INSERT de vínculo grava a evidência de origem', () => {
  const arquivos = ['routes/api-whatsapp.js', 'routes/api-freelandoo.js', 'routes/freelandoo-provision.js']
  let encontrados = 0
  for (const rel of arquivos) {
    const fonte = ler(rel)
    const inserts = fonte.split('INSERT INTO app.empresa_whatsapp_instances').slice(1)
    for (const trecho of inserts) {
      encontrados += 1
      // O corpo do INSERT vai até o RETURNING; basta olhar a lista de colunas.
      const cabecalho = trecho.slice(0, trecho.indexOf('RETURNING'))
      assert.ok(
        cabecalho.includes('origem_vinculo'),
        `INSERT de vínculo em ${rel} sem evidência de origem — vínculo não pode nascer sem prova`
      )
    }
  }
  // Se alguém adicionar um quarto ponto de INSERT, este número muda e o teste chama
  // atenção para ele.
  assert.equal(encontrados, 3, 'mudou a quantidade de pontos que criam vínculo — revise a origem em todos')
})

test('a criação de instância NÃO adota instância que já existe no Evolution', () => {
  const fonte = ler('routes/api-whatsapp.js')
  // O defeito tinha nome: a variável `alreadyExists`, cujo único efeito era deixar o
  // fluxo seguir e gravar o vínculo de uma instância criada por fora.
  assert.ok(!/alreadyExists/.test(fonte), 'o caminho de adoção voltou ao arquivo')
  assert.ok(
    fonte.includes('INSTANCIA_JA_EXISTE_NO_EVOLUTION'),
    'nome já em uso no Evolution tem de RECUSAR a criação, com código próprio'
  )
})

test('não existe rota, serviço ou tela que resolva/adote instância bloqueada', () => {
  const rota = ler('routes/api-webhook-quarentena.js')
  // Assertivas sobre o CÓDIGO, não sobre a prosa: o cabeçalho do arquivo cita o
  // reprocessamento justamente para explicar por que ele não existe mais.
  assert.ok(!/router\.(post|put|patch|delete)/.test(rota), 'esta rota é somente leitura')
  assert.ok(!/resolverPendencia|buscarPendencia/.test(rota), 'a rota voltou a importar o fechamento de pendência')

  const dados = require('../src/db/webhook-quarentena')
  for (const proibida of ['resolverPendencia', 'buscarPendencia']) {
    assert.equal(dados[proibida], undefined, `${proibida} voltou ao acesso a dados`)
  }
  // O que ainda pode existir é registrar e ler — nunca fechar.
  assert.equal(typeof dados.registrarPendencia, 'function')
  assert.equal(typeof dados.listarPendencias, 'function')
})

test('a tela de instâncias bloqueadas não chama nenhuma escrita', (t) => {
  // O frontend é um deploy separado (Vercel, root `frontend/`) e não existe num checkout
  // só do backend. Ausente, o teste se declara pulado em vez de falhar por geografia.
  const componente = path.join(__dirname, '..', '..', 'frontend', 'components', 'PendenciasInstancia.tsx')
  if (!fs.existsSync(componente)) return t.skip('frontend não presente neste checkout')
  const fonte = fs.readFileSync(componente, 'utf8')
  assert.ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(fonte), 'a tela voltou a escrever')
  assert.ok(!/\breprocessar\(/i.test(fonte), 'a ação de reprocessar voltou à tela')
})
