FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs create-codes.mjs ./

ENV PORT=3210
ENV LIGHTCLEAN_LICENSE_DB=/data/licenses.db

VOLUME ["/data"]
EXPOSE 3210

CMD ["node", "server.mjs"]
