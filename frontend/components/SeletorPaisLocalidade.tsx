'use client'

import SeletorLocalidade from './SeletorLocalidade'
import { PAISES_AQUISICAO, normalizarPais } from '@/lib/paises'

type Valor = {
  pais: string
  cidade: string
  uf: string
}

type Props = {
  pais: string
  cidade: string
  uf: string
  onChange: (valor: Valor) => void
  className?: string
  desabilitado?: boolean
  rotuloPais?: string
  rotuloCidade?: string
}

const inputClasses = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60'

export default function SeletorPaisLocalidade({
  pais,
  cidade,
  uf,
  onChange,
  className = '',
  desabilitado = false,
  rotuloPais = 'País',
  rotuloCidade = 'Cidade/região',
}: Props) {
  const paisNormalizado = normalizarPais(pais)
  const brasil = paisNormalizado === 'BR'

  return (
    <div className={`grid gap-3 ${className}`}>
      <label className="block">
        <span className="mb-0.5 block text-[10px] uppercase text-ink-3">{rotuloPais}</span>
        <select
          value={paisNormalizado}
          disabled={desabilitado}
          onChange={(e) => onChange({ pais: e.target.value, cidade: '', uf: '' })}
          className={inputClasses}
        >
          {PAISES_AQUISICAO.map((p) => (
            <option key={p.codigo} value={p.codigo}>{p.nome}</option>
          ))}
        </select>
      </label>

      {brasil ? (
        <SeletorLocalidade
          cidade={cidade}
          uf={uf}
          desabilitado={desabilitado}
          onChange={(local) => onChange({ pais: paisNormalizado, cidade: local.cidade, uf: local.uf })}
        />
      ) : (
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase text-ink-3">{rotuloCidade}</span>
          <input
            value={cidade || ''}
            disabled={desabilitado}
            onChange={(e) => onChange({ pais: paisNormalizado, cidade: e.target.value, uf: '' })}
            placeholder="Digite a cidade ou região"
            className={inputClasses}
          />
        </label>
      )}
    </div>
  )
}
