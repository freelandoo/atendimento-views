'use client'
// META PESSOAL — faixa no topo do Banco de Leads (migrations 111 + 113).
//
// A tela SÓ desenha: cada período ({dia, semana}) chega como uma LISTA de barras [{chave, prog}] —
// uma barra no modo geral ('contatos' = mensagem + ligação), duas no separado ('ligacoes',
// 'mensagens'). A barra é `proximidade` reusada do painel "Minha Operação" (via lib/meta-pessoal).
// É meta PESSOAL, não placar — mede o próprio ritmo de quem a definiu. O progresso vem de eventos
// reais (ligações encerradas + mensagens enviadas), contado no backend.
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import FolhaModal from '@/components/ui/FolhaModal'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { classesEntrada } from '@/lib/ui-primitivos'
import {
  proximidade, DIAS, DIAS_UTEIS_PADRAO, rotuloDias, rotuloCanal,
  type ProgressoMeta, type ConfigMeta, type MedidaMeta, type ModoMeta,
} from '@/lib/meta-pessoal'

type RespostaMeta = {
  config: ConfigMeta | null
  progresso: { dia: MedidaMeta[]; semana: MedidaMeta[] }
}

// A intensidade vira cor SEM ser a única informação: o número X/Y e a frase sempre acompanham.
const FILL: Record<string, string> = {
  conquista: 'bg-estado-ok',
  alta: 'bg-estado-ok',
  media: 'bg-brand',
  baixa: 'bg-brand/60',
}

function Barra({ titulo, prog }: { titulo: string; prog: ProgressoMeta }) {
  // Dia fora dos dias de atendimento (alvo 0): não há barra a desenhar — mostra só o que foi feito.
  if (!prog || !prog.alvo || prog.alvo <= 0) {
    return (
      <div className="min-w-[8rem] flex-1">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-ink-2">{titulo}</span>
          <span className="text-xs text-ink-3">{prog?.feito ?? 0} feito(s)</span>
        </div>
        <p className="mt-1 text-[11px] text-ink-3">Fora dos dias de meta.</p>
      </div>
    )
  }
  const perto = proximidade(prog)
  return (
    <div className="min-w-[8rem] flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-ink-2">{titulo}</span>
        <span className="text-xs font-semibold text-ink">
          {prog.feito}<span className="text-ink-3">/{prog.alvo}</span>
        </span>
      </div>
      <div className="relative mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className={`h-full rounded-full transition-all ${perto ? (FILL[perto.intensidade] || 'bg-brand') : 'bg-brand'}`}
          style={{ width: perto ? perto.largura : '0%' }}
        />
      </div>
      {perto && (
        <p className={`mt-0.5 text-[11px] ${perto.marco === 100 ? 'text-estado-ok font-medium' : 'text-ink-3'}`}>
          {perto.selo ? `${perto.selo} — ` : ''}{perto.frase}
        </p>
      )}
    </div>
  )
}

// Um período (Hoje / Esta semana) com as suas barras por canal, lado a lado (duas no separado).
function Grupo({ titulo, medidas }: { titulo: string; medidas: MedidaMeta[] }) {
  if (!medidas || !medidas.length) return null
  return (
    <div className="min-w-[10rem] flex-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{titulo}</span>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
        {medidas.map((m) => <Barra key={m.chave} titulo={rotuloCanal(m.chave)} prog={m.prog} />)}
      </div>
    </div>
  )
}

export default function MetaPessoal({ empresaId, atualizacao }: { empresaId: string; atualizacao?: number }) {
  const fb = useFeedback()
  const base = `/api/empresas/${empresaId}/banco-leads`
  const [dados, setDados] = useState<RespostaMeta | null>(null)
  const [modal, setModal] = useState(false)
  const reqRef = useRef(0)

  const carregar = useCallback(async () => {
    const meu = ++reqRef.current
    try {
      const r = await apiFetch<RespostaMeta>(`${base}/meta`)
      if (meu === reqRef.current) setDados(r.data)
    } catch {
      // Falha aqui não pode derrubar o Banco de Leads — a faixa some, sem alarme.
      if (meu === reqRef.current) setDados(null)
    }
  }, [base])

  useEffect(() => { void carregar() }, [carregar, atualizacao])
  // Voltou para a aba: recontar (registrar ligação/envio em outra aba/aparelho não avisa esta).
  useEffect(() => {
    const aoFocar = () => { void carregar() }
    window.addEventListener('focus', aoFocar)
    return () => window.removeEventListener('focus', aoFocar)
  }, [carregar])

  const config = dados?.config || null

  return (
    <div className="rounded-lg border border-line bg-surface p-3 shadow-card">
      {!config ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-2">
            <span className="font-medium text-ink">Meta de contatos</span> — você ainda não definiu a sua.
          </p>
          <Botao variante="primaria" tamanho="sm" onClick={() => setModal(true)}>Definir meta</Botao>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand">Minha meta</span>
          {dados && <Grupo titulo="Hoje" medidas={dados.progresso.dia} />}
          {dados && <Grupo titulo="Esta semana" medidas={dados.progresso.semana} />}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[11px] text-ink-3 sm:inline">{rotuloDias(config.dias_semana)}</span>
            <Botao variante="secundaria" tamanho="sm" onClick={() => setModal(true)}>Editar meta</Botao>
          </div>
        </div>
      )}

      {modal && (
        <ModalDefinirMeta
          base={base}
          atual={config}
          onFechar={() => setModal(false)}
          onSalvo={() => { setModal(false); fb.toast('Meta salva.', 'success'); void carregar() }}
        />
      )}
    </div>
  )
}

function ModalDefinirMeta({
  base, atual, onFechar, onSalvo,
}: {
  base: string
  atual: ConfigMeta | null
  onFechar: () => void
  onSalvo: () => void
}) {
  const fb = useFeedback()
  const [modo, setModo] = useState<ModoMeta>(atual?.modo === 'separado' ? 'separado' : 'geral')
  const [alvo, setAlvo] = useState(atual && atual.modo === 'geral' ? String(atual.alvo_semanal) : '')
  const [ligacoes, setLigacoes] = useState(atual?.alvo_ligacoes ? String(atual.alvo_ligacoes) : '')
  const [mensagens, setMensagens] = useState(atual?.alvo_mensagens ? String(atual.alvo_mensagens) : '')
  const [dias, setDias] = useState<number[]>(atual ? atual.dias_semana : [...DIAS_UTEIS_PADRAO])
  const [salvando, setSalvando] = useState(false)

  const num = (v: string) => Math.trunc(Number(v))
  const alvoNum = num(alvo)
  const ligNum = num(ligacoes)
  const msgNum = num(mensagens)
  const invalido = dias.length === 0 || (
    modo === 'geral'
      ? !(alvoNum >= 1)
      : !(ligNum >= 1) || !(msgNum >= 1)
  )

  function alternarDia(iso: number) {
    setDias((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort((a, b) => a - b)))
  }

  async function salvar() {
    if (invalido || salvando) return
    setSalvando(true)
    try {
      const body = modo === 'separado'
        ? { modo, alvo_ligacoes: ligNum, alvo_mensagens: msgNum, dias_semana: dias }
        : { modo, alvo_semanal: alvoNum, dias_semana: dias }
      await apiFetch(`${base}/meta`, { method: 'PUT', body: JSON.stringify(body) })
      onSalvo()
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Não foi possível salvar a meta.', 'error')
      setSalvando(false)
    }
  }

  const porDia = (semanal: number) => (dias.length ? Math.max(1, Math.round(semanal / dias.length)) : 0)

  return (
    <FolhaModal aberto titulo="Definir meta de contatos" onFechar={onFechar} lateral>
      <div className="space-y-4 p-1">
        <div role="radiogroup" aria-label="Como medir a meta" className="flex gap-1.5">
          {([['geral', 'Contatos (geral)'], ['separado', 'Separar ligação e mensagem']] as const).map(([v, rot]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={modo === v}
              onClick={() => setModo(v)}
              className={`h-9 flex-1 rounded-md border px-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                modo === v ? 'border-brand bg-brand/10 font-semibold text-brand' : 'border-line bg-surface-2 text-ink-2 hover:bg-surface-3'
              }`}
            >
              {rot}
            </button>
          ))}
        </div>

        {modo === 'geral' ? (
          <Campo etiqueta="Meta semanal (total de contatos)" obrigatorio ajuda="Contamos ligações encerradas e mensagens enviadas aos leads.">
            <input
              type="number" min={1} inputMode="numeric" value={alvo}
              onChange={(e) => setAlvo(e.target.value)} className={classesEntrada({})} placeholder="Ex.: 200"
            />
          </Campo>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Ligações por semana" obrigatorio>
              <input
                type="number" min={1} inputMode="numeric" value={ligacoes}
                onChange={(e) => setLigacoes(e.target.value)} className={classesEntrada({})} placeholder="Ex.: 40"
              />
            </Campo>
            <Campo etiqueta="Mensagens por semana" obrigatorio>
              <input
                type="number" min={1} inputMode="numeric" value={mensagens}
                onChange={(e) => setMensagens(e.target.value)} className={classesEntrada({})} placeholder="Ex.: 160"
              />
            </Campo>
          </div>
        )}

        <div>
          <p className="mb-1 block text-xs font-medium text-ink-2">Dias que você atende</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias de atendimento">
            {DIAS.map((d) => {
              const ativo = dias.includes(d.iso)
              return (
                <button
                  key={d.iso}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => alternarDia(d.iso)}
                  className={`h-9 min-w-[2.75rem] rounded-md border px-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    ativo ? 'border-brand bg-brand/10 font-semibold text-brand' : 'border-line bg-surface-2 text-ink-2 hover:bg-surface-3'
                  }`}
                >
                  {d.curto}
                </button>
              )
            })}
          </div>
          {!invalido && (
            <p className="mt-1.5 text-[11px] text-ink-3">
              {modo === 'geral'
                ? `≈ ${porDia(alvoNum)} por dia, em ${dias.length} dia(s).`
                : `≈ ${porDia(ligNum)} ligações e ${porDia(msgNum)} mensagens por dia, em ${dias.length} dia(s).`}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Botao variante="secundaria" onClick={onFechar} disabled={salvando}>Cancelar</Botao>
          <Botao
            variante="primaria"
            onClick={salvar}
            disabled={invalido || salvando}
            motivoDesabilitado={invalido ? 'Informe metas ≥ 1 e ao menos um dia.' : ''}
          >
            {salvando ? 'Salvando…' : 'Salvar meta'}
          </Botao>
        </div>
      </div>
    </FolhaModal>
  )
}
