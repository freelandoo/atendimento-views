'use client'
// Tela de ASSINATURA (Fase 1 planos SaaS). Área de trabalho → tema CLARO, tokens. Mostra o estado
// do plano (trial/ativo/inativo) e deixa o owner escolher um plano + informar CPF → vai pro
// checkout da ASAAS. A tela só TRADUZ o veredito do backend (lib/plano.js) — não decide regra.
import { useState, useEffect, useCallback, FormEvent } from 'react'
import { apiFetch, getEmpresaId, ApiError } from '@/lib/api'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { rotuloStatus, diasRestantesTrial, formatarPreco, precisaAssinar, somenteLeitura } from '@/lib/plano'
import type { PlanoVeredito } from '@/lib/plano'

// Nomes comerciais (placeholder, iguais aos da landing). Decidir com copy depois.
const NOMES: Record<string, string> = { minimo: 'Essencial', basico: 'Profissional', pro: 'Equipe' }
const RESUMO: Record<string, string> = {
  minimo: 'O app para organizar e trabalhar seus leads na mão.',
  basico: 'IA respondendo e follow-up automático — o dia a dia de quem vende.',
  pro: 'Dado completo + Central de Ligações + CRM de equipe.',
}

type EstadoPlano = {
  plano: string | null
  status: string | null
  trial_fim: string | null
  dias_restantes: number | null
  acesso: PlanoVeredito | null
  precos: Record<string, number>
  assinaveis: string[]
}

export default function PlanoPage() {
  const [estado, setEstado] = useState<EstadoPlano | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [cpf, setCpf] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erroForm, setErroForm] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const { data } = await apiFetch<EstadoPlano>(`/api/empresas/${getEmpresaId()}/plano`)
      setEstado(data)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o plano.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  async function assinar(e: FormEvent) {
    e.preventDefault()
    if (!selecionado) return
    setErroForm('')
    setEnviando(true)
    try {
      const { data } = await apiFetch<{ checkout_url: string | null }>(
        `/api/empresas/${getEmpresaId()}/plano/assinar`,
        { method: 'POST', body: JSON.stringify({ plano: selecionado, cpf_cnpj: cpf }) }
      )
      if (data?.checkout_url) {
        window.location.href = data.checkout_url // vai pro checkout da ASAAS
        return
      }
      // Assinatura criada mas sem URL de cobrança (raro) — recarrega e avisa.
      setErroForm('Assinatura criada. Se o pagamento não abrir, recarregue em instantes.')
      await carregar()
    } catch (e) {
      const err = e as ApiError
      setErroForm(err?.message || 'Não foi possível iniciar a assinatura.')
    } finally {
      setEnviando(false)
    }
  }

  if (carregando) return <p className="text-sm text-ink-3">Carregando o plano…</p>
  if (erro) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-line bg-surface p-6 shadow-card">
        <p className="text-sm text-estado-danger">{erro}</p>
        <Botao variante="secundaria" onClick={() => void carregar()} className="mt-4">Tentar de novo</Botao>
      </div>
    )
  }

  const plano = estado?.acesso
    ? ({ ...estado.acesso, status: estado.status, trial_fim: estado.trial_fim } as PlanoVeredito)
    : null
  const bloqueado = precisaAssinar(plano)
  const atrasado = somenteLeitura(plano)
  const dias = diasRestantesTrial(plano)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">Assinatura</h1>

      {/* Estado atual */}
      <div
        className={`rounded-lg border p-5 shadow-card ${
          bloqueado ? 'border-estado-danger/40 bg-estado-danger/5'
          : atrasado ? 'border-estado-warn/40 bg-estado-warn/5'
          : 'border-line bg-surface'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Plano atual</p>
            <p className="mt-1 text-lg font-semibold text-ink">
              {estado?.plano ? (NOMES[estado.plano] || estado.plano) : '—'}
              <span className="ml-2 text-sm font-normal text-ink-3">· {rotuloStatus(plano)}</span>
            </p>
          </div>
          {dias != null && (
            <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-sm text-ink-2">
              {dias > 0 ? `${dias} dia${dias > 1 ? 's' : ''} de teste restante${dias > 1 ? 's' : ''}` : 'Teste encerrado'}
            </span>
          )}
        </div>
        {bloqueado && (
          <p className="mt-3 text-sm text-estado-danger">
            A assinatura está inativa. Escolha um plano abaixo para liberar o acesso.
          </p>
        )}
        {atrasado && (
          <p className="mt-3 text-sm text-estado-warn">
            Pagamento atrasado — o acesso continua em modo leitura. Regularize para voltar ao normal.
          </p>
        )}
      </div>

      {/* Planos para assinar */}
      <div className="grid gap-4 sm:grid-cols-2">
        {(estado?.assinaveis || []).map((p) => {
          const ativo = selecionado === p
          return (
            <div key={p} className={`rounded-lg border p-5 shadow-card ${ativo ? 'border-brand' : 'border-line'} bg-surface`}>
              <h2 className="text-lg font-semibold text-ink">{NOMES[p] || p}</h2>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-2xl font-bold text-ink">{formatarPreco(estado?.precos?.[p])}</span>
                <span className="text-sm text-ink-3">/mês</span>
              </div>
              <p className="mt-2 text-sm text-ink-2">{RESUMO[p]}</p>
              <Botao
                variante={ativo ? 'primaria' : 'secundaria'}
                onClick={() => { setSelecionado(p); setErroForm('') }}
                larguraTotal
                className="mt-4"
              >
                {ativo ? 'Plano escolhido' : 'Escolher'}
              </Botao>
            </div>
          )
        })}
      </div>

      {/* Formulário de CPF → checkout */}
      {selecionado && (
        <form onSubmit={assinar} className="rounded-lg border border-line bg-surface p-5 shadow-card space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink">
              Assinar {NOMES[selecionado] || selecionado} — {formatarPreco(estado?.precos?.[selecionado])}/mês
            </p>
            <p className="mt-1 text-sm text-ink-3">
              Informe o CPF ou CNPJ do responsável. Você escolhe a forma de pagamento (Pix, boleto ou cartão) no próximo passo.
            </p>
          </div>
          <Campo etiqueta="CPF ou CNPJ" erro={erroForm || undefined}>
            <input
              value={cpf}
              onChange={(ev) => setCpf(ev.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Somente números"
            />
          </Campo>
          <div className="flex gap-3">
            <Botao type="submit" variante="primaria" carregando={enviando}>
              Ir para o pagamento →
            </Botao>
            <Botao type="button" variante="neutra" onClick={() => setSelecionado(null)} disabled={enviando}>
              Cancelar
            </Botao>
          </div>
        </form>
      )}
    </div>
  )
}
