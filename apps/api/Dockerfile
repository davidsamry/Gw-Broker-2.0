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

# Run pending migrations BEFORE starting the API. Without this step,
# `prisma migrate dev` files added to the repo never reach production —
# the schema and code drift apart silently. `migrate deploy` is the
# production-safe variant: applies pending migrations idempotently and
# never prompts.
CMD sh -c "npx prisma migrate deploy && npm run start"
