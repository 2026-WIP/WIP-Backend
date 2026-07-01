# WIP Backend

Express, TypeScript, MySQL, and Socket.io backend for WIP.

## Quick Start on Windows

Requirements:

- Node.js
- MySQL Server 8.x installed locally

Start the API server:

```bash
npm run start
```

This first starts the project-owned MySQL development instance on the port from
`DATABASE_URL` (3306 by default), prepares the configured database, builds the
TypeScript output, and then starts the API server.

The API is available at `http://localhost:3000/api`.

## Docker Alternative

Docker users can run:

```bash
docker compose up -d
```

The Docker database listens on `localhost:3306`. Override `DATABASE_URL` when
using it:

```txt
DATABASE_URL=mysql://wip:wip_password@localhost:3306/wip_dev
```

## Commands

```bash
npm run db:local
npm run dev
npm run build
npm start
```

Health check:

```bash
curl http://localhost:3000/api/health
```

The server creates missing development tables on startup. Current features
include auth and refresh tokens, channels, messages, threads, DMs, friends,
snippets, the runner mock, and authenticated Socket.io channel events.
