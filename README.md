## EGA House Platform

This repository hosts the web platform surfaces for tasks, goals, timer, and weekly review on top of Supabase SSR auth.

## Route Strategy

- Canonical workspace routes: `/tasks`, `/goals`, `/timer`, `/review`
- `/apps/*` routes are compatibility redirects only:
- `/apps/tasks` -> `/tasks`
- `/apps/goals` -> `/goals`
- `/apps/timer` -> `/timer`
- `/apps/review` -> `/review`
- `/apps` redirects to `/tasks`

Both root-domain routes and protected workspace subdomains are guarded by middleware and redirect unauthenticated users to `/login?next=...`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Tests

- Cookie-domain/session option checks: `npm run test:session`
- Timer conflict recovery unit tests: `npm run test:timer-recovery`
- Real cross-subdomain auth/session browser test: `npm run test:auth-session:e2e`

The e2e auth test requires credentials and host config:

- `E2E_AUTH_EMAIL`
- `E2E_AUTH_PASSWORD`
- Optional: `E2E_AUTH_PROTOCOL`, `E2E_AUTH_PLATFORM_DOMAIN`, `E2E_AUTH_LOGIN_HOST`, `E2E_AUTH_TASKS_HOST`, `E2E_AUTH_GOALS_HOST`, `E2E_AUTH_TIMER_HOST`, `E2E_AUTH_REVIEW_HOST`

## Learn More


[Next.js Documentation](https://nextjs.org/docs)
