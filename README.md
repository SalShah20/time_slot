# TimeSlot

AI-powered task scheduling for college students. Add your tasks, click **Schedule All**, and GPT-4o-mini automatically fits them into your free calendar time — no manual drag-and-drop needed.

## Features

- **Batch scheduling** — queue up multiple tasks and schedule them all in one AI call
- **LLM-powered slot selection** — respects deadlines, priorities, existing tasks, and Google Calendar events; no overlaps
- **Fallback scheduler** — deterministic free-slot finder kicks in when the LLM is unavailable or returns an invalid slot
- **Scheduling window** — 7 AM to 11 PM (students work late); falls back to 8 AM tomorrow if today is full
- **Calendar view** — 6 AM to midnight hourly grid with task blocks, manual busy blocks, and Google Calendar overlays
- **Timer** — start, pause, and complete tasks with a pomodoro-style corner widget
- **Google Calendar sync** — bidirectional: tasks create GCal events; GCal events block scheduling; auto-reschedules on conflict
- **Browser notifications** — 15-min task warnings, deadline reminders, 8 AM morning summary
- **Onboarding tooltip** — first-visit walkthrough for new users

## How It Works

1. **Add tasks** — tap `+`, fill in title / duration / deadline (batch mode is the default)
2. **Schedule All** — one click sends all queued tasks to the LLM, which returns non-overlapping start times
3. **Work** — start the timer, get notifications when tasks approach, mark complete with the checkmark

## Tech Stack

- **Next.js 14** (App Router) + TypeScript
- **Tailwind CSS** with custom `teal-*` and `surface-*` palettes
- **Supabase** — Postgres DB + Google OAuth auth via `@supabase/ssr`
- **OpenAI GPT-4o-mini** — LLM scheduling via the Chat Completions API
- **Google Calendar API** — OAuth 2.0, event CRUD, free/busy queries

## Setup

### 1. Clone & install

```bash
git clone <repo>
cd time_slot
npm install
```

### 2. Environment variables

Create `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
OPENAI_API_KEY=
```

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` come from GCP Console (OAuth 2.0 client).

### 3. Supabase — run migrations in order

Run each file in the Supabase SQL editor (Dashboard → SQL Editor):

| File | What it adds |
|------|-------------|
| `supabase/migrations/001_initial.sql` | Base schema (tasks, timers, sessions) |
| `supabase/migrations/002_add_scheduled_time.sql` | `scheduled_start` column |
| `supabase/migrations/003_add_task_fields.sql` | `description, tag, priority, scheduled_end` |
| `supabase/migrations/004_calendar_tables.sql` | `user_tokens`, `calendar_events` |
| `supabase/migrations/005_fix_tag_constraint.sql` | Fixes tag CHECK constraint |
| `supabase/migrations/006_calendar_blocks.sql` | `calendar_blocks` + RLS |
| `supabase/migrations/007_add_google_event_id.sql` | `google_event_id TEXT` on tasks |

### 4. Google OAuth setup

In **GCP Console → APIs & Services → Credentials → OAuth 2.0 Client**:
- Add `http://localhost:3000/api/calendar/callback` to **Authorized Redirect URIs**

In **Supabase → Authentication → Providers → Google**:
- Enable Google, paste `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- Copy the Supabase redirect URL shown → add it to GCP Authorized Redirect URIs

In **Supabase → Authentication → URL Configuration**:
- Add `http://localhost:3000/auth/callback` to **Redirect URLs**

### 5. Run

```bash
npm run dev      # http://localhost:3000
npm run build    # type-check + production build
npm run lint     # ESLint
```

## Architecture

```
app/
  page.tsx                    # Dashboard: header, stats, task list, calendar
  login/page.tsx              # Google sign-in
  auth/callback/route.ts      # OAuth code exchange
  api/
    tasks/
      create/route.ts         # Single task: LLM schedule + GCal event
      batch-create/route.ts   # Batch: one LLM call for N tasks
      reschedule/route.ts     # Post-sync conflict resolution
      [id]/complete/route.ts  # Quick-complete (no timer)
    timer/
      start|pause|sync|complete/route.ts
    calendar/
      oauth|callback|status|sync|events/route.ts
    blocks/route.ts            # Manual busy blocks

components/
  TaskDrawer.tsx              # Slide-up drawer (batch mode default)
  TaskForm.tsx                # Task creation form (queue or direct)
  ScheduleView.tsx            # Hourly calendar grid (6 AM – midnight)
  CornerTimerWidget.tsx       # Floating active timer
  TimerSelector.tsx           # Task picker modal
  OnboardingTooltip.tsx       # First-visit tooltip

lib/
  scheduleUtils.ts            # fallbackSchedule() deterministic finder
  timerService.ts             # localStorage state machine + 30s DB sync
  googleCalendar.ts           # OAuth client helpers
  tagColors.ts                # Tag → color mapping
  notifications.ts            # Browser notification helpers
```

## Scheduling Logic

1. **LLM pass** (`scheduleBatchWithLLM`): sends all tasks + busy intervals to GPT-4o-mini in one call; validates each returned slot for overlaps
2. **Per-task fallback** (`fallbackSchedule`): if the LLM slot overlaps anything, the deterministic algorithm finds the next available gap by walking forward through sorted busy intervals
3. **Newly scheduled tasks** are added to `allBusy` before scheduling the next task, preventing intra-batch overlaps
4. **Post-sync rescheduling** (`/api/tasks/reschedule`): after every Google Calendar sync, conflicting pending tasks are moved to new free slots

## Deployment

Add all `.env.local` variables to Vercel project settings, then:
```bash
vercel --prod
```
Update authorized redirect URIs in GCP and Supabase to use the production domain.
