'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Spinner } from '@/components/feedback/FeedbackProvider'
import { IconSparkle, IconClose, IconPlay, IconCheck } from '@/components/ui/icons'
import {
  OPCOES_AJUSTE,
  camposVisiveis,
  mercadoResultante,
  validarMercado,
  mercadoMudou,
  rotuloMercado,
  opcoesDoMenu,
  proximoPasso,
  type AjusteBusca,
  type Mercado,
  type SessaoResumo,
} from '@/lib/assistente-entrada'

// Entrada guiada do Assistente de Oportunidades.
//
// O botão premium não cai mais direto na sessão de análise: ele pergunta primeiro o que a
// pessoa quer fazer. Dois caminhos, nada além disso — revisar o que já foi encontrado, ou
// procurar mais. Nenhum critério é configurado aqui: eles continuam automáticos.
//
// O que este componente NÃO faz, de propósito:
//   - não abre, não encerra e não retargeta sessão (quem cria a sessão é o passo Revisar,
//     pelo endpoint de sempre — retargetar corromperia meta e fila em andamento);
//   - não implementa busca própria: reusa o mesmo disparo da Busca avulsa.

type Resumo = { sessao: SessaoResumo; fila_pendente: number }

export default function AssistenteEntrada({
  empresaId,
  mercado,
  meta,
  coletaEmAndamento = false,
  onRevisar,
  onBuscar,
  onFechar,
}: {
  empresaId: string
  // Contexto atual da Busca avulsa. É ele que a busca guiada preserva.
  mercado: Mercado
  // Máx. de leads novos da busca — mostrado como informação, nunca como campo técnico.
  meta: number
  coletaEmAndamento?: boolean
  onRevisar: () => void
  // Dispara a coleta pelo mesmo caminho da Busca avulsa. Deve lançar em caso de erro.
  onBuscar: (destino: Mercado) => Promise<void>
  onFechar: () => void
}) {
  const [passo, setPasso] = useState<string>('escolha')
  const [ajuste, setAjuste] = useState<AjusteBusca>('ambos')
  const [rascunho, setRascunho] = useState<Mercado>({ nicho: '', cidade: '', uf: '' })
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')
  const [destinoBuscado, setDestinoBuscado] = useState<Mercado | null>(null)

  // Retrato barato da sessão: este endpoint não monta fila e não chama a IA, então abrir
  // o menu nunca custa uma chamada paga.
  const carregar = useCallback(async () => {
    if (!empresaId) return
    setCarregando(true)
    try {
      const r = await apiFetch<Resumo>(`/api/empresas/${empresaId}/prospeccao/curadoria/resumo`)
      setResumo(r.data)
    } catch (e) {
      // Falhar aqui não pode bloquear o menu: sem o resumo, ele só perde o progresso.
      setResumo(null)
    } finally {
      setCarregando(false)
    }
  }, [empresaId])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFechar])

  const opcoes = useMemo(
    () => opcoesDoMenu({ sessao: resumo?.sessao ?? null, coletaEmAndamento, mercadoAtual: mercado }),
    [resumo, coletaEmAndamento, mercado]
  )

  function escolherAjuste(id: AjusteBusca) {
    setErro('')
    setAjuste(id)
    // Campos nascem com o contexto atual: mudar "só a cidade" não obriga a redigitar nada.
    setRascunho({ ...mercado })
    setPasso(proximoPasso('o_que_mudar', id))
  }

  const campos = camposVisiveis(ajuste, mercado)
  const destino = mercadoResultante(mercado, rascunho, ajuste)

  async function buscar() {
    if (buscando) return
    const invalido = validarMercado(destino)
    if (invalido) { setErro(invalido); return }
    if (!mercadoMudou(mercado, destino)) {
      setErro('Este é o mesmo mercado da busca atual. Mude o nicho ou a cidade para trazer leads diferentes.')
      return
    }
    setErro('')
    setBuscando(true)
    try {
      await onBuscar(destino)
      setDestinoBuscado(destino)
      setPasso(proximoPasso('campos', 'buscou'))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui iniciar a busca.')
    } finally {
      setBuscando(false)
    }
  }

  const sessaoAtiva = opcoes.revisar.retomando

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onFechar}
      role="dialog"
      aria-modal="true"
      aria-label="Assistente de Oportunidades"
    >
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <IconSparkle className="h-4 w-4 text-orange-500" />
              {passo === 'escolha' ? 'O que você quer fazer agora?'
                : passo === 'o_que_mudar' ? 'O que você quer mudar?'
                  : passo === 'campos' ? 'Para onde vamos procurar?'
                    : 'Busca iniciada'}
            </h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {passo === 'iniciada'
                ? rotuloMercado(destinoBuscado || destino)
                : `Busca atual: ${rotuloMercado(mercado)}`}
            </p>
          </div>
          <button onClick={onFechar} aria-label="Fechar assistente"
            className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <IconClose />
          </button>
        </div>

        {erro && <p className="text-sm text-red-600">{erro}</p>}

        {/* ── Passo 1: os dois caminhos ─────────────────────────────────────── */}
        {passo === 'escolha' && (
          <div className="space-y-2">
            {carregando ? (
              <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-8 text-sm text-slate-500">
                <Spinner /> Vendo onde você parou…
              </div>
            ) : (
              <>
                <Escolha
                  titulo={opcoes.revisar.label}
                  descricao={opcoes.revisar.descricao}
                  destaque
                  onClick={onRevisar}
                  icone={<IconCheck />}
                />
                <Escolha
                  titulo={opcoes.buscar.label}
                  descricao={opcoes.buscar.descricao}
                  disponivel={opcoes.buscar.disponivel}
                  onClick={() => { setErro(''); setPasso(proximoPasso('escolha', 'buscar')) }}
                  icone={<IconPlay />}
                />
                {sessaoAtiva && (
                  <p className="pt-1 text-xs text-slate-500">
                    Uma revisão já está aberta. Buscar um mercado novo não a interrompe — os leads
                    entram na carteira e você revisa quando quiser.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Passo 2: o que mudar ──────────────────────────────────────────── */}
        {passo === 'o_que_mudar' && (
          <div className="space-y-2">
            {OPCOES_AJUSTE.map((o) => (
              <Escolha key={o.id} titulo={o.label} descricao={o.descricao}
                onClick={() => escolherAjuste(o.id)} />
            ))}
            <Voltar onClick={() => setPasso(proximoPasso('o_que_mudar', 'voltar'))} />
          </div>
        )}

        {/* ── Passo 3: só os campos que mudam ───────────────────────────────── */}
        {passo === 'campos' && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {campos.includes('nicho') && (
                <CampoTexto label="Nicho" placeholder="ex: dentista" className="sm:col-span-2"
                  valor={rascunho.nicho} onChange={(v) => setRascunho({ ...rascunho, nicho: v })} />
              )}
              {campos.includes('cidade') && (
                <CampoTexto label="Cidade" placeholder="ex: Campinas"
                  valor={rascunho.cidade} onChange={(v) => setRascunho({ ...rascunho, cidade: v })} />
              )}
              {campos.includes('uf') && (
                <CampoTexto label="Estado (UF)" placeholder="SP" maxLength={2} uppercase
                  valor={rascunho.uf} onChange={(v) => setRascunho({ ...rascunho, uf: v.toUpperCase() })} />
              )}
            </div>

            {/* O que não muda continua valendo — dito em uma linha, sem virar formulário. */}
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Vou procurar em <b>{rotuloMercado(destino)}</b> e trazer até <b>{meta}</b> leads novos.
              Os critérios de qualidade continuam automáticos.
            </p>

            <div className="flex flex-wrap gap-2">
              <button onClick={buscar} disabled={buscando}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-orange-600 hover:to-amber-600 disabled:opacity-50">
                {buscando ? <Spinner /> : <IconPlay />}{buscando ? 'Iniciando…' : 'Procurar agora'}
              </button>
              <button onClick={() => { setErro(''); setPasso(proximoPasso('campos', 'voltar')) }} disabled={buscando}
                className="rounded-lg border px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── Passo 4: confirmação ──────────────────────────────────────────── */}
        {passo === 'iniciada' && (
          <div className="space-y-3 rounded-xl border border-dashed px-4 py-6 text-center">
            <p className="text-sm text-slate-600">
              Estou procurando em <b>{rotuloMercado(destinoBuscado || destino)}</b>. Os leads chegam
              em alguns minutos e a lista se atualiza sozinha.
            </p>
            <p className="text-xs text-slate-400">
              {sessaoAtiva
                ? 'Sua revisão em andamento continua exatamente onde estava.'
                : 'Quando chegarem, abra o assistente de novo e escolha "Revisar oportunidades encontradas".'}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <button onClick={onFechar}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
                Entendi
              </button>
              <button onClick={() => { setErro(''); setPasso(proximoPasso('iniciada', 'voltar')) }}
                className="rounded-lg border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                Voltar ao início
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Cartão de escolha: alvo grande, uma linha de explicação, nada de jargão.
function Escolha({
  titulo, descricao, onClick, disponivel = true, destaque = false, icone,
}: {
  titulo: string
  descricao: string
  onClick: () => void
  disponivel?: boolean
  destaque?: boolean
  icone?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!disponivel}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        destaque
          ? 'border-orange-200 bg-orange-50/60 hover:border-orange-300 hover:bg-orange-50'
          : 'hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      {icone && (
        <span className={`mt-0.5 shrink-0 ${destaque ? 'text-orange-500' : 'text-slate-400'}`}>{icone}</span>
      )}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{titulo}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{descricao}</span>
      </span>
    </button>
  )
}

function Voltar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="pt-1 text-xs text-slate-500 hover:text-slate-700 hover:underline">
      ← Voltar
    </button>
  )
}

function CampoTexto({
  label, valor, onChange, placeholder, maxLength, uppercase = false, className = '',
}: {
  label: string
  valor: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
  uppercase?: boolean
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        value={valor}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-sm ${uppercase ? 'uppercase' : ''}`}
      />
    </label>
  )
}
