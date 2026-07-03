'use strict'
// Pontuação de CADASTRO do lead (completude da presença digital) + JSON de
// apresentação (dados unificados num prompt único pro bot gerar a saudação
// de análise e oferecer solução). Funções puras — computadas na leitura, sem
// coluna nova no banco.
//
// Places (0-100): site 20 · fotos 10 · endereço 10 · telefone 10 · e-mail 10 ·
//   horário de funcionamento 10 · links além do site 10 · tem avaliações 10 ·
//   nota > 4 10. Critério ausente = 0 (sem meio-termo).
// Instagram (0-60): 10 pontos por coluna — nicho, seguidores, telefone,
//   e-mail, links (bio/site), @username.

function temTexto(v) {
  return typeof v === 'string' ? v.trim().length > 0 : v != null && String(v).trim().length > 0
}

function rawJsonDe(row) {
  const rj = row && row.raw_json
  if (!rj) return {}
  if (typeof rj === 'string') { try { return JSON.parse(rj) } catch { return {} } }
  return typeof rj === 'object' ? rj : {}
}

// ─── Google Places ────────────────────────────────────────────────────────────

// Visão unificada dos dados do prospect (colunas do banco + raw_json do Places).
function dadosPlaces(row = {}) {
  const raw = rawJsonDe(row)
  const site = temTexto(row.site) ? String(row.site).trim() : (temTexto(raw.websiteUri) ? String(raw.websiteUri).trim() : '')
  const fotos = Array.isArray(raw.photos) ? raw.photos.length : 0
  const horario = !!(raw.regularOpeningHours || raw.currentOpeningHours)
  const mapsUrl = temTexto(row.maps_url) ? String(row.maps_url).trim() : (temTexto(raw.googleMapsUri) ? String(raw.googleMapsUri).trim() : '')
  const linksExtras = [mapsUrl].filter((l) => l && l !== site)
  return {
    nome: row.nome || '',
    nicho: row.nicho || '',
    cidade: row.cidade || '',
    endereco: temTexto(row.endereco) ? String(row.endereco).trim() : (temTexto(raw.formattedAddress) ? String(raw.formattedAddress).trim() : ''),
    telefone: temTexto(row.telefone) ? String(row.telefone).trim() : '',
    email: temTexto(row.email) ? String(row.email).trim() : '',
    site: site || (row.tem_site ? '(tem site, URL não capturada)' : ''),
    tem_site: !!(site || row.tem_site),
    maps_url: mapsUrl,
    links_extras: linksExtras,
    fotos,
    horario_funcionamento: horario,
    avaliacoes: row.avaliacoes == null ? null : Number(row.avaliacoes),
    nota: row.rating == null ? null : Number(row.rating),
  }
}

const CRITERIOS_PLACES = [
  { chave: 'site', label: 'Tem site', pontos: 20, ok: (d) => d.tem_site },
  { chave: 'fotos', label: 'Tem fotos', pontos: 10, ok: (d) => d.fotos > 0 },
  { chave: 'endereco', label: 'Tem endereço', pontos: 10, ok: (d) => temTexto(d.endereco) },
  { chave: 'telefone', label: 'Tem telefone', pontos: 10, ok: (d) => temTexto(d.telefone) },
  { chave: 'email', label: 'Tem e-mail', pontos: 10, ok: (d) => temTexto(d.email) },
  { chave: 'horario', label: 'Tem horário de funcionamento', pontos: 10, ok: (d) => d.horario_funcionamento },
  { chave: 'links_extras', label: 'Tem links além do site', pontos: 10, ok: (d) => d.links_extras.length > 0 },
  { chave: 'avaliacoes', label: 'Tem avaliações', pontos: 10, ok: (d) => (d.avaliacoes || 0) > 0 },
  { chave: 'nota_acima_4', label: 'Nota acima de 4', pontos: 10, ok: (d) => (d.nota || 0) > 4 },
]

function calcularScoreCadastroPlaces(row = {}) {
  const dados = dadosPlaces(row)
  const criterios = CRITERIOS_PLACES.map((c) => ({
    chave: c.chave,
    label: c.label,
    ok: !!c.ok(dados),
    pontos: c.ok(dados) ? c.pontos : 0,
    pontos_possiveis: c.pontos,
  }))
  const score = criterios.reduce((acc, c) => acc + c.pontos, 0)
  return { score, maximo: 100, criterios, dados }
}

function linhaDado(label, valor) {
  return `- ${label}: ${temTexto(valor) ? valor : '(não tem)'}`
}

function montarJsonApresentacaoPlaces(row = {}, cad = null) {
  const c = cad || calcularScoreCadastroPlaces(row)
  const d = c.dados || dadosPlaces(row)
  const fortes = c.criterios.filter((x) => x.ok).map((x) => x.label.toLowerCase())
  const lacunas = c.criterios.filter((x) => !x.ok).map((x) => `${x.label.toLowerCase()} (+${x.pontos_possiveis} se tivesse)`)
  const prompt = [
    'Você é um consultor comercial. Analise o cadastro desta empresa no Google e escreva uma saudação curta de prospecção pelo WhatsApp, personalizada e consultiva.',
    '',
    'DADOS DA EMPRESA (Google Places)',
    linhaDado('Nome', d.nome),
    linhaDado('Nicho', d.nicho) + (temTexto(d.cidade) ? ` · Cidade: ${d.cidade}` : ''),
    linhaDado('Endereço', d.endereco),
    linhaDado('Telefone', d.telefone),
    linhaDado('E-mail', d.email),
    linhaDado('Site', d.tem_site ? d.site : ''),
    `- Avaliações: ${d.avaliacoes ?? 0} · Nota: ${d.nota ?? '(sem nota)'}`,
    `- Horário de funcionamento cadastrado: ${d.horario_funcionamento ? 'sim' : 'não'}`,
    `- Fotos no perfil: ${d.fotos}`,
    linhaDado('Links além do site', d.links_extras.join(' · ')),
    '',
    `PONTUAÇÃO DE PRESENÇA DIGITAL: ${c.score}/100`,
    `- Pontos fortes: ${fortes.length ? fortes.join(', ') : '(nenhum)'}`,
    `- Lacunas: ${lacunas.length ? lacunas.join(', ') : '(nenhuma — cadastro completo)'}`,
    '',
    'TAREFA',
    '1. Cumprimente pelo nome da empresa.',
    '2. Mostre que analisou o negócio (cite 1 ponto forte real dos dados acima).',
    '3. Aponte 1-2 lacunas como oportunidade concreta de ganhar clientes.',
    '4. Ofereça uma solução para essas lacunas e termine com UMA pergunta.',
    'Regras: máximo 400 caracteres, tom humano de WhatsApp, não invente dados que não estão acima.',
  ].join('\n')
  return {
    fonte: 'google_places',
    empresa: {
      nome: d.nome,
      nicho: d.nicho,
      cidade: d.cidade,
      endereco: d.endereco || null,
      telefone: d.telefone || null,
      email: d.email || null,
      site: d.tem_site ? d.site : null,
      maps_url: d.maps_url || null,
      links_extras: d.links_extras,
      avaliacoes: d.avaliacoes,
      nota: d.nota,
      horario_funcionamento: d.horario_funcionamento,
      fotos: d.fotos,
    },
    pontuacao: {
      total: c.score,
      maximo: c.maximo,
      criterios: c.criterios.map(({ chave, label, ok, pontos, pontos_possiveis }) => ({ chave, label, ok, pontos, pontos_possiveis })),
    },
    lacunas: c.criterios.filter((x) => !x.ok).map((x) => x.chave),
    prompt,
  }
}

// ─── Instagram (captação social) ──────────────────────────────────────────────

const CRITERIOS_INSTAGRAM = [
  { chave: 'nicho', label: 'Tem nicho', pontos: 10, ok: (l) => temTexto(l.nicho) || temTexto(l.categoria_perfil) },
  { chave: 'seguidores', label: 'Tem seguidores', pontos: 10, ok: (l) => Number(l.seguidores || 0) > 0 },
  { chave: 'telefone', label: 'Tem telefone', pontos: 10, ok: (l) => temTexto(l.telefone) },
  { chave: 'email', label: 'Tem e-mail', pontos: 10, ok: (l) => temTexto(l.email) },
  { chave: 'links', label: 'Tem links (bio/site)', pontos: 10, ok: (l) => temTexto(l.link_bio) || temTexto(l.site) },
  { chave: 'username', label: 'Tem @username', pontos: 10, ok: (l) => temTexto(l.instagram_handle) },
]

function calcularScoreCadastroInstagram(lead = {}) {
  const criterios = CRITERIOS_INSTAGRAM.map((c) => ({
    chave: c.chave,
    label: c.label,
    ok: !!c.ok(lead),
    pontos: c.ok(lead) ? c.pontos : 0,
    pontos_possiveis: c.pontos,
  }))
  const score = criterios.reduce((acc, c) => acc + c.pontos, 0)
  return { score, maximo: 60, criterios }
}

function montarJsonApresentacaoInstagram(lead = {}, cad = null) {
  const c = cad || calcularScoreCadastroInstagram(lead)
  const fortes = c.criterios.filter((x) => x.ok).map((x) => x.label.toLowerCase())
  const lacunas = c.criterios.filter((x) => !x.ok).map((x) => `${x.label.toLowerCase()} (+${x.pontos_possiveis} se tivesse)`)
  const seguidores = Number(lead.seguidores || 0)
  const prompt = [
    'Você é um consultor comercial. Analise este perfil do Instagram e escreva uma saudação curta de prospecção pelo WhatsApp, personalizada e consultiva.',
    '',
    'DADOS DO PERFIL (Instagram)',
    linhaDado('Nome', lead.nome),
    linhaDado('@username', lead.instagram_handle ? `@${lead.instagram_handle}` : ''),
    linhaDado('Nicho', lead.nicho || lead.categoria_perfil) + (temTexto(lead.cidade) ? ` · Cidade: ${lead.cidade}` : ''),
    `- Seguidores: ${seguidores || '(não informado)'}`,
    linhaDado('Telefone', lead.telefone),
    linhaDado('E-mail', lead.email),
    linhaDado('Links', [lead.link_bio, lead.site].filter((x) => temTexto(x)).join(' · ')),
    linhaDado('Bio', lead.bio),
    '',
    `PONTUAÇÃO DO CADASTRO: ${c.score}/60`,
    `- Pontos fortes: ${fortes.length ? fortes.join(', ') : '(nenhum)'}`,
    `- Lacunas: ${lacunas.length ? lacunas.join(', ') : '(nenhuma — cadastro completo)'}`,
    '',
    'TAREFA',
    '1. Cumprimente pelo nome (ou @username).',
    '2. Mostre que analisou o perfil (cite 1 dado real acima — nicho, bio ou seguidores).',
    '3. Aponte 1-2 lacunas como oportunidade concreta de converter seguidores em clientes.',
    '4. Ofereça uma solução para essas lacunas e termine com UMA pergunta.',
    'Regras: máximo 400 caracteres, tom humano de WhatsApp, não invente dados que não estão acima.',
  ].join('\n')
  return {
    fonte: 'instagram',
    perfil: {
      nome: lead.nome || '',
      username: lead.instagram_handle || null,
      nicho: lead.nicho || lead.categoria_perfil || null,
      cidade: lead.cidade || null,
      seguidores: seguidores || null,
      telefone: lead.telefone || null,
      email: lead.email || null,
      link_bio: lead.link_bio || null,
      site: lead.site || null,
      bio: lead.bio || null,
    },
    pontuacao: {
      total: c.score,
      maximo: c.maximo,
      criterios: c.criterios.map(({ chave, label, ok, pontos, pontos_possiveis }) => ({ chave, label, ok, pontos, pontos_possiveis })),
    },
    lacunas: c.criterios.filter((x) => !x.ok).map((x) => x.chave),
    prompt,
  }
}

module.exports = {
  calcularScoreCadastroPlaces,
  montarJsonApresentacaoPlaces,
  calcularScoreCadastroInstagram,
  montarJsonApresentacaoInstagram,
}
