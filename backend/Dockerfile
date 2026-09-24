# Imagem de PRODUCAO (Railway, Root Directory = backend/).
#
# ── POR QUE `npm ci --omit=dev` E NAO `npm install` ──────────────────────────────────────
# `npm install` RESOLVE as versoes de novo a cada build: ele pode subir de patch/minor dentro
# do range do package.json e ATUALIZA o lockfile. O efeito e' que a imagem que sobe em
# producao nao e' necessariamente a que foi testada — o CI roda `npm ci` (lockfile exato) e o
# deploy rodava outra coisa. `npm ci` instala EXATAMENTE o lockfile e falha alto se ele
# divergir do package.json, que e' o comportamento certo num build de producao.
#
# `--omit=dev` deixa de fora `typescript` e `@types/node`, que so' servem ao `npm run
# typecheck`. Nenhum codigo de runtime os importa.
#
# ⚠️ NAO declaramos `ENV NODE_ENV=production` aqui, de proposito. Nesta aplicacao essa
# variavel nao e' so' rotulo: ela LIGA cookie Secure e SSL do banco (ver AGENTS.md). Quem a
# define e' o ambiente da Railway; fixa-la na imagem mudaria comportamento de producao a
# partir de um arquivo de build. Por isso o `--omit=dev` e' explicito, e nao herdado dela.
#
# ── O `RUN npm install pg` QUE SAIU DAQUI ────────────────────────────────────────────────
# `pg` SEMPRE esteve em `dependencies` (hoje ^8.20.0). Aquela linha nao acrescentava nada e
# ainda instalava a versao mais NOVA por cima da que o lockfile fixa — ou seja, o unico efeito
# real era furar o lockfile justamente no driver do banco.
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY public/ ./public/
COPY prompts/ ./prompts/
COPY knowledge/ ./knowledge/
COPY sql/ ./sql/

CMD ["node", "index.js"]
