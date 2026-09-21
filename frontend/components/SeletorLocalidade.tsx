'use client'
import { useEffect, useMemo, useState } from 'react'
import {
  ESTADOS_BRASIL,
  cidadePertenceAoEstado,
  extrairCidadesIbge,
  ibgeMunicipiosUrl,
  normalizarUfBrasil,
} from '@/lib/localidades-brasil'

type Props = {
  cidade: string
  uf: string
  onChange: (valor: { cidade: string; uf: string }) => void
  className?: string
  desabilitado?: boolean
  rotuloUf?: string
  rotuloCidade?: string
}

const cacheCidades = new Map<string, string[]>()

export default function SeletorLocalidade({
  cidade,
  uf,
  onChange,
  className = '',
  desabilitado = false,
  rotuloUf = 'Estado',
  rotuloCidade = 'Cidade',
}: Props) {
  const ufNormalizada = normalizarUfBrasil(uf)
  const [cidades, setCidades] = useState<string[]>(() => cacheCidades.get(ufNormalizada) || [])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!ufNormalizada) {
      setCidades([])
      setErro('')
      setCarregando(false)
      return
    }

    const emCache = cacheCidades.get(ufNormalizada)
    if (emCache) {
      setCidades(emCache)
      setErro('')
      setCarregando(false)
      return
    }

    const url = ibgeMunicipiosUrl(ufNormalizada)
    const controller = new AbortController()
    setCarregando(true)
    setErro('')

    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error('Falha ao carregar cidades.')
        return r.json()
      })
      .then((payload) => {
        const lista = extrairCidadesIbge(payload)
        cacheCidades.set(ufNormalizada, lista)
        setCidades(lista)
      })
      .catch((e) => {
        if (e?.name === 'AbortError') return
        setCidades([])
        setErro('Não foi possível carregar as cidades deste estado.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false)
      })

    return () => controller.abort()
  }, [ufNormalizada])

  const opcoesCidade = useMemo(() => {
    const atual = String(cidade || '').trim()
    if (!atual || cidadePertenceAoEstado(atual, cidades)) return cidades
    return [atual, ...cidades]
  }, [cidade, cidades])

  const cidadeBloqueada = desabilitado || !ufNormalizada || carregando || !!erro || opcoesCidade.length === 0

  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${className}`}>
      <label className="block">
        <span className="mb-0.5 block text-[10px] uppercase text-ink-3">{rotuloUf}</span>
        <select
          value={ufNormalizada}
          disabled={desabilitado}
          onChange={(e) => onChange({ uf: e.target.value, cidade: '' })}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
        >
          <option value="">Selecione</option>
          {ESTADOS_BRASIL.map((estado) => (
            <option key={estado.uf} value={estado.uf}>{estado.nome}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-0.5 block text-[10px] uppercase text-ink-3">{rotuloCidade}</span>
        {erro ? (
          <input
            value={cidade || ''}
            disabled={desabilitado || !ufNormalizada}
            onChange={(e) => onChange({ uf: ufNormalizada, cidade: e.target.value })}
            placeholder="Digite a cidade"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
          />
        ) : (
          <select
            value={cidade || ''}
            disabled={cidadeBloqueada}
            onChange={(e) => onChange({ uf: ufNormalizada, cidade: e.target.value })}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
          >
            <option value="">
              {!ufNormalizada
                ? 'Escolha o estado'
                : carregando ? 'Carregando...'
                  : 'Selecione'}
            </option>
            {opcoesCidade.map((nome) => (
              <option key={nome} value={nome}>{nome}</option>
            ))}
          </select>
        )}
        {erro && <span className="mt-1 block text-xs text-estado-danger">{erro}</span>}
      </label>
    </div>
  )
}
