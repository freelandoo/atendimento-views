'use strict'
// Responsável pela instância + contexto PADRÃO da empresa (CRM em equipe, Etapa 8).
//
// Esta suíte é quase inteira de GUARDAS, e o motivo é o que está em jogo: a instância decide por
// qual NÚMERO o produto fala com o cliente. Duas regras maduras deste repositório podem ser
// desfeitas por um `WHERE` distraído aqui:
//   1. instância de ENVIO se resolve por empresa + instância provada, NUNCA pelo usuário;
//   2. atendimento é 100% por instância — NUNCA há fallback para o contexto da empresa na resposta.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

const migracao = fonte(path.join('sql', 'migrations', '075_instancia_responsavel.sql'))
const rotaWhatsapp = fonte(path.join('src', 'routes', 'api-whatsapp.js'))

// ─── A migration ─────────────────────────────────────────────────────────────────────────

test('a 075 e ADITIVA e nao muta dado', () => {
  const sql = migracao.replace(/^--.*$/gm, ' ')
  assert.ok(!/\bUPDATE\s+app\./i.test(sql), 'nao pode mutar dado existente')
  assert.ok(!/\bDROP\s+COLUMN\b/i.test(sql))
  assert.ok(!/SET NOT NULL/i.test(sql), 'nada retroativo: usuario_id NULL e estado legitimo')
})

test('usuario_id NULL = instancia DA EMPRESA, e e o default', () => {
  const sql = migracao.replace(/^--.*$/gm, ' ')
  assert.ok(/ADD COLUMN IF NOT EXISTS usuario_id UUID/.test(sql))
  // Nenhum DEFAULT: a coluna nasce nula, que e' o comportamento historico (instancia da empresa).
  assert.ok(!/usuario_id UUID[^,]*DEFAULT/i.test(sql), 'usuario_id nao pode ter DEFAULT')
  // ON DELETE SET NULL: apagar a conta nao pode sumir com a instancia.
  assert.ok(/usuario_id UUID REFERENCES app\.usuarios\(id\) ON DELETE SET NULL/.test(sql))
})

test('contexto_padrao_id e ON DELETE SET NULL — apagar o padrao nao derruba a empresa', () => {
  const sql = migracao.replace(/^--.*$/gm, ' ')
  assert.ok(/contexto_padrao_id UUID REFERENCES app\.empresa_contextos\(id\) ON DELETE SET NULL/.test(sql))
})

// ─── GUARDA: a instância de ENVIO não olha o usuário ─────────────────────────────────────

test('GUARDA: a resolucao de instancia de ENVIO nao conhece usuario_id', () => {
  // Escolher numero por quem mandou o comando e' o defeito que a Fase 2 removeu e que o AGENTS.md
  // proibe nominalmente. A coluna da Etapa 8 serve a VISIBILIDADE, nao a escolha de remetente.
  const envio = semComentarios(fonte(path.join('src', 'services', 'instancia-envio.js')))
  for (const proibido of ['usuario_id', 'usuarioId', 'responsavel']) {
    assert.ok(!envio.includes(proibido),
      `services/instancia-envio.js nao pode conhecer '${proibido}' — a instancia de envio se resolve por empresa + instancia provada`)
  }
})

test('GUARDA: o resolvedor de envio em whatsapp.js nao filtra por usuario', () => {
  const src = semComentarios(fonte(path.join('src', 'whatsapp.js')))
  const i = src.indexOf('resolverInstanciaEnvio')
  assert.ok(i > 0, 'resolverInstanciaEnvio desapareceu')
  const bloco = src.slice(i, i + 4000)
  assert.ok(!/usuario_id/.test(bloco),
    'o resolvedor de envio nao pode filtrar instancia por usuario_id')
})

test('GUARDA: o webhook nao resolve empresa/instancia por usuario', () => {
  const src = semComentarios(fonte(path.join('src', 'middleware', 'tenant.js')))
  const i = src.indexOf('resolveEmpresaFromWebhook')
  const bloco = src.slice(i, src.indexOf('function requireRole'))
  assert.ok(!/usuario/i.test(bloco.replace(/req\.usuario/g, '')),
    'a resolucao do webhook nao pode envolver usuario — ela prova a origem pela instancia')
})

// ─── GUARDA: o contexto padrão é da CRIAÇÃO, não da RESPOSTA ─────────────────────────────

test('GUARDA: buscarContexto2Ativo NAO ganhou fallback para o contexto da empresa', () => {
  // A regra esta escrita no proprio codigo: "instancia informada mas SEM contexto linkado NAO
  // responde — nunca cai em contexto da empresa 'fora da instancia'". Um fallback aqui faria a
  // instancia nova de um vendedor responder com o conhecimento de OUTRO atendimento.
  const src = fonte(path.join('src', 'services', 'contexto-empresa.js'))
  assert.ok(!src.includes('contexto_padrao_id'),
    'contexto-empresa.js NAO pode ler contexto_padrao_id: o padrao e aplicado na CRIACAO, nunca na resposta')
  // E a regra continua declarada no fonte.
  assert.ok(/100% por inst/i.test(src), 'o comentario que declara a regra desapareceu')
  assert.ok(/return null/.test(src.slice(src.indexOf('buscarContexto2Ativo'), src.indexOf('buscarContexto2Ativo') + 2200)),
    'o caminho "instancia sem contexto" precisa continuar devolvendo null')
})

test('GUARDA: nenhum caminho de ATENDIMENTO le contexto_padrao_id', () => {
  // Varre src/**: so' rotas de instancia (criacao e configuracao) podem toca-lo.
  const permitidos = new Set([
    path.join('routes', 'api-whatsapp.js'),
  ])
  const ofensores = []
  const varrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { varrer(p); continue }
      if (!e.name.endsWith('.js')) continue
      const rel = path.relative(path.join(RAIZ, 'src'), p)
      if (permitidos.has(rel)) continue
      if (semComentarios(fs.readFileSync(p, 'utf8')).includes('contexto_padrao_id')) ofensores.push(rel)
    }
  }
  varrer(path.join(RAIZ, 'src'))
  assert.deepEqual(ofensores, [],
    'contexto_padrao_id so pode ser lido na criacao/configuracao da instancia')
})

test('o padrao e COPIADO, nao compartilhado', () => {
  // Compartilhar acoplaria duas instancias ao MESMO registro editavel: editar o contexto de um
  // vendedor mudaria, em silencio, como o numero do outro responde. `duplicarContexto` ja existia.
  // `lastIndexOf`: a primeira ocorrencia e a rota de LEITURA do padrao (GET /contexto-padrao);
  // a que interessa aqui e a da CRIACAO da instancia, que vem depois no arquivo.
  const i = rotaWhatsapp.lastIndexOf('contexto_padrao_id FROM app.empresas')
  assert.ok(i > 0, 'a leitura do padrao na criacao desapareceu')
  const bloco = rotaWhatsapp.slice(i, i + 1800)
  assert.ok(bloco.includes('duplicarContexto'), 'o padrao precisa ser DUPLICADO')
  // E sem padrao, o comportamento e' o de sempre: contexto novo e vazio.
  assert.ok(bloco.includes('criarContextoParaInstancia'),
    'sem padrao definido, a instancia precisa continuar nascendo com contexto proprio vazio')
})

// ─── Os três pontos de criação ───────────────────────────────────────────────────────────

test('os TRES pontos autorizados continuam gravando a evidencia de origem', () => {
  // A Etapa 8 acrescentou colunas ao INSERT; nao pode ter afrouxado a regra de origem autorizada.
  for (const rel of ['api-whatsapp.js', 'api-freelandoo.js', 'freelandoo-provision.js']) {
    const src = fonte(path.join('src', 'routes', rel))
    assert.ok(src.includes('evidenciaDeOrigemAutorizada'), `${rel} perdeu a evidencia de origem`)
    assert.ok(src.includes('origem_vinculo'), `${rel} perdeu origem_vinculo no INSERT`)
  }
})

test('o QR Code e o canal Freelandoo gravam o responsavel; o PROVISIONAMENTO nao', () => {
  // Provisionamento e' maquina-a-maquina: nao ha usuario humano, e inventar um afirmaria que
  // alguem assumiu um numero que ninguem assumiu. NULL = instancia da empresa, que e' a verdade.
  for (const rel of ['api-whatsapp.js', 'api-freelandoo.js']) {
    const src = fonte(path.join('src', 'routes', rel))
    const i = src.indexOf('INSERT INTO app.empresa_whatsapp_instances')
    const bloco = src.slice(i, i + 900)
    assert.ok(/usuario_id, criado_por/.test(bloco), `${rel} precisa gravar usuario_id e criado_por`)
  }
  // Sem comentario: o proprio trecho DOCUMENTA que deixa `usuario_id` nulo, citando a coluna.
  const prov = semComentarios(fonte(path.join('src', 'routes', 'freelandoo-provision.js')))
  const iProv = prov.indexOf('INSERT INTO app.empresa_whatsapp_instances')
  const blocoProv = prov.slice(iProv, iProv + 700)
  // `origem_vinculo_usuario_id` (evidencia de origem, migration 061) CONTEM `usuario_id` como
  // substring e e legitimo aqui. A guarda olha a coluna isolada.
  assert.ok(!/(^|[\s,(])usuario_id\b/.test(blocoProv),
    'o provisionamento maquina-a-maquina NAO pode inventar responsavel')
})

test('a criacao por QR Code continua RECUSANDO instancia que ja existe no Evolution', () => {
  // Regra de origem autorizada (migration 061): "se ja existe, segue mesmo assim" e PROIBIDO.
  assert.ok(rotaWhatsapp.includes('INSTANCIA_JA_EXISTE_NO_EVOLUTION'))
  assert.ok(!/alreadyExists\s*\)?\s*\{[\s\S]{0,200}INSERT INTO app\.empresa_whatsapp_instances/.test(rotaWhatsapp))
})

// ─── Recorte e rotas novas ───────────────────────────────────────────────────────────────

test('a listagem de instancias recorta por responsavel, incluindo as DA EMPRESA', () => {
  const i = rotaWhatsapp.indexOf("router.get('/', requireAuth")
  const bloco = rotaWhatsapp.slice(i, i + 2200)
  assert.ok(bloco.includes('INSTANCIA_GERENCIAR_EMPRESA'), 'quem ve todas e quem gerencia as da empresa')
  // A instancia compartilhada e' o numero principal do atendimento: esconde-la deixaria o vendedor
  // sem canal.
  assert.ok(/usuario_id IS NULL/.test(bloco),
    'o recorte precisa incluir as instancias DA EMPRESA (usuario_id NULL)')
  assert.ok(bloco.includes('pode_ver_todas'), 'o recorte efetivo precisa voltar no meta')
})

test('as rotas novas exigem capacidade, na ordem certa', () => {
  for (const alvo of ['/contexto-padrao', '/:instanceId/responsavel']) {
    const linha = rotaWhatsapp.split('\n').find((l) => l.includes(`'${alvo}'`) && /router\.(put|post)/.test(l))
    assert.ok(linha, `nao achei a rota ${alvo}`)
    assert.ok(linha.includes('requireCapacidade'), `${alvo} ficou sem capacidade`)
    const iEmpresa = linha.indexOf('requireEmpresaAccess')
    const iCap = linha.indexOf('requireCapacidade')
    assert.ok(iEmpresa > 0 && iEmpresa < iCap, `${alvo}: ordem errada dos middlewares`)
  }
})

test('definir o contexto padrao exige que ele seja da PROPRIA empresa', () => {
  const i = rotaWhatsapp.indexOf("router.put('/contexto-padrao'")
  const bloco = rotaWhatsapp.slice(i, i + 1600)
  assert.ok(/empresa_contextos WHERE id = \$1::uuid AND empresa_id = \$2/.test(bloco),
    'um contexto de outra empresa como padrao faria a instancia nova nascer com conhecimento de outro negocio')
  assert.ok(bloco.includes('CONTEXTO_NAO_ENCONTRADO'))
})

test('trocar o responsavel valida o destino contra usuarios_empresas da propria empresa', () => {
  const i = rotaWhatsapp.indexOf("router.put('/:instanceId/responsavel'")
  const bloco = rotaWhatsapp.slice(i, i + 1800)
  assert.ok(/usuarios_empresas ue[\s\S]{0,220}ue\.empresa_id = \$1/.test(bloco))
  assert.ok(bloco.includes('RESPONSAVEL_INVALIDO'))
  assert.ok(bloco.includes('instancia_responsavel_alterado'), 'a troca precisa ser auditada')
})
