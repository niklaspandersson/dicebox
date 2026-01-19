FROM node:24.0.2-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY server.js ./
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "server.js"]
