FROM node:20-alpine
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build && npm prune --omit=dev
ENTRYPOINT ["node", "dist/index.js"]
