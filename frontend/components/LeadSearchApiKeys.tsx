'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  estadoChave,
  formatarDataCurta,
  montarPayloadChave,
  nomeEmpresa,
  rotuloEstadoChave,
  tomEstadoChave,
  validarFormularioChave,
} from '@/lib/lead-search-api-keys'
import type {
  ChaveLeadSearch,
  EmpresaLeadSearch,
  FormularioChaveLeadSearch,
} from '@/lib/lead-search-api-keys'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import Card from '@/components/ui/Card'
import Carregando from '@/components/ui/Carregando'
import EstadoVazio from '@/components/ui/EstadoVazio'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import DataTableFrame from '@/components/ui/DataTableFrame'
import { IconCopySparkle, IconLock, IconPlus, IconUndo } from '@/components/ui/icons'

type CriacaoResposta = {
  key: ChaveLeadSearch
  codigo: string
}

type Confirmacao =
  | { tipo: 'revogar'; chave: ChaveLeadSearch }
  | { tipo: 'rotacionar'; chave: ChaveLeadSearch }
  | null

const FORM_INICIAL: FormularioChaveLeadSearch = {
  nome: '',
  empresa_id: '',
  expires_at: '',
  max_leads_per_job: 100,
  rate_limit_per_minute: 10,
}

export default function LeadSearchApiKeys() {
  const [empresas, setEmpresas] = useState<EmpresaLeadSearch[]>([])
  const [chaves, setChaves] = useState<ChaveLeadSearch[]>([])
  const [form, setForm] = useState<FormularioChaveLeadSearch>(FORM_INICIAL)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null)
  const [codigoGerado, setCodigoGerado] = useState<{ codigo: string; keyHint: string; nome: string } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null)

  const empresasOrdenadas = useMemo(
    () => [...empresas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [empresas],
  )

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [rEmpresas, rChaves] = await Promise.all([
        apiFetch<EmpresaLeadSearch[]>('/api/admin/lead-search/empresas'),
        apiFetch<ChaveLeadSearch[]>('/api/admin/lead-search/keys'),
      ])
      setEmpresas(rEmpresas.data || [])
      setChaves(rChaves.data || [])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar os codigos da API.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  async function criarChave() {
    const validacao = validarFormularioChave(form)
    setErros(validacao.erros as Record<string, string>)
    if (!validacao.ok) return
    setOcupado('criar')
    setAviso(null)
    setCodigoGerado(null)
    try {
      const r = await apiFetch<CriacaoResposta>('/api/admin/lead-search/keys', {
        method: 'POST',
        body: JSON.stringify(montarPayloadChave(form)),
      })
      setCodigoGerado({ codigo: r.data.codigo, keyHint: r.data.key.key_hint, nome: r.data.key.nome })
      setForm(FORM_INICIAL)
      setErros({})
      await carregar()
      setAviso({ tom: 'ok', texto: 'Codigo criado. Copie agora, porque ele nao sera exibido de novo.' })
    } catch (e) {
      setAviso({ tom: 'erro', texto: e instanceof Error ? e.message : 'Nao foi possivel criar o codigo.' })
    } finally {
      setOcupado(null)
    }
  }

  async function copiarCodigo() {
    if (!codigoGerado?.codigo) return
    try {
      await navigator.clipboard.writeText(codigoGerado.codigo)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1800)
    } catch {
      setCopiado(false)
      setAviso({ tom: 'erro', texto: 'Nao foi possivel copiar automaticamente. Selecione o codigo e copie manualmente.' })
    }
  }

  async function confirmarAcao() {
    if (!confirmacao) return
    const alvo = confirmacao.chave
    const tipo = confirmacao.tipo
    setOcupado(`${tipo}:${alvo.id}`)
    setAviso(null)
    try {
      if (tipo === 'revogar') {
        await apiFetch(`/api/admin/lead-search/keys/${alvo.id}/revoke`, { method: 'POST' })
        setAviso({ tom: 'ok', texto: 'Codigo revogado.' })
      } else {
        const r = await apiFetch<CriacaoResposta>(`/api/admin/lead-search/keys/${alvo.id}/rotate`, { method: 'POST' })
        setCodigoGerado({ codigo: r.data.codigo, keyHint: r.data.key.key_hint, nome: r.data.key.nome })
        setAviso({ tom: 'ok', texto: 'Codigo rotacionado. Copie o novo valor agora.' })
      }
      setConfirmacao(null)
      await carregar()
    } catch (e) {
      setAviso({ tom: 'erro', texto: e instanceof Error ? e.message : 'Nao foi possivel concluir a acao.' })
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div className="space-y-4">
      {erro && <Caixa tom="erro">{erro}</Caixa>}
      {aviso && <Caixa tom={aviso.tom}>{aviso.texto}</Caixa>}

      {codigoGerado && (
        <Card
          titulo="Codigo gerado"
          descricao="Este valor aparece uma unica vez. Depois a tela mostra apenas o identificador mascarado."
          compacto
          className="border-estado-ok/30 bg-estado-ok/5"
          acoes={
            <Botao tamanho="sm" variante="primaria" onClick={copiarCodigo} iconeInicio={<IconCopySparkle />}>
              {copiado ? 'Copiado' : 'Copiar'}
            </Botao>
          }
        >
          <div className="rounded-lg border border-estado-ok/20 bg-surface px-3 py-2 font-mono text-xs text-ink">
            {codigoGerado.codigo}
          </div>
          <p className="mt-2 text-xs text-ink-3">
            Identificador salvo: <span className="font-mono">{codigoGerado.keyHint}</span> · {codigoGerado.nome}
          </p>
        </Card>
      )}

      <Card
        titulo="Novo codigo"
        descricao="Cria uma chave externa para busca de leads. O segredo completo nao volta pela API depois da criacao."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Campo etiqueta="Nome" erro={erros.nome} ajuda="Use um nome operacional, como cliente, parceiro ou finalidade." obrigatorio>
            <input
              value={form.nome || ''}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              placeholder="API Casa das Plantas"
              autoComplete="off"
            />
          </Campo>
          <Campo etiqueta="Empresa" erro={erros.empresa_id} ajuda="A chave sempre executa a busca dentro da empresa escolhida." obrigatorio>
            <select
              value={form.empresa_id || ''}
              onChange={(e) => setForm((f) => ({ ...f, empresa_id: e.target.value }))}
            >
              <option value="">Escolha uma empresa</option>
              {empresasOrdenadas.map((empresa) => (
                <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Validade" erro={erros.expires_at} ajuda="Opcional. Deixe vazio para nao expirar automaticamente.">
            <input
              type="datetime-local"
              value={form.expires_at || ''}
              onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
            />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Leads por busca" erro={erros.max_leads_per_job} ajuda="V1: teto maximo de 100.">
              <input
                type="number"
                min={1}
                max={100}
                value={form.max_leads_per_job ?? 100}
                onChange={(e) => setForm((f) => ({ ...f, max_leads_per_job: e.target.value }))}
              />
            </Campo>
            <Campo etiqueta="Criacoes por minuto" erro={erros.rate_limit_per_minute} ajuda="Protecao tecnica contra rajada.">
              <input
                type="number"
                min={1}
                max={60}
                value={form.rate_limit_per_minute ?? 10}
                onChange={(e) => setForm((f) => ({ ...f, rate_limit_per_minute: e.target.value }))}
              />
            </Campo>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Botao
            variante="primaria"
            carregando={ocupado === 'criar'}
            onClick={criarChave}
            iconeInicio={<IconPlus />}
          >
            Criar codigo
          </Botao>
          <p className="text-xs text-ink-3">
            Escopos fixos da V1: criar busca Maps e consultar jobs/resultados.
          </p>
        </div>
      </Card>

      <Card
        titulo="Codigos existentes"
        descricao="O segredo nunca aparece de novo. Para trocar, rotacione e copie o novo valor."
        semPadding
      >
        {carregando ? (
          <Carregando texto="Carregando codigos..." variante="bloco" />
        ) : chaves.length === 0 ? (
          <EstadoVazio
            titulo="Nenhum codigo criado"
            descricao="Crie o primeiro codigo para liberar o uso externo da API de busca de leads."
            icone={<IconLock className="h-6 w-6" />}
          />
        ) : (
          <DataTableFrame ariaLabel="Rolagem horizontal da tabela de codigos da API" className="overflow-hidden">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-line bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-4 py-3 font-medium">Codigo</th>
                  <th className="px-4 py-3 font-medium">Empresa</th>
                  <th className="px-4 py-3 font-medium">Limites</th>
                  <th className="px-4 py-3 font-medium">Validade</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {chaves.map((chave) => {
                  const estado = estadoChave(chave)
                  const processando = ocupado?.endsWith(`:${chave.id}`) === true
                  return (
                    <tr key={chave.id} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{chave.nome}</p>
                        <p className="mt-0.5 font-mono text-xs text-ink-3">{chave.key_hint}</p>
                      </td>
                      <td className="px-4 py-3 text-ink-2">{nomeEmpresa(empresas, chave.empresa_id)}</td>
                      <td className="px-4 py-3 text-ink-2">
                        <span className="block">{chave.max_leads_per_job} leads por busca</span>
                        <span className="block text-xs text-ink-3">{chave.rate_limit_per_minute} criacoes/min</span>
                      </td>
                      <td className="px-4 py-3 text-ink-2">{formatarDataCurta(chave.expires_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tomEstadoChave(estado)}`}>
                          {rotuloEstadoChave(estado)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Botao
                            tamanho="sm"
                            variante="secundaria"
                            onClick={() => setConfirmacao({ tipo: 'rotacionar', chave })}
                            carregando={processando && ocupado?.startsWith('rotacionar:')}
                            motivoDesabilitado={estado === 'revoked' ? 'Codigo revogado.' : ''}
                            disabled={estado === 'revoked'}
                            iconeInicio={<IconUndo />}
                          >
                            Rotacionar
                          </Botao>
                          <Botao
                            tamanho="sm"
                            variante="perigosa"
                            onClick={() => setConfirmacao({ tipo: 'revogar', chave })}
                            carregando={processando && ocupado?.startsWith('revogar:')}
                            motivoDesabilitado={estado === 'revoked' ? 'Codigo ja revogado.' : ''}
                            disabled={estado === 'revoked'}
                          >
                            Revogar
                          </Botao>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DataTableFrame>
        )}
      </Card>

      {confirmacao && (
        <ModalConfirmar
          titulo={confirmacao.tipo === 'revogar' ? 'Revogar codigo?' : 'Rotacionar codigo?'}
          corpo={
            confirmacao.tipo === 'revogar'
              ? `O codigo "${confirmacao.chave.nome}" deixa de autenticar imediatamente.`
              : `O codigo atual de "${confirmacao.chave.nome}" sera revogado e um novo segredo sera exibido uma unica vez.`
          }
          aviso={confirmacao.tipo === 'rotacionar' ? 'A aplicacao externa precisa trocar para o novo codigo depois disso.' : null}
          rotuloConfirmar={confirmacao.tipo === 'revogar' ? 'Revogar' : 'Rotacionar'}
          tom={confirmacao.tipo === 'revogar' ? 'perigo' : 'neutro'}
          ocupado={ocupado !== null}
          onConfirmar={confirmarAcao}
          onCancelar={() => setConfirmacao(null)}
        />
      )}
    </div>
  )
}

function Caixa({ tom, children }: { tom: 'ok' | 'erro'; children: React.ReactNode }) {
  const classe = tom === 'ok'
    ? 'border-estado-ok/30 bg-estado-ok/10 text-estado-ok'
    : 'border-estado-danger/30 bg-estado-danger/10 text-estado-danger'
  return <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${classe}`}>{children}</div>
}
