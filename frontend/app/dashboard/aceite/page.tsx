'use client'
// Operação Comercial, Etapa 1 — a tela de aceite do termo.
//
// ⚠️ ESTA TELA NÃO É O BLOQUEIO. Quem barra é a API: enquanto o aceite estiver pendente,
// `requireEmpresaAccess` responde 403 ACEITE_PENDENTE em TODA rota com escopo de empresa. Aqui só
// se lê o termo e se declara o aceite. Se este arquivo sumir, o sistema continua bloqueado.
//
// A rota fica FORA da área bloqueada de propósito: `/api/empresas/:id/programa` é o único mount
// que usa `requireEmpresaAccessSemAceite`. Um bloqueio sem maçaneta seria um lockout.
//
// Nenhuma regra mora aqui: rolagem, estado do botão e textos vêm de `lib/programa-aceite.js`
// (puro e testado). Este componente desenha e faz I/O.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, getEmpresaId, ApiError } from '@/lib/api'
import {
  precisaAceitar, situacaoDoTermo, rolouAteOFim, estadoDoBotao,
} from '@/lib/programa-aceite'
import type { ProgramaAceiteVeredito, TermoVigente } from '@/lib/programa-aceite'

const cardCls = 'rounded-2xl border border-slate-200 bg-white shadow-sm'
const btnPrimario =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50'

type RespostaTermo = {
  programa: string
  termo: TermoVigente
  situacao: ProgramaAceiteVeredito
  aceite: { versao: string; em: string } | null
}

export default function AceitePage() {
  const router = useRouter()
  const [dados, setDados] = useState<RespostaTermo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [rolouAteFim, setRolouAteFim] = useState(false)
  const [maioridade, setMaioridade] = useState(false)
  const [leuRegras, setLeuRegras] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const caixaRef = useRef<HTMLDivElement | null>(null)

  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  const carregar = useCallback(async () => {
    if (!empresaId) {
      setErro('Nenhuma empresa selecionada. Entre novamente para continuar.')
      setCarregando(false)
      return
    }
    setCarregando(true)
    setErro('')
    try {
      const r = await apiFetch<RespostaTermo>(`/api/empresas/${empresaId}/programa/termo`)
      setDados(r.data)
    } catch (e) {
      setErro((e as ApiError)?.message || 'Não foi possível carregar o termo.')
    } finally {
      setCarregando(false)
    }
  }, [empresaId])

  useEffect(() => { void carregar() }, [carregar])

  // Quem já aceitou (ou não é sujeito do programa) não tem o que fazer nesta tela. Redireciona
  // em vez de mostrar um formulário que não muda nada — chegar aqui por link antigo é comum.
  useEffect(() => {
    if (dados && !precisaAceitar(dados.situacao)) router.replace('/dashboard')
  }, [dados, router])

  // A medição roda também depois que o texto carrega: termo curto (ou tela grande) pode não ter
  // barra de rolagem nenhuma, e nesse caso exigir rolagem trancaria o botão para sempre.
  const medirRolagem = useCallback(() => {
    const el = caixaRef.current
    if (!el) return
    if (rolouAteOFim({
      scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
    })) setRolouAteFim(true) // só liga: rolar de volta para cima não desfaz a leitura
  }, [])

  useEffect(() => { if (dados) medirRolagem() }, [dados, medirRolagem])

  const botao = estadoDoBotao({ rolouAteFim, maioridade, leuRegras, enviando })

  async function aceitar() {
    if (!dados || !botao.habilitado) return
    setEnviando(true)
    setErro('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/programa/aceite`, {
        method: 'POST',
        body: JSON.stringify({
          termo_versao: dados.termo.versao,
          maioridade_confirmada: true,
          regras_confirmadas: true,
        }),
      })
      // Recarrega a aplicação para a sessão ser relida com o aceite já gravado — o veredito de
      // `/api/auth/me` é o que o AuthGuard usa, e ele foi buscado antes do POST.
      window.location.assign('/dashboard')
    } catch (e) {
      const err = e as ApiError
      setErro(err?.message || 'Não foi possível registrar o aceite.')
      // Termo mudou com a página aberta: recarrega o texto para a pessoa ler o que é novo antes
      // de aceitar de novo. Aceitar "às cegas" é exatamente o que este fluxo existe para evitar.
      if (err?.code === 'VERSAO_DIVERGENTE') { setRolouAteFim(false); void carregar() }
      setEnviando(false)
    }
  }

  if (carregando) {
    return <p className="text-sm text-slate-500">Carregando o termo…</p>
  }

  if (!dados) {
    return (
      <div className={`${cardCls} mx-auto max-w-2xl p-6`}>
        <p className="text-sm text-rose-700">{erro || 'Não foi possível carregar o termo.'}</p>
        <button type="button" onClick={() => void carregar()} className={`${btnPrimario} mt-4`}>
          Tentar de novo
        </button>
      </div>
    )
  }

  const situacao = situacaoDoTermo(dados.situacao?.motivo)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-cyan-50/40 to-slate-50 p-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-700">Operação Comercial</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">{situacao.titulo}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">{situacao.texto}</p>
      </header>

      <section className={`${cardCls} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{dados.termo.titulo}</h2>
          <span className="text-xs text-slate-500">Versão {dados.termo.versao}</span>
        </div>

        {/* `tabIndex={0}` não é detalhe: sem ele, quem navega por teclado não consegue rolar a
            caixa — e, sem rolar, o botão nunca libera. O bloqueio viraria um lockout acessível
            só a quem usa mouse. */}
        <div
          ref={caixaRef}
          onScroll={medirRolagem}
          tabIndex={0}
          role="region"
          aria-label={`${dados.termo.titulo}, versão ${dados.termo.versao}`}
          className="mt-3 h-80 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm leading-relaxed text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-200"
        >
          {dados.termo.secoes.map((secao, i) => (
            <div key={i} className={i > 0 ? 'mt-5' : ''}>
              <h3 className="text-sm font-semibold text-slate-900">{secao.titulo}</h3>
              {secao.paragrafos.map((p, j) => (
                <p key={j} className="mt-2">{p}</p>
              ))}
            </div>
          ))}
          <p className="mt-6 border-t border-slate-200 pt-3 text-xs text-slate-500">
            Fim do termo. Marque as confirmações abaixo para continuar.
          </p>
        </div>

        {/* Estado da leitura em TEXTO, não só na cor/opacidade do botão. */}
        <p className={`mt-2 text-xs ${rolouAteFim ? 'text-emerald-700' : 'text-slate-500'}`}>
          {rolouAteFim ? 'Você leu o termo até o final.' : 'Role o termo até o final para liberar o aceite.'}
        </p>

        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">Confirmações obrigatórias</legend>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 transition hover:border-slate-300">
            <input
              type="checkbox"
              checked={maioridade}
              onChange={(e) => setMaioridade(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-cyan-300"
            />
            <span>Declaro que tenho <strong>18 anos ou mais</strong>.</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 transition hover:border-slate-300">
            <input
              type="checkbox"
              checked={leuRegras}
              onChange={(e) => setLeuRegras(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-cyan-300"
            />
            <span>Li e aceito as regras da Operação Comercial (versão {dados.termo.versao}).</span>
          </label>
        </fieldset>

        {erro && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void aceitar()} disabled={!botao.habilitado} className={btnPrimario}>
            {botao.rotulo}
          </button>
          {/* Botão desabilitado nunca fica mudo: o motivo vem do módulo puro. */}
          {botao.motivo && <span className="text-xs text-slate-500">{botao.motivo}</span>}
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Ao aceitar, ficam registrados a data, a sua conta e a versão do termo.
        </p>
      </section>
    </div>
  )
}
