FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
EXPOSE 8080
ENV NODE_ENV=production PORT=8080
CMD ["node", "--import", "tsx", "src/server.ts"]
