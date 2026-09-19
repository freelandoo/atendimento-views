'use client'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import {
  aparenciaDoSlot, resumoDoDia, rotuloDoDia,
  type DiaDisponibilidade, type Slot,
} from '@/lib/agenda-slots'

// Grade de horários DISPONÍVEIS, para marcar no clique em vez de digitar data e hora.
//
// Esta tela SÓ DESENHA. Quem decide se um horário está livre é a API (`GET /agenda/disponibilidade`),
// que lê as DUAS agendas do produto: a da tela e a do bot do WhatsApp. Recalcular aqui criaria
// uma segunda régua que diverge em silêncio — mesmo contrato de `lib/site-rotulos.js`.
//
// O horário ocupado NÃO some da grade, de propósito: ele aparece apagado, com o motivo em texto.
// Um slot que desaparece faz o operador achar que a agenda quebrou; um slot que diz "Feriado"
// resolve a dúvida sem abrir mais nada.

type Props = {
  empresaId: string
  /** Primeiro dia da grade (AAAA-MM-DD). */
  dataInicial: string
  dias?: number
  duracaoMin?: number
  horaInicio?: string
  horaFim?: string
  /** Slot escolhido, no formato `AAAA-MM-DD HH:MM`. */
  valor?: string | null
  onEscolher: (data: string, horario: string) => void
  /** Sobe a cada carregamento para a tela poder reagir (ex.: fechar aviso). */
  onCarregou?: (dias: DiaDisponibilidade[]) => void
  /** Muda para forçar recarga (ex.: depois de criar um bloqueio). */
  chaveAtualizacao?: number
}

export default function SeletorSlots({
  empresaId, dataInicial, dias = 5, duracaoMin = 30,
  horaInicio = '08:00', horaFim = '18:00',
  valor = null, onEscolher, onCarregou, chaveAtualizacao = 0,
}: Props) {
  const [lista, setLista] = useState<DiaDisponibilidade[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const qs = new URLSearchParams({
        data: dataInicial,
        dias: String(dias),
        duracao: String(duracaoMin),
        hora_inicio: horaInicio,
        hora_fim: horaFim,
      })
      const r = await apiFetch<{ dias: DiaDisponibilidade[] }>(
        `/api/empresas/${empresaId}/agenda/disponibilidade?${qs}`
      )
      const novos: DiaDisponibilidade[] = r?.data?.dias || []
      setLista(novos)
      onCarregou?.(novos)
    } catch (e) {
      // A grade é a forma rápida de marcar, não a única: o formulário de data/hora continua ali.
      // Por isso o erro explica e oferece nova tentativa, em vez de bloquear a tela.
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os horários.')
      setLista([])
    } finally {
      setCarregando(false)
    }
    // `onCarregou` fica fora das dependências de propósito: ela costuma ser uma função inline da
    // página, que muda de identidade a cada render e faria a grade recarregar em laço.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, dataInicial, dias, duracaoMin, horaInicio, horaFim, chaveAtualizacao])

  useEffect(() => { void carregar() }, [carregar])

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  if (carregando) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-6 text-sm text-ink-2">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-brand" aria-hidden />
        Procurando horários livres…
      </div>
    )
  }

  if (erro) {
    return (
      <div className="rounded-lg border border-estado-danger/30 bg-estado-danger/5 px-4 py-3 text-sm">
        <p className="text-ink">{erro}</p>
        <button type="button" onClick={() => void carregar()} className="mt-2 font-medium text-brand hover:underline">
          Tentar de novo
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(lista.length || 1, 5)}, minmax(0, 1fr))` }}>
      {lista.map((dia) => {
        const rotulo = rotuloDoDia(dia.data, hoje)
        const resumo = resumoDoDia(dia)
        return (
          <div key={dia.data} className="min-w-0">
            <div className="mb-2 border-b border-line pb-1">
              <p className="truncate text-sm font-semibold text-ink">{rotulo.titulo}</p>
              <p className="text-xs text-ink-3">{rotulo.subtitulo} · {resumo.texto}</p>
            </div>
            <div className="flex flex-col gap-1">
              {dia.horarios.map((slot: Slot) => {
                const chave = `${dia.data} ${slot.horario}`
                const selecionado = valor === chave
                const ap = aparenciaDoSlot(slot, selecionado)
                return (
                  <button
                    key={slot.horario}
                    type="button"
                    disabled={!slot.livre && !selecionado}
                    onClick={() => onEscolher(dia.data, slot.horario)}
                    // O rótulo acessível carrega o motivo inteiro: quem usa leitor de tela precisa
                    // saber POR QUE o horário está indisponível, não só que ele está.
                    aria-label={ap.descricao}
                    title={ap.descricao}
                    className={`rounded-md border px-2 py-1.5 text-center text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${ap.classe}`}
                  >
                    <span className="font-medium">{slot.horario}</span>
                    {/* Cor nunca é o único sinal: o estado vem escrito embaixo do horário. */}
                    {!slot.livre && !selecionado && (
                      <span className="block text-[10px] leading-tight opacity-80">{ap.rotulo}</span>
                    )}
                  </button>
                )
              })}
              {!dia.horarios.length && <p className="px-2 py-3 text-xs text-ink-3">Sem horários.</p>}
            </div>
          </div>
        )
      })}
      {!lista.length && (
        <p className="col-span-full rounded-lg border border-line bg-surface-2 px-4 py-6 text-center text-sm text-ink-2">
          Nenhum dia para mostrar nesta janela.
        </p>
      )}
    </div>
  )
}
