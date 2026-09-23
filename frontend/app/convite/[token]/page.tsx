'use client'
// Link de cadastro — a página PÚBLICA que a pessoa convidada abre (migration 096).
//
// Tema NEON, como `login` e `signup`: é porta de entrada, não área de trabalho.
//
// O que ela faz: lê o convite (empresa, papel, equipe), pede nome, e-mail, data de nascimento e
// senha, e manda para `POST /api/convites/:token/aceitar`. A resposta é a mesma do login, então
// a pessoa já sai daqui logada e cai em `/dashboard` — onde o `AuthGuard` a leva ao aceite do
// termo do programa (quando o papel exige) e depois à tela do papel dela.
//
// NENHUMA REGRA AQUI: senha, idade e e-mail repetido são julgados pelo servidor, que devolve a
// mensagem pronta. A única conferência local é "as duas senhas digitadas são iguais" — isso é
// digitação, não regra de negócio.
import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import NeonProgress from '@/components/ui/NeonProgress'
import { rotuloPapel } from '@/lib/capacidades'
import type { PapelEmpresa } from '@/lib/capacidades'

type ConvitePublico = {
  empresa_nome: string
  papel: string
  equipe_nome: string | null
  expira_em: string
  senha_regra: string
  idade_minima: number
}

const inputCls =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-hi outline-none transition focus:border-neon-cyan focus:shadow-glow-cyan'

export default function ConvitePage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = String(params?.token || '')

  const [convite, setConvite] = useState<ConvitePublico | null>(null)
  const [indisponivel, setIndisponivel] = useState('')
  const [carregando, setCarregando] = useState(true)

  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [nascimento, setNascimento] = useState('')
  const [senha, setSenha] = useState('')
  const [senha2, setSenha2] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!token) return
    let vivo = true
    apiFetch<ConvitePublico>(`/api/convites/${encodeURIComponent(token)}`)
      .then((r) => { if (vivo) setConvite(r.data) })
      .catch((e: unknown) => {
        if (vivo) setIndisponivel(e instanceof Error ? e.message : 'Não foi possível abrir o convite.')
      })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [token])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    if (senha !== senha2) { setErro('As duas senhas não são iguais.'); return }
    setEnviando(true)
    try {
      const { data } = await apiFetch<{ token: string; empresa_id: string }>(
        `/api/convites/${encodeURIComponent(token)}/aceitar`,
        { method: 'POST', body: JSON.stringify({ nome, email, data_nascimento: nascimento, senha }) },
      )
      localStorage.setItem('token', data.token)
      if (data.empresa_id) localStorage.setItem('empresa_id', data.empresa_id)
      router.replace('/dashboard')
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Não foi possível concluir o cadastro.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="bg-grid relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -left-32 top-1/4 h-80 w-80 rounded-full bg-neon-cyan/20 blur-[110px]" />
      <div className="pointer-events-none absolute -right-24 bottom-1/4 h-80 w-80 rounded-full bg-neon-magenta/15 blur-[110px]" />

      <div className="glass relative z-10 w-full max-w-md space-y-5 rounded-2xl p-8 shadow-glow-soft">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neon-cyan/70">Convite</p>
          <h1 className="neon-text font-display text-3xl font-bold">Criar sua conta</h1>
        </div>

        {carregando && <NeonProgress />}

        {!carregando && indisponivel && (
          <div className="space-y-4">
            <p role="alert" className="rounded-lg border border-neon-red/30 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">
              {indisponivel}
            </p>
            <p className="text-center text-sm text-lo">
              Já tem conta?{' '}
              <Link href="/login" className="font-medium text-neon-cyan hover:underline">Entrar</Link>
            </p>
          </div>
        )}

        {!carregando && convite && (
          <form onSubmit={enviar} className="space-y-4">
            <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-mid">
              Você foi convidado para <span className="font-semibold text-hi">{convite.empresa_nome}</span>
              {' '}como <span className="font-semibold text-hi">{rotuloPapel(convite.papel as PapelEmpresa)}</span>
              {convite.equipe_nome ? <> na equipe <span className="font-semibold text-hi">{convite.equipe_nome}</span></> : null}.
            </p>

            {erro && (
              <p role="alert" className="rounded-lg border border-neon-red/30 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">{erro}</p>
            )}

            <div className="space-y-1.5">
              <label htmlFor="cv-nome" className="text-xs font-medium text-mid">Nome completo</label>
              <input id="cv-nome" type="text" required minLength={2} maxLength={120} autoComplete="name"
                value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cv-email" className="text-xs font-medium text-mid">E-mail</label>
              <input id="cv-email" type="email" required autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cv-nasc" className="text-xs font-medium text-mid">Data de nascimento</label>
              <input id="cv-nasc" type="date" required autoComplete="bday"
                value={nascimento} onChange={(e) => setNascimento(e.target.value)}
                aria-describedby="cv-nasc-ajuda" className={inputCls} />
              <p id="cv-nasc-ajuda" className="text-xs text-lo">
                O cadastro é só para maiores de {convite.idade_minima} anos.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cv-senha" className="text-xs font-medium text-mid">Senha</label>
              <input id="cv-senha" type="password" required minLength={8} autoComplete="new-password"
                value={senha} onChange={(e) => setSenha(e.target.value)}
                aria-describedby="cv-senha-ajuda" className={inputCls} />
              <p id="cv-senha-ajuda" className="text-xs text-lo">{convite.senha_regra}</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cv-senha2" className="text-xs font-medium text-mid">Repita a senha</label>
              <input id="cv-senha2" type="password" required autoComplete="new-password"
                value={senha2} onChange={(e) => setSenha2(e.target.value)} className={inputCls} />
            </div>

            {enviando && <NeonProgress />}

            <button
              type="submit"
              disabled={enviando}
              className="w-full rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 py-2.5 text-sm font-semibold text-neon-cyan transition-all hover:bg-neon-cyan/25 hover:shadow-glow-cyan active:scale-[0.98] disabled:opacity-50"
            >
              {enviando ? 'Criando conta…' : 'Criar conta e entrar →'}
            </button>

            <p className="text-center text-xs text-lo">
              Este link é de uso único. Depois de criar a conta, entre sempre pela tela de login.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
