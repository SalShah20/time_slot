# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Production build + type-check (run this to verify changes compile)
npm run lint     # ESLint check
```

There are no automated tests. Verify changes by running `npm run build` — Next.js build fails on TypeScript and ESLint errors.

## Environment

Requires `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_PLACEHOLDER_USER_ID=   # UUID used instead of real auth
```

There is no user authentication. Every DB query hard-codes `PLACEHOLDER_USER_ID` from `lib/supabase.ts`.

## Architecture

**TimeSlot** is a task scheduling + timer app. Users add tasks, which are auto-scheduled into today's calendar. They can then start a timer against any pending task.

### Page layout (`app/page.tsx`)

Full-screen three-zone layout:
1. **Header** — logo, Google Calendar placeholder button, "Start Timer" button
2. **Stats bar** — `StatsCards` polls `/api/tasks/stats` every 30s
3. **Two-column main** — left: `TaskForm` (always-visible inline panel), right: `ScheduleView` (today's hourly calendar)

Floating overlays: `CornerTimerWidget` (active timer only), `TimerSelector` modal (task picker), `CompletionPopup` (post-completion stats).

### Timer state machine (`lib/timerService.ts`)

The timer is a client-side singleton backed by **localStorage** (key: `timeslot_timer`) with a 30-second background sync to Supabase. States: `WORKING → PAUSED → WORKING`, `WORKING → ON_BREAK → WORKING`. Elapsed time is always derived from wall-clock timestamps, never from a counter.

Key invariant: **localStorage is authoritative**. All state mutations write to localStorage first, then fire API calls fire-and-forget. The next `/api/timer/sync` call corrects any DB divergence.

`CornerTimerWidget` calls `timer.restoreTimerOnLoad()` on mount (handles stale breaks >2h) and drives a 1-second `setInterval` to re-read display state. It renders `null` when idle — the "Start Timer" button in the header opens `TimerSelector` instead.

### Auto-scheduling (`app/api/tasks/create/route.ts`)

Simple v1: new tasks are placed immediately after the last scheduled task today (or at `now` if the calendar is empty). If no room before 9pm, it schedules for 8am the next day. `scheduled_end = scheduled_start + estimated_minutes`. A proper free-slot algorithm (Phase 4) will replace this.

### Database schema

Three tables in Supabase:
- **`tasks`** — `title, description, tag, priority, estimated_minutes, actual_duration, deadline, scheduled_start, scheduled_end, status`
- **`active_timers`** — one row per user (UNIQUE on `user_id`). Upserted on timer start.
- **`timer_sessions`** — individual work/break segments; bulk-inserted on task completion.

Migrations are in `supabase/migrations/` and must be run manually in the Supabase SQL editor (not via CLI). Run them in order: `001` → `002` → `003`.

### Color system

Custom Tailwind palette in `tailwind.config.ts`:
- `teal-{50–900}` — primary brand colors (`teal-600` = `#027381` is the main action color)
- `surface-{50–900}` — neutral grays for backgrounds, borders, text

Use `teal-600` / `hover:teal-700` for primary buttons. Use `surface-*` for all neutral UI.

## Planned features (not yet implemented)

- **Google Calendar** (Phase 3): OAuth 2.0 `calendar.readonly`, cache events in a `calendar_events` table, display as read-only blocks in `ScheduleView`
- **LLM duration estimation** (Phase 4): OpenAI call when user submits without a manual duration estimate; stored with `llm_estimated = true`
- **Smart auto-scheduling** (Phase 4): Replace the simple append logic with a real free-slot finder that respects Google Calendar events and deadlines
