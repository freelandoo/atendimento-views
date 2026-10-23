-- 117_mensagem_envios.sql
-- Ledger de SAÍDA das mensagens de WhatsApp (empresa, instância, lead, autoria).
--
-- O QUE ESTA MIGRATION RESOLVE
-- "IA: 20 mensagens / Victor: 50 mensagens" não era computável neste repositório. Não existe
-- tabela de mensagens, e `vendas.conversas.historico` é JSONB TRUNCADO (os 40 últimos itens, em
-- `conversa-manual.js` e `followup-manual.js`) — contar dali mente com o tempo, e contaria pior
-- justamente nas conversas mais longas. As fontes confiáveis cobrem só pedaços: `lead_disparos`
-- é a 1ª abordagem, `followup_envios` é o follow-up, `vendas.ai_logs` são CHAMADAS de LLM (nem
-- toda chamada vira mensagem, e uma mensagem pode custar várias chamadas). A resposta
-- conversacional da IA não tinha registro durável em lugar nenhum.
--
-- O QUE A TABELA SIGNIFICA — E O QUE ELA NÃO SIGNIFICA
-- Uma linha = o provedor ACEITOU um envio nosso. NÃO é confirmação de entrega (isso é
-- `DELIVERY_ACK`/`READ`, reconciliado em `lead_disparos` para a saudação) e NÃO é tentativa:
-- tentativa que falhou não vira linha, porque afirmar envio não comprovado é exatamente o que
-- o indicador existe para não fazer.
--
-- SÓ SAÍDA, por decisão do operador (2026-10-22). Mensagem RECEBIDA continua medida pelas
-- fontes atuais (conversa/resposta), então `direcao` nasce com CHECK fechada em um único valor:
-- o valor de vocabulário nasce junto do executor (mesma disciplina de `follow_ups_canal_chk` e
-- do gatilho da comissão). Alargar a CHECK e implementar o leitor de entrada têm de ser o
-- MESMO diff.
--
-- AUTORIA É DECLARADA POR QUEM ENVIA, NUNCA DEDUZIDA
-- `autoria` responde "quem/o que ESCREVEU o texto" e `acionador_usuario_id`, "quem MANDOU
-- enviar" — são perguntas diferentes e o pedido exige distingui-las (um disparo automático
-- iniciado por uma pessoa não pode contar duas vezes, nem virar "mensagem da pessoa"). Quem não
-- declara entra como `desconhecida`: histórico sem autoria comprovada fica desconhecido, não
-- atribuído a ninguém. SEM DEFAULT em `autoria`/`tipo`/`direcao` — um DEFAULT autorizaria em
-- silêncio qualquer INSERT futuro que esquecesse a coluna (mesmo motivo de `origem_vinculo`,
-- migration 061, e de `origem`, migration 066).
--
-- NÃO GUARDA O TEXTO DA MENSAGEM. O conteúdo já vive no histórico da conversa; repeti-lo aqui
-- criaria uma segunda cópia de PII num ledger que a tela lê agregado.
--
-- A instância é o NOME técnico (`evolution_instance`), não um FK para a linha da instância:
-- é o que o enviador tem na mão no momento do envio, e resolver o id ali custaria uma consulta
-- no caminho mais quente do produto. O nome é UNIQUE em `app.empresa_whatsapp_instances`, então
-- a tela faz o join na leitura. Instância removida depois não apaga o fato de que a mensagem saiu.
--
-- ADITIVA: cria UMA tabela nova. Não altera tabela existente e não muta nenhum dado. Nada é
-- retroagido — o indicador começa a contar a partir do deploy, e a tela declara isso.
-- Rollback: DROP TABLE app.mensagem_envios.

CREATE TABLE IF NOT EXISTS app.mensagem_envios (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  -- Nome técnico da instância que enviou. NOT NULL: não existe envio sem instância provada
  -- (regra única da Fase 2) — uma linha sem instância aqui seria um envio que não aconteceu.
  evolution_instance    TEXT NOT NULL,
  -- Identidade do contato: empresa + dígitos, a mesma das migrations 062/066.
  telefone_digitos      TEXT NOT NULL CHECK (telefone_digitos ~ '^[0-9]{8,15}$'),
  -- Cache do JID da conversa, para o join com `vendas.conversas` sem renormalizar telefone.
  conversa_numero       TEXT,
  direcao               TEXT NOT NULL CHECK (direcao = 'enviada'),
  autoria               TEXT NOT NULL CHECK (autoria IN ('ia', 'pessoa', 'desconhecida')),
  -- Quem ESCREVEU (só faz sentido com autoria 'pessoa') × quem MANDOU ENVIAR (pode existir em
  -- mensagem escrita por IA: o operador que clicou "Rodar leads").
  autor_usuario_id      UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  acionador_usuario_id  UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  tipo                  TEXT NOT NULL CHECK (tipo IN (
                          'saudacao', 'resposta_ia', 'followup_auto', 'followup_manual',
                          'manual_operador', 'agenda', 'alerta_operador', 'outro'
                        )),
  -- Id da mensagem na Evolution. É a chave de idempotência: reentrega/retry não duplica a linha.
  evolution_message_id  TEXT,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Autor nomeado só é coerente com autoria 'pessoa'. Uma linha 'ia' com autor humano diria que
-- uma pessoa escreveu o que a IA escreveu.
ALTER TABLE app.mensagem_envios
  DROP CONSTRAINT IF EXISTS mensagem_envios_autor_chk;
ALTER TABLE app.mensagem_envios
  ADD CONSTRAINT mensagem_envios_autor_chk
  CHECK (autor_usuario_id IS NULL OR autoria = 'pessoa');

-- Idempotência por (empresa, id da mensagem). Parcial porque o id pode faltar: a Evolution não
-- devolve `key.id` em toda resposta, e perder o registro do envio seria pior que não deduplicá-lo.
CREATE UNIQUE INDEX IF NOT EXISTS mensagem_envios_idempotencia_uk
  ON app.mensagem_envios (empresa_id, evolution_message_id)
  WHERE evolution_message_id IS NOT NULL;

-- O recorte que a tela sempre faz: empresa + período (e, opcionalmente, instância).
CREATE INDEX IF NOT EXISTS mensagem_envios_empresa_periodo_idx
  ON app.mensagem_envios (empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS mensagem_envios_instancia_idx
  ON app.mensagem_envios (empresa_id, evolution_instance, criado_em DESC);
-- "Leads contatados" é DISTINCT por telefone, nunca contagem de mensagens.
CREATE INDEX IF NOT EXISTS mensagem_envios_contato_idx
  ON app.mensagem_envios (empresa_id, telefone_digitos);
