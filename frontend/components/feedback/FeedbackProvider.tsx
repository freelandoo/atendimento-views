'use client'
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import NeonProgress from '@/components/ui/NeonProgress'

// Toolkit de feedback de operações (início → fim) para o dashboard:
//  - barra de carregamento no topo (mesma NeonProgress do login) enquanto há tarefa ativa;
//  - toast no canto com ícone de check (sucesso) ou erro, some sozinho;
//  - modal central com check animado + OK para ações "pesadas" (coleta, busca, ingestão).
// Uso: const fb = useFeedback(); fb.runTask(() => apiFetch(...), { pesada, sucesso, detalhe }).

type Tone = 'success' | 'error' | 'info'
type Toast = { id: number; msg: string; tone: Tone }
type Modal = { titulo: string; detalhe?: string }

type Resolver<T> = string | ((r: T) => string)

type RunOpts<T> = {
  /** Ação pesada → mostra modal com OK em vez de toast. */
  pesada?: boolean
  /** Texto de sucesso (string ou função do resultado). null = sem feedback de sucesso. */
  sucesso?: Resolver<T> | null
  /** Linha secundária (só no modal). */
  detalhe?: Resolver<T>
  /** Texto de erro padrão (a mensagem do Error tem prioridade). */
  erro?: string
}

type FeedbackCtx = {
  /** Toast avulso. */
  toast: (msg: string, tone?: Tone) => void
  /** Modal de sucesso avulso. */
  sucessoModal: (titulo: string, detalhe?: string) => void
  /** Executa uma promise mostrando barra + feedback de sucesso/erro. */
  runTask: <T>(fn: () => Promise<T>, opts?: RunOpts<T>) => Promise<T>
  /** Há alguma tarefa em andamento (para spinners locais, se quiser). */
  ocupado: boolean
}

const Ctx = createContext<FeedbackCtx | null>(null)

export function useFeedback(): FeedbackCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useFeedback precisa estar dentro de <FeedbackProvider>.')
  return ctx
}

function resolver<T>(r: Resolver<T> | null | undefined, valor: T, fallback: string): string {
  if (r == null) return fallback
  return typeof r === 'function' ? (r as (v: T) => string)(valor) : r
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [ativos, setAtivos] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [modal, setModal] = useState<Modal | null>(null)
  const seq = useRef(0)

  const removeToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((msg: string, tone: Tone = 'success') => {
    const id = ++seq.current
    setToasts((ts) => [...ts, { id, msg, tone }])
    setTimeout(() => removeToast(id), tone === 'error' ? 5000 : 3000)
  }, [removeToast])

  const sucessoModal = useCallback((titulo: string, detalhe?: string) => {
    setModal({ titulo, detalhe })
  }, [])

  const runTask = useCallback(async function <T>(fn: () => Promise<T>, opts: RunOpts<T> = {}): Promise<T> {
    setAtivos((n) => n + 1)
    try {
      const r = await fn()
      if (opts.sucesso !== null) {
        const txt = resolver(opts.sucesso, r, 'Concluído')
        if (opts.pesada) sucessoModal(txt, opts.detalhe != null ? resolver(opts.detalhe, r, '') : undefined)
        else toast(txt, 'success')
      }
      return r
    } catch (e) {
      toast(e instanceof Error ? e.message : (opts.erro || 'Algo deu errado.'), 'error')
      throw e
    } finally {
      setAtivos((n) => Math.max(0, n - 1))
    }
  }, [toast, sucessoModal])

  return (
    <Ctx.Provider value={{ toast, sucessoModal, runTask, ocupado: ativos > 0 }}>
      {/* Barra de carregamento no topo (igual à do login) — fixa, sobre o conteúdo */}
      {ativos > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[120]">
          <NeonProgress className="rounded-none" />
        </div>
      )}

      {children}

      {/* Toasts (canto inferior direito) */}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[130] flex w-80 max-w-[calc(100vw-2.5rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            onClick={() => removeToast(t.id)}
            className={`feedback-pop pointer-events-auto flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-lg backdrop-blur ${
              t.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : t.tone === 'info'
                ? 'border-slate-200 bg-white text-slate-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            <span className="mt-0.5 shrink-0">
              {t.tone === 'error' ? <IconeX /> : t.tone === 'info' ? <IconeInfo /> : <IconeCheck />}
            </span>
            <span className="min-w-0 break-words">{t.msg}</span>
          </div>
        ))}
      </div>

      {/* Modal de sucesso (ações pesadas) */}
      {modal && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={() => setModal(null)}
        >
          <div
            className="feedback-pop w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <span className="check-pop text-emerald-600"><IconeCheck size={34} /></span>
            </div>
            <h3 className="text-lg font-semibold text-slate-900">{modal.titulo}</h3>
            {modal.detalhe && <p className="mt-1 text-sm text-slate-500">{modal.detalhe}</p>}
            <button
              autoFocus
              onClick={() => setModal(null)}
              className="mt-5 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.98]"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

/** Círculo de carregamento (spinner) reutilizável em botões. */
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`animate-spin ${className}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

function IconeCheck({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
function IconeX({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
function IconeInfo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.01" />
    </svg>
  )
}
