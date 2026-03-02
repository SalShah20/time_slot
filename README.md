# TimeSlot

A task scheduling and timer app for college students. Add tasks, let the LLM schedule them into your calendar, then start a focused timer against any pending task.

## Features

- LLM-powered scheduling (GPT-4o-mini) that places tasks into your day intelligently
- Google Calendar integration — tasks appear as GCal events and real calendar events are respected
- Batch task creation — queue multiple tasks and schedule them all in one LLM call
- Focus timer with work/break tracking and session history
- Scheduling respects deadlines: preferred window is 7 AM – 11 PM, but tasks can be placed up to 3 AM as a last resort when earlier slots are full (college students work late)
- Browser notifications for upcoming tasks, deadline warnings, and a morning summary

## Setup

### Prerequisites

- Node.js 18+
- A Supabase project
- A Google Cloud project with the Calendar API enabled
- An OpenAI API key (optional — falls back to deterministic scheduling without it)

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Create `.env.local` at the project root:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
OPENAI_API_KEY=
```

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` come from the GCP OAuth 2.0 credentials file.

### 3. Supabase

1. Run migrations in order in the Supabase SQL editor (files are in `supabase/migrations/`):
   - `001_initial.sql`
   - `002_add_scheduled_time.sql`
   - `003_add_task_fields.sql`
   - `004_calendar_tables.sql`
   - `005_fix_tag_constraint.sql`
   - `006_calendar_blocks.sql`
   - `007_add_google_event_id.sql`
2. Enable the Google provider under Auth > Providers and add your OAuth credentials.
3. Add `http://localhost:3000/auth/callback` to Auth > URL Configuration > Redirect URLs.

### 4. Google Calendar OAuth

1. In GCP Console, add `http://localhost:3000/api/calendar/callback` as an authorized redirect URI for your OAuth client.
2. Copy the client ID and secret into `.env.local`.

### 5. Run

```bash
npm run dev   # http://localhost:3000
```

## Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build + TypeScript check
npm run lint     # ESLint
```

There are no automated tests. Run `npm run build` to verify changes compile before committing.

## Scheduling logic

Tasks are scheduled by GPT-4o-mini using the existing calendar and task context. If the API key is missing or the LLM returns an invalid result, a deterministic fallback (`lib/scheduleUtils.ts`) is used.

**Scheduling window:**
- Preferred: 7 AM – 11 PM
- Last resort (packed day / tight deadline): 11 PM – 3 AM
- Hard blackout: 3 AM – 7 AM (never scheduled)

The fallback algorithm walks forward from now+10 minutes, skipping over busy intervals, and falls back to 7 AM the following day only when no slot exists through 3 AM.

## Architecture overview

See `CLAUDE.md` for a detailed breakdown of every component, API route, database schema, and key design decisions.

## Deployment

Deploy to Vercel and add all `.env.local` variables to the Vercel project settings. The PWA service worker is generated automatically on build (`public/sw.js`). Replace `public/icon.svg` with real PNG icons (`public/icon-192.png`, `public/icon-512.png`) before publishing.
