# ROES back end

Bun + TypeScript + Hono + Sequelize (MySQL).

## Setup

1. Create `.env` from `.env.example` and fill in your MySQL credentials (MySQL Workbench works for creating the schema), `JWT_SECRET` and the mayor account.
2. `CREATE DATABASE roes CHARACTER SET utf8mb4;` (Workbench or `mysql`).
3. `bun install`
4. `bun run dev` (or `bun run start`). Tables are created automatically when `DB_SYNC=true`; the mayor account is created on first start from `MAYOR_*`.
5. `bun test` runs the integration suite against `TEST_DB_*` (defaults to `127.0.0.1:3307`, database `roes_test`, which is wiped).

Set `SMTP_*` to send verification and password-reset emails. In development without SMTP the message is printed to the server console; in production SMTP is required.

## API

- `POST /api/auth/login | code | code/verify | register | reset | password`, `GET /api/auth/places`
- `/api/mayor/*` mayor website (requires the mayor role)
- `/api/app/*` mobile app for admins and residents
- `GET /api/media/users/:id`, `/api/media/donations/:id`
