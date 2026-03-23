# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MECS (Membership Criteria Eligibility System) is a backend API that evaluates Roblox users against membership criteria for a Roblox group. It checks user eligibility (account age, badges, friends, accessories, group membership, blacklist status) and can automatically rank users in the group based on results. It also processes and audits group ranking decisions made by staff officers.

## Commands

- **Build:** `pnpm build` (runs `tsc`)
- **Dev:** `pnpm dev` (runs `tsx watch src/index.ts`)
- **Start:** `pnpm start` (builds then runs `node dist/index.js`)
- **Install:** `pnpm install`

There are no test scripts configured.

## Architecture

The app is a **Fastify** server (ESM, TypeScript) that:

1. **Evaluates Roblox users** (`ImmigrationUser`) against eligibility criteria by fetching data from multiple Roblox API endpoints (users, groups, friends, badges, inventory). Supports an optional Cloudflare Worker proxy mode (`config.proxy.enabled`) that consolidates these API calls.

2. **Manages blacklists** (`scraper.ts`) sourced from either an external endpoint (`EXTERNAL_BLACKLIST_ENDPOINT`) or Google Docs spreadsheets. Blacklists cover both individual users and groups.

3. **Audits staff decisions** (`AuditAccuracy.ts`) by processing Roblox group audit logs, re-evaluating each ranking decision, and storing results in Postgres. Computes per-officer Decision Accuracy Rate (DAR) and Mode Time Between Decisions (MTBD).

4. **Persists data** in PostgreSQL (`postgres.ts`) using the `pg` library with a single table `mecs.action_log`. The `Pool` is configured via standard `PG*` env vars.

### Key data flow

- `index.ts` → `GET /user/:id` → resolves user via Roblox API or DB lookup → creates `ImmigrationUser` → runs eligibility tests → returns results + logs to Discord webhook
- `index.ts` → `POST /user/:id/automated-review` → evaluates + ranks user in the Roblox group
- `AuditAccuracy.ts` → `processAuditLogs()` → pages through Roblox group audit log → re-evaluates each decision → writes to Postgres
- Several caches (aggregate data, officer decisions, blacklists, time case stats) refresh on 5-minute intervals

### Request concurrency

Requests are serialized using `p-limit(1)` with separate limiters for manual (browser-origin) vs automated requests.

### Authentication

- **Roblox API:** Authenticated via `.ROBLOSECURITY` cookies loaded from a `cookies.json` file at project root. Cookies have role flags (`audit`, `rank`) for different operations. CSRF tokens are fetched and managed per-cookie (`csrf.ts`).
- **Google Docs:** Service account credentials via `GOOGLEAUTH` env var.
- **Discord:** Webhook ID/token for logging requests.

## Environment

Requires a `.env` file (see `.env.example`). Key variables: `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` for Postgres; `GOOGLEAUTH` for Google Docs access; `DISCORD_WEBHOOK_ID`/`DISCORD_WEBHOOK_TOKEN` for logging; `EXTERNAL_BLACKLIST_ENDPOINT` for external blacklist source.

Also requires a `cookies.json` file at project root with Roblox `.ROBLOSECURITY` cookies.

## API Endpoints

- `GET /health` — health check
- `GET /user/:id` — evaluate user eligibility (query: `blacklistOnly`, `includeHistory`, `paramType`)
- `POST /user/:id/automated-review` — evaluate and rank user
- `GET /blacklist/groups` / `GET /blacklist/users` — list blacklisted entities
- `GET /audit/accuracy` — aggregate audit accuracy stats
- `GET /audit/staff` — per-officer audit data
- `GET /audit/staff/:id` — specific officer audit data
- `GET /stats/case` — monthly case statistics
- `GET /session` — session info and request counter

## TypeBox Schema Validation

Route schemas use `@fastify/type-provider-typebox` for request validation and type inference. The underlying `typebox` package is v1.x (the successor to `@sinclair/typebox`), where schemas are strict by default — do **not** use `Type.Strict()` (it no longer exists). Note: routes that access `req.headers` require an explicit `headers: Type.Object({})` in the schema for type inference to work.
