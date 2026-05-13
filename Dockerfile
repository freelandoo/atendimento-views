FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.js ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY public/ ./public/
COPY prompts/ ./prompts/
COPY knowledge/ ./knowledge/
COPY sql/ ./sql/
EXPOSE 3000
CMD ["node", "index.js"]
