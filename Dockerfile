# One image: the built client, and the server that serves it and runs the games.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
COPY client/package.json client/package-lock.json client/
RUN cd client && npm ci --include=dev
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY shared shared
COPY client client
COPY server server
RUN cd client && npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=build /app/shared shared
COPY --from=build /app/server server
COPY --from=build /app/client/dist client/dist
WORKDIR /app/server
EXPOSE 3001
# (node itself, not npm: a stop signal reaches the server, which saves before it goes)
CMD ["node", "--import", "tsx", "index.ts"]
