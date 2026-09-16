'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const IG = require('../src/services/instagram-perfil')

const SRC = path.join(__dirname, '..', 'src')
const FONTE_MODULO = fs.readFileSync(path.join(SRC, 'services', 'instagram-perfil.js'), 'utf8')
const FONTE_ROTA = fs.readFileSync(path.join(SRC, 'routes', 'api-banco-leads.js'), 'utf8')
const FONTE_SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'extrair-instagram-handles.js'), 'utf8')
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'migrations', '080_instagram_perfil.sql'), 'utf8'
)

function arquivosJs(dir, acc = []) {
  for (const nome of fs.readdirSync(dir)) {
    const caminho = path.join(dir, nome)
    const st = fs.statSync(caminho)
    if (st.isDirectory()) arquivosJs(caminho, acc)
    else if (nome.endsWith('.js')) acc.push(caminho)
  }
  return acc
}

// ── ETAPA 1: o link que o dono declarou no Perfil da Empresa ──────────────────

test('extrai o handle do link que a coleta ja gravou, em qualquer um dos campos', () => {
  assert.equal(
    IG.handleDeLinkConhecido({ link_original: 'https://www.instagram.com/solarprime.go/' }).handle,
    'solarprime.go'
  )
  assert.equal(IG.handleDeLinkConhecido({ site: 'instagram.com/lojaX' }).handle, 'lojax')
  assert.equal(IG.handleDeLinkConhecido({ link_bio: 'https://instagram.com/minhaloja' }).handle, 'minhaloja')
  assert.equal(IG.handleDeLinkConhecido({ link_original: 'https://site.com.br' }), null)
  assert.equal(IG.handleDeLinkConhecido({}), null)
})

test('campo de LINK nao aceita handle solto: cadastro mal preenchido nao vira @ inventado', () => {
  // Estes campos guardam URL. "solarprime" em `site` e' nome de fantasia mal preenchido, nao um
  // perfil — confirma-lo daria ao lead um Instagram que ninguem nunca viu.
  assert.equal(IG.handleDeLinkConhecido({ site: 'solarprime' }), null)
  assert.equal(IG.handleDeLinkConhecido({ link_bio: '@minhaloja' }), null)
  assert.equal(IG.handleDeLinkConhecido({ link_bio: 'https://linktr.ee/loja' }), null)
  // Digitado por uma PESSOA, na revisao humana, o @ solto continua valendo.
  assert.equal(IG.normalizarHandle('@minhaloja'), 'minhaloja')
})

test('link do GMN nasce CONFIRMADO: quem o escreveu foi o dono do negocio', () => {
  const achado = IG.handleDeLinkConhecido({ link_original: 'https://instagram.com/loja' })
  assert.equal(achado.origem, IG.ORIGEM.GOOGLE_MEU_NEGOCIO)
  assert.equal(IG.vereditoDaOrigem(achado.origem), IG.CONFIANCA.CONFIRMADO)
})

test('nao confunde post/reel/explore com perfil', () => {
  assert.equal(IG.normalizarHandle('https://instagram.com/p/Cxyz123/'), null)
  assert.equal(IG.normalizarHandle('https://instagram.com/explore/tags/solar/'), null)
  assert.equal(IG.normalizarHandle('https://instagram.com/reel/abc/'), null)
})

// ── A regra que impede vinculo errado ─────────────────────────────────────────

test('nicho e cidade NAO contam como nome: "Energia Solar Goiania" nao distingue ninguem', () => {
  const tokens = IG.tokensDistintivos({
    nome: 'Energia Solar Goiania', nicho: 'energia solar', cidade: 'Goiania',
  })
  assert.deepEqual(tokens, [], 'sem token distintivo, o nome nao pode sustentar candidato')
})

test('o que sobra depois de tirar nicho, cidade e forma juridica e o que identifica', () => {
  assert.deepEqual(
    IG.tokensDistintivos({ nome: 'SolarPrime Energia Ltda', nicho: 'energia solar', cidade: 'Goiania' }),
    ['solarprime']
  )
})

test('dois concorrentes do mesmo nicho e cidade nao viram o mesmo negocio', () => {
  const lead = { nome: 'Energia Solar Goiania', nicho: 'energia solar', cidade: 'Goiania' }
  const aval = IG.avaliarCandidato(lead, {
    url: 'https://instagram.com/outrasolar',
    titulo: 'Outra Solar - Energia Solar Goiania',
    resumo: 'energia solar em goiania',
  })
  assert.equal(aval.aproveitavel, false, 'so nicho+cidade batendo nao pode virar nem candidato')
})

// ── ETAPA 2: o que a busca prova ──────────────────────────────────────────────

const LEAD = {
  nome: 'SolarPrime Energia',
  nicho: 'energia solar',
  cidade: 'Goiania',
  telefone: '5562998877665',
}

test('telefone batendo e sinal FORTE e confirma', () => {
  const aval = IG.avaliarCandidato(LEAD, {
    url: 'https://instagram.com/solarprime',
    titulo: 'SolarPrime Energia',
    resumo: 'Orcamentos pelo (62) 99887-7665',
  })
  assert.equal(aval.forte, true)
  assert.equal(IG.vereditoDaOrigem(aval.origem, { forte: aval.forte }), IG.CONFIANCA.CONFIRMADO)
})

test('site batendo tambem e sinal FORTE', () => {
  const lead = { ...LEAD, telefone: null, site: 'https://www.solarprime.com.br' }
  const aval = IG.avaliarCandidato(lead, {
    url: 'https://instagram.com/solarprime',
    titulo: 'SolarPrime',
    resumo: 'solarprime.com.br',
  })
  assert.equal(aval.forte, true)
})

test('so o NOME batendo vira candidato, nunca confirmado', () => {
  const aval = IG.avaliarCandidato(LEAD, {
    url: 'https://instagram.com/solarprime',
    titulo: 'SolarPrime Energia Goiania',
    resumo: 'energia solar',
  })
  assert.equal(aval.forte, false)
  assert.equal(aval.aproveitavel, true)
  assert.equal(
    IG.vereditoDaOrigem(aval.origem, { forte: aval.forte }),
    IG.CONFIANCA.CANDIDATO,
    'inferencia de maquina sem prova forte nao pode virar vinculo'
  )
})

test('resultado que nao bate nada e ruido de busca, nao candidato', () => {
  const aval = IG.avaliarCandidato(LEAD, {
    url: 'https://instagram.com/padariadoze', titulo: 'Padaria do Ze', resumo: 'paes quentes',
  })
  assert.equal(aval.aproveitavel, false)
})

test('escolhe o candidato com prova mais forte, nao o primeiro da lista', () => {
  const melhor = IG.escolherMelhorCandidato(LEAD, [
    { url: 'https://instagram.com/solarprime1', titulo: 'SolarPrime Energia', resumo: 'solar' },
    { url: 'https://instagram.com/solarprime2', titulo: 'SolarPrime Energia', resumo: '62998877665' },
  ])
  assert.equal(melhor.handle, 'solarprime2')
  assert.equal(melhor.forte, true)
})

test('busca sem nenhum resultado aproveitavel devolve null (vira nao_encontrado na rota)', () => {
  assert.equal(IG.escolherMelhorCandidato(LEAD, []), null)
  assert.equal(IG.escolherMelhorCandidato(LEAD, [{ url: 'https://instagram.com/xyz', titulo: 'Nada' }]), null)
})

// ── Os tres estados, e o que cada um afirma ───────────────────────────────────

test('candidato NAO conta como perfil confirmado', () => {
  assert.equal(IG.perfilConfirmado({ instagram_confianca: IG.CONFIANCA.CANDIDATO, instagram_candidato: 'loja' }), false)
  assert.equal(IG.perfilConfirmado({ instagram_confianca: IG.CONFIANCA.CONFIRMADO, instagram_handle: 'loja' }), true)
  assert.equal(IG.perfilConfirmado({}), false)
})

test('handle sozinho conta: essa coluna so recebe perfil confirmado (captacao social inclusive)', () => {
  assert.equal(IG.perfilConfirmado({ instagram_handle: 'loja' }), true)
})

test('o sistema NUNCA afirma que o perfil esta ativo — isso exige coleta que ainda nao existe', () => {
  assert.equal(IG.situacaoAtividade({ instagram_handle: 'loja' }), 'atividade_nao_verificada')
  assert.equal(IG.situacaoAtividade({}), 'sem_perfil')
})

// ── Guardas de regressao ──────────────────────────────────────────────────────

test('GUARDA: o modulo e PURO — sem banco, HTTP, IA ou rede', () => {
  for (const proibido of ['../db', 'axios', 'fetch(', 'pool.query', 'ai-provider']) {
    assert.ok(
      !FONTE_MODULO.includes(proibido),
      `services/instagram-perfil.js nao pode depender de "${proibido}" — ele julga, nao busca`
    )
  }
})

test('GUARDA: ninguem compara instagram_confianca com literal fora do modulo dono', () => {
  const rx = /instagram_confianca\s*!?===?\s*['"]/
  for (const arquivo of arquivosJs(SRC)) {
    if (arquivo.endsWith(path.join('services', 'instagram-perfil.js'))) continue
    assert.ok(
      !rx.test(fs.readFileSync(arquivo, 'utf8')),
      `${path.relative(SRC, arquivo)} compara instagram_confianca com literal — use IG.CONFIANCA.*, ` +
      'senao a regra de confianca passa a existir em dois lugares e eles divergem'
    )
  }
})

test('GUARDA: a busca por perfil NAO confirma por semelhanca de nome', () => {
  // O unico caminho que grava `confirmado` a partir da BUSCA e' via vereditoDaOrigem com
  // `forte`. Se a rota passar a marcar confirmado por conta propria, o vinculo errado volta.
  assert.ok(
    FONTE_ROTA.includes('IG.vereditoDaOrigem(IG.ORIGEM.BUSCA, { forte: melhor.forte })'),
    'a rota de busca precisa delegar o veredito ao modulo puro, com o sinal forte'
  )
})

test('GUARDA: o script em lote NAO afirma "nao_encontrado" — ele nao procura nada', () => {
  assert.ok(
    !FONTE_SCRIPT.includes(`'${IG.CONFIANCA.NAO_ENCONTRADO}'`),
    'o script so le o link que a ficha ja trouxe; gravar "nao encontrado" afirmaria uma busca ' +
    'que nunca aconteceu, e a tela diria ao operador que o lead nao tem Instagram sem ninguem ter olhado'
  )
})

test('GUARDA: o script NUNCA sobrescreve handle existente', () => {
  assert.ok(
    FONTE_SCRIPT.includes('p.instagram_handle IS NULL'),
    'manutencao em lote nao pode sobrepor confirmacao humana nem handle da captacao social'
  )
})

test('GUARDA: a migration exige handle para marcar confirmado', () => {
  assert.ok(
    /instagram_confianca IS DISTINCT FROM 'confirmado' OR instagram_handle IS NOT NULL/.test(MIGRATION),
    'sem essa CHECK, um lead poderia ficar "Instagram confirmado" sem dizer qual, e o sinal do ICP valeria sobre nada'
  )
})

test('GUARDA: a migration e ADITIVA — nao muta dado existente', () => {
  assert.ok(!/^\s*UPDATE\s/im.test(MIGRATION), 'a migration 080 nao pode atualizar linha existente')
  assert.ok(!/DEFAULT/i.test(MIGRATION.replace(/--.*$/gm, '')),
    'nenhuma coluna nova pode ter DEFAULT: ele autorizaria em silencio um INSERT futuro que esquecesse a coluna')
})

test('GUARDA: o ICP le o veredito, nao "tem bio"', () => {
  const icp = fs.readFileSync(path.join(SRC, 'services', 'lead-icp-score.js'), 'utf8')
  assert.ok(icp.includes("require('./instagram-perfil')"), 'o sinal precisa vir do modulo dono')
  const trecho = icp.slice(icp.indexOf('instagram_ativo:'), icp.indexOf('lacuna_digital_clara:'))
  assert.ok(
    !trecho.includes('lead.bio') && !trecho.includes('lead.link_bio'),
    'o criterio instagram_ativo nao pode voltar a ligar por presenca fraca'
  )
})
