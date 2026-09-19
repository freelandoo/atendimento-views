'use client'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import ModalAgenda from '@/components/ui/ModalAgenda'
import Botao from '@/components/ui/Botao'
import {
  OPCOES_RECORRENCIA, DIAS_SEMANA, MODELOS_BLOQUEIO, RECORRENCIA,
  impedimentoDoBloqueio, resumoDoBloqueio,
  type FormBloqueio, type TipoRecorrencia, type RespostaBloqueio,
} from '@/lib/agenda-slots'

// Bloquear horário na agenda: feriado, intervalo de almoço, reunião interna.
//
// O bloqueio é da EMPRESA INTEIRA — nasce sem responsável e por isso vale para todo mundo, e
// também para o bot do WhatsApp (o backend espelha o bloqueio na agenda que o bot lê, migration
// 090). Não há seletor de pessoa aqui de propósito: bloqueio por pessoa valeria só na tela e o
// WhatsApp continuaria oferecendo o horário — exatamente o descompasso que esta tela corrige.

export default function ModalBloqueio({
  aberto, empresaId, dataSugerida, onFechar, onCriado,
}: {
  aberto: boolean
  empresaId: string
  dataSugerida: string
  onFechar: () => void
  onCriado: (mensagem: string, alerta: string) => void
}) {
  const [form, setForm] = useState<FormBloqueio>({
    data: dataSugerida,
    hora_inicio: '12:00',
    hora_fim: '13:00',
    titulo: '',
    recorrencia: RECORRENCIA.NENHUMA,
    repetir_ate: '',
    dias_semana: [],
  })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const mudar = (campo: keyof FormBloqueio, v: unknown) => setForm((f) => ({ ...f, [campo]: v }))

  const aplicarModelo = (id: string) => {
    const m = MODELOS_BLOQUEIO.find((x) => x.id === id)
    if (!m) return
    // O modelo PREENCHE, não trava: todos os campos seguem editáveis.
    setForm((f) => ({
      ...f,
      titulo: m.titulo,
      hora_inicio: m.hora_inicio,
      hora_fim: m.hora_fim,
      recorrencia: m.recorrencia,
      dias_semana: m.recorrencia === RECORRENCIA.SEMANAL && !f.dias_semana?.length
        ? [new Date(`${f.data}T12:00:00.000Z`).getUTCDay()]
        : f.dias_semana,
    }))
  }

  const alternarDia = (d: number) => setForm((f) => {
    const atuais = f.dias_semana || []
    return { ...f, dias_semana: atuais.includes(d) ? atuais.filter((x) => x !== d) : [...atuais, d].sort() }
  })

  const impedimento = impedimentoDoBloqueio(form)

  const salvar = async () => {
    if (impedimento) return
    setSalvando(true)
    setErro('')
    try {
      const r = await apiFetch<RespostaBloqueio>(`/api/empresas/${empresaId}/agenda/bloqueios`, {
        method: 'POST',
        body: JSON.stringify({
          data: form.data,
          hora_inicio: form.hora_inicio,
          hora_fim: form.hora_fim,
          titulo: form.titulo || undefined,
          recorrencia: form.recorrencia,
          repetir_ate: form.recorrencia === RECORRENCIA.NENHUMA ? undefined : form.repetir_ate,
          dias_semana: form.recorrencia === RECORRENCIA.SEMANAL ? form.dias_semana : undefined,
        }),
      })
      const resumo = resumoDoBloqueio(r?.data)
      onCriado(resumo.texto, resumo.alerta)
      onFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível bloquear o horário.')
    } finally {
      setSalvando(false)
    }
  }

  const repete = form.recorrencia !== RECORRENCIA.NENHUMA
  const rotuloCampo = 'mb-1 block text-xs font-medium text-ink-2'
  const controle = 'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

  return (
    <ModalAgenda
      aberto={aberto}
      titulo="Bloquear horário"
      subtitulo="Vale para a empresa inteira — inclusive para o atendimento pelo WhatsApp."
      onFechar={onFechar}
      rodape={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-3">{impedimento || 'Ninguém poderá marcar reunião neste horário.'}</p>
          <div className="flex gap-2">
            <Botao variante="neutra" onClick={onFechar}>Cancelar</Botao>
            <Botao
              variante="primaria"
              onClick={salvar}
              carregando={salvando}
              disabled={Boolean(impedimento)}
              motivoDesabilitado={impedimento}
            >
              Bloquear
            </Botao>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <span className={rotuloCampo}>Atalhos</span>
          <div className="flex flex-wrap gap-2">
            {MODELOS_BLOQUEIO.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => aplicarModelo(m.id)}
                className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs text-ink-2 transition hover:border-brand hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {m.rotulo}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className={rotuloCampo}>Data</span>
            <input type="date" className={controle} value={form.data} onChange={(e) => mudar('data', e.target.value)} />
          </label>
          <label className="block">
            <span className={rotuloCampo}>Das</span>
            <input type="time" className={controle} value={form.hora_inicio} onChange={(e) => mudar('hora_inicio', e.target.value)} />
          </label>
          <label className="block">
            <span className={rotuloCampo}>Até</span>
            <input type="time" className={controle} value={form.hora_fim} onChange={(e) => mudar('hora_fim', e.target.value)} />
          </label>
        </div>

        <label className="block">
          <span className={rotuloCampo}>Motivo (aparece na agenda)</span>
          <input
            type="text"
            className={controle}
            placeholder="Ex.: Feriado, Almoço, Reunião interna"
            value={form.titulo || ''}
            onChange={(e) => mudar('titulo', e.target.value)}
          />
        </label>

        <div>
          <span className={rotuloCampo}>Repetir</span>
          <div className="flex flex-wrap gap-2">
            {OPCOES_RECORRENCIA.map((o) => (
              <button
                key={o.valor}
                type="button"
                aria-pressed={form.recorrencia === o.valor}
                onClick={() => mudar('recorrencia', o.valor as TipoRecorrencia)}
                className={`rounded-md border px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                  form.recorrencia === o.valor
                    ? 'border-brand bg-brand text-white'
                    : 'border-line bg-surface text-ink-2 hover:border-brand'
                }`}
              >
                {o.rotulo}
              </button>
            ))}
          </div>
        </div>

        {repete && (
          <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
            {form.recorrencia === RECORRENCIA.SEMANAL && (
              <div>
                <span className={rotuloCampo}>Em quais dias</span>
                <div className="flex gap-1">
                  {DIAS_SEMANA.map((d) => {
                    const on = (form.dias_semana || []).includes(d.valor)
                    return (
                      <button
                        key={d.valor}
                        type="button"
                        aria-pressed={on}
                        aria-label={d.nome}
                        title={d.nome}
                        onClick={() => alternarDia(d.valor)}
                        className={`h-9 w-9 rounded-md border text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                          on ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink-2 hover:border-brand'
                        }`}
                      >
                        {d.curto}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <label className="block">
              <span className={rotuloCampo}>Repetir até</span>
              <input
                type="date"
                className={controle}
                value={form.repetir_ate || ''}
                min={form.data}
                onChange={(e) => mudar('repetir_ate', e.target.value)}
              />
              {/* Repetição sem fim produziria bloqueio eterno, que só se desfaz dia a dia. */}
              <span className="mt-1 block text-xs text-ink-3">Obrigatório: o bloqueio precisa ter um fim.</span>
            </label>
          </div>
        )}

        {erro && (
          <p className="rounded-md border border-estado-danger/30 bg-estado-danger/5 px-3 py-2 text-sm text-ink">{erro}</p>
        )}
      </div>
    </ModalAgenda>
  )
}
