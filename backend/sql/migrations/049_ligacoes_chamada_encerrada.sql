-- 049_ligacoes_chamada_encerrada.sql
-- Centro de Ligacoes — Validacao Operacional (bloqueador: duracao contaminada).
-- Ate aqui `duracao_seg` era NOW() - iniciada_em calculado NO MOMENTO do POST /encerrar.
-- Como o botao "Encerrar ligacao" do cockpit apenas ABRE o formulario de resumo, todo o
-- tempo de preenchimento (resultado, status, objecao, motivo, proxima acao, data) entrava
-- na duracao da ligacao E na duracao da ultima etapa — inflando "tempo medio de ligacao" e
-- "tempo por etapa" de forma NAO comparavel entre operadores rapidos e lentos no registro.
--
-- Esta coluna marca o instante REAL em que a CHAMADA terminou (clique em "Encerrar"),
-- separado de `encerrada_em`, que passa a significar "quando o registro foi salvo".
-- A diferenca entre os dois vira metrica de atrito de preenchimento na view analitica.
--
-- Aditiva e retrocompativel: quando NULL, encerrarLigacao cai para NOW() (comportamento
-- atual preservado para clientes antigos / ligacoes iniciadas antes deste deploy).

ALTER TABLE app.ligacoes ADD COLUMN IF NOT EXISTS chamada_encerrada_em TIMESTAMPTZ;

COMMENT ON COLUMN app.ligacoes.chamada_encerrada_em IS
  'Instante em que a CHAMADA terminou (clique em Encerrar). encerrada_em = instante em que o registro foi salvo. duracao_seg usa COALESCE(chamada_encerrada_em, NOW()) - iniciada_em.';
