# Cinezoo

A full-stack live streaming platform for hosting interactive film festivals, tournaments, and community events with real-time voting, live chat, and multi-channel broadcasting.

**Live at [cinezoo.tv](https://cinezoo.tv)**

## Tech Stack

**Frontend:** React 18, TypeScript, Vite, Zustand, SASS, Bootstrap, HLS.js

**Backend:** Node.js, Express, TypeScript, PostgreSQL, Socket.io, JWT

**Mobile:** React Native, Expo

**Infrastructure:** nginx-rtmp, PM2, HLS streaming

**Architecture:** npm workspaces monorepo with a shared package for types, API clients, and stores across frontend, backend, and mobile

## Features

- **Multi-Channel Live Streaming** -- RTMP ingest via nginx-rtmp with HLS playback, stream key authentication, custom intermission screens, and channel thumbnails
- **Three Voting Modes** -- Film festival ratings (0-5 scale with weighted leaderboards), head-to-head tournament brackets, and battle royale format
- **Real-Time Chat** -- Socket.io-powered live chat per channel with message history and automatic cleanup
- **Session Management** -- Schedule and manage events with ordered film lineups, status lifecycle (scheduled/live/closed/archived), and recurrence support
- **Admin Dashboard** -- Channel creation, stream key management, festival controls, lineup editing, user role management, and media uploads
- **User System** -- JWT auth with role-based access (super_admin, network, general_user), profiles with social links, company affiliations, and awards
- **Direct Messaging** -- Private user-to-user messaging with automatic expiration
- **Configurable Widgets** -- Per-channel widget system (voting ballots, leaderboards, tournament brackets) stored as JSONB

## Database Design

PostgreSQL with 11 incremental migrations. Voting tables use hash partitioning (8 partitions each for ratings and match_votes) to handle high-concurrency scenarios during live events.

## Project Structure

```
/Cinezoo
├── backend/        Express + PostgreSQL API (12 controllers, 13 route modules)
├── frontend/       React (Vite) client (38 components across 19 directories)
├── mobile/         React Native (Expo) app
├── shared/         Shared types, API clients, stores, and utilities
├── deploy.sh       Production deployment script
├── ecosystem.config.js   PM2 process config
└── .env            Environment variables (not committed)
```

---

## Starting the App

Dev (Backend):
npx ts-node-dev src/server.ts

Dev (Frontend):
npm run dev

"scripts": {
  "dev": "ts-node-dev src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js"
}

PROD: Start prod with ./deploy.sh
PM2 is configured to auto-start on reboot via systemd
