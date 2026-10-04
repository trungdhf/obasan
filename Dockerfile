# Cloud Run image for the Hinata tablet app (static web + Node backend).
# Build context is the repo root so both backend/ and web/ are available.
FROM node:22-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev
COPY backend ./backend
COPY web ./web
ENV PORT=8080
EXPOSE 8080
CMD ["node", "backend/src/index.js"]
