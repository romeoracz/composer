# Onboarding

## Prerequisites
- Node 20+
- Docker (for local compose)

## Local Development (memory drivers)
- npm ci
- npm run dev
- API runs at :4000, Web at :3000

## Docker Compose (Prisma + BullMQ)
- docker-compose up
- Visit http://localhost:3000

## Environment
- See apps/api/.env.sample for variables
- Drivers:
  - DB_DRIVER: memory|prisma
  - QUEUE_DRIVER: memory|bullmq

## Useful Commands
- npm run dev (all workspaces)
- npm run build
- GitHub Actions CI runs smoke and security scans
