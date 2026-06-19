'use strict'
/**
 * Agenda manualmente uma reunião para um lead (ex.: fechamento por operador que não
 * virou evento). Usa o criarEventoAgenda oficial — checa conflito, evita duplicata,
 * vincula lead/conversa e agenda o lembrete de 15 min.
 *
 * Uso:
 *   node scripts/agendar-reuniao.js <numero> <AAAA-MM-DD> <HH:MM> [email]
 * Ex.:
 *   node scripts/agendar-reuniao.js 5547933888204 2026-06-08 19:45 cliente@email.com
 */
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')

const envPath = path.join(ROOT, '.env')
if (fs.existsSync(envPath)) {
  for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = linha.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    process.env[key] = val
  }
}

const { pool } = require('../src/db')
const { criarEventoAgenda } = require('../src/agenda')
const { dataInicioReuniao, calcularFimReuniao } = require('../src/date-utils')

async function main() {
  const [numeroRaw, data, hora, email] = process.argv.slice(2)
  if (!numeroRaw || !/^\d{4}-\d{2}-\d{2}$/.test(String(data || '')) || !/^\d{1,2}:\d{2}$/.test(String(hora || ''))) {
    console.error('Uso: node scripts/agendar-reuniao.js <numero> <AAAA-MM-DD> <HH:MM> [email]')
    process.exit(1)
  }
  const digits = String(numeroRaw).replace(/\D/g, '')
  const jid = `${digits}@s.whatsapp.net`
  const [hh, mm] = hora.split(':').map(Number)

  const { rows } = await pool.query(
    `SELECT c.id AS conversa_id, lp.id AS lead_id, lp.negocio, lp.cidade
     FROM vendas.conversas c
     LEFT JOIN vendas.lead_profiles lp ON lp.numero = c.numero
     WHERE c.numero = $1 LIMIT 1`,
    [jid]
  )
  const ctx = rows[0] || {}
  const dataInicio = dataInicioReuniao(data, hh, mm)
  const dataFim = calcularFimReuniao(dataInicio, 15)
  const titulo = `Reunião de proposta — ${ctx.negocio || digits}${ctx.cidade ? ` (${ctx.cidade})` : ''}`

  const ev = await criarEventoAgenda({
    leadId: ctx.lead_id || null,
    conversaId: ctx.conversa_id || null,
    titulo: titulo.slice(0, 160),
    descricao: `Reunião agendada manualmente${email ? ` — e-mail: ${email}` : ''}.`,
    tipo: 'reuniao',
    prioridade: 'urgente',
    dataInicio,
    dataFim,
    metadata: {
      lead_numero: digits,
      negocio: ctx.negocio || null,
      cidade: ctx.cidade || null,
      email: email || null,
      criado_manualmente: true,
    },
    origem: 'operador',
  })

  if (!ev) {
    console.error('❌ Evento NÃO criado (horário em conflito/ocupado ou duplicado).')
    await pool.end()
    process.exit(2)
  }
  console.log(`✅ Reunião criada — id ${ev.id} | ${data} ${hora} | status ${ev.status} | ${titulo}`)
  await pool.end()
  process.exit(0)
}

main().catch((err) => {
  console.error('❌', err.message)
  process.exit(1)
})
