// @ts-check
'use strict'

// Regra PURA: **este processo pode aplicar migrations no banco para onde aponta?**
// Sem banco, sem HTTP, sem IA, sem rede. Recebe a URL e o ambiente; devolve o veredito.
//
// ══ O DEFEITO QUE ELA IMPEDE (R5 do REFACTOR_REPORT) ══
// `initDB` aplica TODAS as migrations de `sql/migrations/` no boot, contra o que estiver em
// `DATABASE_URL`. E o `backend/.env` do diretorio de desenvolvimento aponta para o banco de
// PRODUCAO (`postgres.railway.internal`, medido em 2026-09-24) com `NODE_ENV=development`.
// Ou seja: um `npm start` na maquina de quem desenvolve era um `ALTER TABLE` em producao.
//
// Hoje aquele host especifico nao resolve fora da rede da Railway, entao o tiro falha por
// DNS — mas isso e' sorte de infraestrutura, nao proteção: a mesma credencial com o host
// PUBLICO (`*.proxy.rlwy.net`) resolve de qualquer lugar, e a Railway oferece esse host no
// proprio painel. A guarda existe para o acidente nao depender de qual host foi copiado.
//
// ══ A DIRECAO DA PERGUNTA IMPORTA ══
// Ela nao pergunta "isto parece producao?" — essa versao erra sempre que alguem usa um host
// novo. Pergunta **"este destino e' comprovadamente LOCAL?"**, e exige PROVA para o resto.
// Mesma disciplina de `instancia-envio.js`: heuristica sobre o que liberar foi o que produziu
// os defeitos deste repositorio.
//
// ══ POR QUE A PROVA ACEITA DUAS FORMAS ══
// Bloquear producao por engano seria MUITO pior que o defeito que a guarda corrige: o deploy
// nao subiria. Por isso basta UMA das duas provas, e elas sao independentes:
//   * `NODE_ENV=production` — como o proprio `index.js` ja identifica producao (JWT_SECRET,
//     cookie Secure, SSL do banco);
//   * qualquer variavel `RAILWAY_*` — presente dentro da plataforma (o `AGENTS.md` registra
//     `RAILWAY_PUBLIC_DOMAIN` como fallback real de `DASHBOARD_URL`).
// Para a guarda bloquear o deploy de verdade, as DUAS teriam de sumir ao mesmo tempo — o que
// significaria que aquilo nao e' mais a Railway.
//
// **Nao foi criada variavel de ambiente nova**, de proposito: a saida para aplicar migration
// em producao de fora e' declarar `NODE_ENV=production` naquela execucao, que e' como esta
// aplicacao ja diz "sou producao". Uma flag propria seria um segundo vocabulario para o mesmo
// fato.

/** Hosts que sao, comprovadamente, banco de desenvolvimento. Lista FECHADA. */
const HOSTS_LOCAIS = Object.freeze([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  // nome do servico no docker-compose deste repositorio
  'postgres',
])

/** Vocabulario dos motivos. Nunca carrega credencial — no maximo o HOST. */
const MOTIVOS = Object.freeze({
  LOCAL: 'destino_local',
  PROVA_PRODUCAO: 'producao_comprovada',
  SEM_URL: 'sem_database_url',
  REMOTO_SEM_PROVA: 'remoto_sem_prova_de_producao',
})

/**
 * Host da URL, ou `null` quando ela nao e' analisavel.
 * @param {string} [databaseUrl]
 */
function hostDoDestino(databaseUrl) {
  const bruta = String(databaseUrl || '').trim()
  if (!bruta) return null
  try {
    const u = new URL(bruta)
    // IPv6 so' e' URL valida entre colchetes, e o Node devolve o hostname COM eles
    // (`[::1]`). Normalizar aqui evita carregar as duas grafias na lista de hosts locais.
    const host = (u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
    return host || null
  } catch {
    return null
  }
}

/**
 * O destino e' comprovadamente local?
 * URL ilegivel devolve `false` — nao se supoe local o que nao deu para ler.
 * @param {string} [databaseUrl]
 */
function destinoLocal(databaseUrl) {
  const host = hostDoDestino(databaseUrl)
  return host != null && HOSTS_LOCAIS.includes(host)
}

/**
 * Ha prova de que este processo E' producao?
 * @param {Record<string, any>} [env]
 */
function provaDeProducao(env = {}) {
  if (String(env.NODE_ENV || '').trim() === 'production') return true
  return Object.keys(env).some((k) => k.startsWith('RAILWAY_'))
}

/**
 * Veredito. `{ permitido, motivo, host }` — `host` so' para a mensagem, nunca a credencial.
 * @param {{ databaseUrl?: string, env?: Record<string, any> }} [entrada]
 */
function avaliarDestino(entrada = {}) {
  const { databaseUrl, env = {} } = entrada
  const host = hostDoDestino(databaseUrl)

  // Sem DATABASE_URL, `db.js` cai no default local do proprio codigo. Bloquear aqui pararia
  // um ambiente que nunca chegou perto de producao.
  if (!String(databaseUrl || '').trim()) {
    return { permitido: true, motivo: MOTIVOS.SEM_URL, host: null }
  }
  if (destinoLocal(databaseUrl)) {
    return { permitido: true, motivo: MOTIVOS.LOCAL, host }
  }
  if (provaDeProducao(env)) {
    return { permitido: true, motivo: MOTIVOS.PROVA_PRODUCAO, host }
  }
  return { permitido: false, motivo: MOTIVOS.REMOTO_SEM_PROVA, host }
}

/**
 * A frase que o operador le quando o boot para. Ela precisa dizer TRES coisas: o que foi
 * bloqueado, por que, e como seguir de proposito.
 * @param {{ host?: string|null }} [veredito]
 */
function mensagemDeBloqueio(veredito = {}) {
  const host = veredito.host || '(host nao identificado)'
  return [
    `Migrations BLOQUEADAS: DATABASE_URL aponta para "${host}", que nao e' um banco local,`,
    `e este processo nao se identifica como producao (sem NODE_ENV=production e sem RAILWAY_*).`,
    ``,
    `O boot aplica TODAS as migrations no banco de destino. Rodar isto a partir de uma maquina`,
    `de desenvolvimento apontada para producao altera o schema de producao sem ninguem pedir.`,
    ``,
    `Se o destino e' um banco de desenvolvimento, corrija DATABASE_URL no backend/.env.`,
    `Se a intencao e' mesmo aplicar em producao, declare por inteiro: NODE_ENV=production.`,
  ].join('\n')
}

module.exports = {
  HOSTS_LOCAIS,
  MOTIVOS,
  hostDoDestino,
  destinoLocal,
  provaDeProducao,
  avaliarDestino,
  mensagemDeBloqueio,
}
