'use client'
// Criar e editar equipe — UM componente para os dois, porque são o mesmo formulário com um
// campo a menos. Dois modais divergiriam no primeiro campo novo.
//
// ─── O QUE MUDA ENTRE CRIAR E EDITAR, E POR QUÊ ─────────────────────────────────────────
// • **Nicho**: escolhido na criação e IMUTÁVEL depois. É ele que recorta o Banco de Leads de
//   todos os membros (`sqlNichoDaEquipe`); trocá-lo por um PATCH moveria a carteira de várias
//   pessoas de uma vez, em silêncio. O backend recusa com `NICHO_NAO_EDITAVEL` — aqui o campo
//   aparece bloqueado COM o motivo, em vez de sumir sem explicação.
// • **Membros iniciais**: só na criação. Depois, a composição vive em "Gerenciar membros",
//   que é onde a regra de adição (e a de remoção bloqueada) está dita por inteiro.
//
// ─── O QUE ESTE COMPONENTE NÃO SABE ─────────────────────────────────────────────────────
// Nenhuma regra. Validação de formulário, nichos já ocupados e conflito de seleção vêm de
// `lib/equipe-area.js` (puro e testado). A validação de verdade é a do backend.
import { useEffect, useMemo, useState } from 'react'
import FolhaModal from '@/components/ui/FolhaModal'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import {
  LIMITE_NOME,
  conflitosDaSelecao,
  estadoDaPessoa,
  nichosOcupados,
  validarFormulario,
} from '@/lib/equipe-area'
import type { EquipeArea, EquipeResumo, PessoaArea } from '@/lib/equipe-area'

export type Nicho = { id: string; nome: string; ativo?: boolean }

export type DadosEquipe = { nome: string; nicho_id: string; usuario_ids: string[] }

export default function ModalEquipe({
  aberto,
  equipe,
  nichos,
  equipes,
  pessoas,
  ocupado = false,
  onFechar,
  onSalvar,
}: {
  aberto: boolean
  /** `null` = criar. Preenchido = editar (nicho e membros ficam fora). */
  equipe: EquipeArea | null
  nichos: Nicho[]
  /** Todas as equipes, para saber quais nichos já estão ocupados. */
  equipes: EquipeResumo[]
  pessoas: PessoaArea[]
  ocupado?: boolean
  onFechar: () => void
  onSalvar: (dados: DadosEquipe) => Promise<void> | void
}) {
  const editando = Boolean(equipe)
  const [nome, setNome] = useState('')
  const [nichoId, setNichoId] = useState('')
  const [selecionados, setSelecionados] = useState<string[]>([])

  // Reabrir o modal nunca pode mostrar o rascunho do anterior: no modo edição os campos vêm da
  // equipe aberta; na criação, vazios.
  useEffect(() => {
    if (!aberto) return
    setNome(equipe?.nome || '')
    setNichoId(equipe ? String(equipe.nicho_id || '') : '')
    setSelecionados([])
  }, [aberto, equipe])

  const ocupados = useMemo(() => nichosOcupados(equipes, equipe ? String(equipe.id) : null), [equipes, equipe])
  const disponiveis = useMemo(() => pessoas.filter((p) => p.ativo !== false), [pessoas])

  // Na edição o nicho não é enviado; a validação pede os dois, então usamos o valor atual só
  // para ela passar. Quem valida de verdade é o backend.
  const validacao = validarFormulario({ nome, nicho_id: editando ? 'mantido' : nichoId })
  const conflito = editando ? null : conflitosDaSelecao(disponiveis, selecionados, null)
  const podeSalvar = validacao.ok && !conflito

  async function salvar() {
    if (!podeSalvar) return
    await onSalvar({ nome: nome.trim(), nicho_id: nichoId, usuario_ids: selecionados })
  }

  return (
    <FolhaModal
      aberto={aberto}
      titulo={editando ? 'Editar equipe' : 'Nova equipe'}
      descricao={
        editando
          ? 'Corrija o nome da equipe. O nicho e a composição têm caminhos próprios.'
          : 'Cada equipe trabalha um nicho. Quem entra nela passa a ver apenas os leads daquele nicho.'
      }
      tamanho="md"
      onFechar={onFechar}
      rodape={
        <>
          {/* Botão desabilitado nunca fica mudo — o motivo vem do módulo puro. */}
          {!podeSalvar && (
            <span className="mr-auto text-xs text-ink-3">{conflito || validacao.motivo}</span>
          )}
          <Botao variante="secundaria" onClick={onFechar}>Cancelar</Botao>
          <Botao
            variante="primaria"
            onClick={salvar}
            carregando={ocupado}
            disabled={!podeSalvar}
            motivoDesabilitado={conflito || validacao.motivo || ''}
          >
            {editando ? 'Salvar alterações' : 'Criar equipe'}
          </Botao>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Nome da equipe" obrigatorio ajuda="Como a equipe aparece para o time.">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={LIMITE_NOME}
            placeholder="Ex.: Time Energia Solar"
          />
        </Campo>

        {editando ? (
          // Bloqueado COM o motivo: o campo some deixaria o gestor procurando onde troca o
          // nicho. Ele está aqui, visível, dizendo por que não se mexe.
          <Campo
            etiqueta="Nicho"
            ajuda="O nicho não muda: é ele que recorta a carteira de todos os membros. Para trocar, encerre esta equipe e crie outra."
          >
            <input value={equipe?.nicho_nome || 'sem nome'} disabled readOnly />
          </Campo>
        ) : (
          <Campo etiqueta="Nicho" obrigatorio ajuda="Um nicho tem no máximo uma equipe ativa.">
            <select value={nichoId} onChange={(e) => setNichoId(e.target.value)}>
              <option value="">Escolha o nicho…</option>
              {nichos.map((n) => (
                <option key={n.id} value={n.id} disabled={ocupados.has(String(n.id))}>
                  {n.nome}
                  {ocupados.has(String(n.id)) ? ' — já tem equipe ativa' : ''}
                </option>
              ))}
            </select>
          </Campo>
        )}
      </div>

      {/* ── Membros iniciais: só na criação ───────────────────────────────────────────── */}
      {!editando && (
        <fieldset className="mt-5">
          <legend className="text-xs font-medium text-ink-2">Membros iniciais (opcional)</legend>
          <p className="mt-0.5 text-xs text-ink-3">
            Dá para criar a equipe vazia e adicionar depois. Enquanto não houver ninguém, ela não
            recorta a carteira de pessoa alguma.
          </p>
          {disponiveis.length === 0 ? (
            <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-3">
              Nenhuma pessoa com acesso ativo nesta empresa. Adicione contas em Configurações ›
              Contas da empresa.
            </p>
          ) : (
            <ul className="mt-2 grid max-h-60 gap-1 overflow-y-auto sm:grid-cols-2">
              {disponiveis.map((p) => {
                const st = estadoDaPessoa(p, null)
                const id = String(p.usuario_id)
                return (
                  <li key={id}>
                    <label
                      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                        st.disponivel
                          ? 'border-line hover:bg-surface-2'
                          : 'border-line bg-surface-2 text-ink-3'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selecionados.includes(id)}
                        disabled={!st.disponivel}
                        onChange={() =>
                          setSelecionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
                        }
                        className="mt-0.5 h-4 w-4 rounded border-line-strong text-brand focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{p.nome || 'Sem nome'}</span>
                        {/* Quem já está em outra equipe aparece bloqueado COM o nome dela — é a
                            informação que o 409 do backend não dá. */}
                        {st.aviso && <span className="block text-[11px] text-estado-warn">{st.aviso}</span>}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </fieldset>
      )}
    </FolhaModal>
  )
}
