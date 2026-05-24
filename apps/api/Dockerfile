FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3001

# Try to apply pending migrations on boot, but DO NOT block the API
# from starting if migrate fails. Without the `|| true` fallback, a
# single broken migration (or a fresh DB that wasn't initialized via
# Prisma in the first place) hangs the API forever — the previous
# deploy ended up with the worker holding zero assets in memory because
# migrate deploy errored and `&&` short-circuited `npm run start`.
# Output is captured for the EasyPanel log even on failure.
CMD sh -c "npx prisma migrate deploy 2>&1 || echo '[boot] migrate deploy failed; starting API anyway' ; npm run start"
