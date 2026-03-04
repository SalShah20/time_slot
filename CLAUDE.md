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
GOOGLE_CLIENT_ID=                  # from google-calendar-mcp/gcp-oauth.keys.json
GOOGLE_CLIENT_SECRET=              # from google-calendar-mcp/gcp-oauth.keys.json
NEXT_PUBLIC_APP_URL=http://localhost:3000
OPENAI_API_KEY=                    # for LLM-powered scheduling (GPT-4o-mini)
```

## Authentication

Supabase Auth with Google OAuth. `middleware.ts` protects all routes — unauthenticated users are redirected to `/login`. The auth flow is:
1. `/login` — Google sign-in button
2. `/auth/callback` — Supabase OAuth code exchange, then redirect to `/`

Server-side: use `getAuthUser()` from `lib/supabase-server.ts` in API routes. It returns the authenticated user or `null`. All DB queries are scoped to `user.id`.

Client-side: `supabase.auth.getSession()` + `onAuthStateChange` in `app/page.tsx`.

## Architecture

**TimeSlot** is a task scheduling + timer app. Users add tasks, which are auto-scheduled into their calendar using an LLM. They can then start a timer against any pending task.

### Page layout (`app/page.tsx`)

Full-screen layout:
1. **Header** — logo, Google Calendar status button (connect/sync/reconnect), beta "Feedback Form" link (amber, opens Google Form in new tab), "Start Timer" button, user avatar/menu
2. **Stats bar** — `StatsCards` polls `/api/tasks/stats` every 30s
3. **Two-column main** — left: upcoming task list with quick-complete checkmarks; right: `ScheduleView` (hourly calendar with task blocks and GCal event overlays)
4. **FAB** (`+` button, bottom-right) — opens `TaskDrawer`

Floating overlays:
- `CornerTimerWidget` — active timer controls (renders `null` when idle)
- `TimerSelector` — modal task picker (opens from "Start Timer")
- `CompletionPopup` — post-completion stats
- `TaskDrawer` — slide-up drawer; **batch mode is the default** (resets to batch on every close)
- `TaskEditModal` — edit title/deadline/duration/tag of an existing pending task; clicking any task in the sidebar opens it; saving calls `PATCH /api/tasks/[id]` and re-fetches tasks
- `OnboardingTooltip` — first-visit tooltip (localStorage key `ts_onboarding_seen`; shown after 1.5s)

### State management in `app/page.tsx`

#### `fetchBlocks` — stable identity + AbortController
`fetchBlocks` has an **empty `useCallback` dependency array** and reads the current date from a `selectedDateRef` ref (kept in sync via `useEffect`). This makes `fetchBlocks` identity-stable, which in turn stabilises `syncCalendar`, `handleManualSync`, and the 5-minute sync interval (they no longer restart on every date change).

An **`AbortController`** (`fetchBlocksAbortRef`) is created on every `fetchBlocks` call and immediately aborts any previous in-flight request. This prevents stale responses from overwriting fresh data — the last call always wins.

#### `blocksCache` — per-date calendar block cache
`blocks` state was replaced with `blocksCache: Record<YYYY-MM-DD, CalendarBlock[]>`. The active `blocks` for the current date is derived as:
```typescript
const blocksDateKey = `${selectedDate.getFullYear()}-...`;
const blocks = blocksCache[blocksDateKey] ?? [];
```
This means navigating back to a previously-visited date shows cached data instantly while the network refresh is in flight — no blank flash. `handleAddBlock` writes into the correct date's cache entry; `handleDeleteBlock` filters across all entries.

### LLM Auto-scheduling (`app/api/tasks/create/route.ts`, `lib/scheduleUtils.ts`)

New tasks are scheduled via `scheduleWithLLM()`:
1. Fetches existing tasks + Google Calendar events for today + tomorrow as context
2. Calls GPT-4o-mini with a structured prompt (preferred 8am–11pm, last resort up to 3am, hard blackout 3am–8am, no overlaps, respect deadlines, start ≥10 min from now)
3. **Validates** the LLM result against `busyIntervals` — if the result overlaps anything, it falls back automatically
4. Falls back to `fallbackSchedule()` (deterministic free-slot finder) if: API key missing, LLM errors, or overlap detected

`fallbackSchedule()` in `lib/scheduleUtils.ts`: sorts busy intervals, walks forward from now+10min to find the first free gap. Scheduling window priority:
1. **Preferred**: 8 AM – 11 PM
2. **Last resort**: 11 PM – 3 AM (used only when earlier slots are fully booked, e.g. a packed day with an imminent deadline)
3. **Hard blackout**: 3 AM – 8 AM (never scheduled)

Falls back to 8 AM the next day only when all slots through 3 AM are also unavailable.

Key constant: `WORK_START_HOUR = 8` in `lib/scheduleUtils.ts`. Both LLM prompts (`create` and `batch-create`) and the validation checks in `create/route.ts` all use 8 AM as the earliest allowed start.

### Batch Scheduling (`app/api/tasks/batch-create/route.ts`, `components/TaskDrawer.tsx`)

Users can queue multiple tasks and schedule them all at once:
- `TaskDrawer` has a "Batch" toggle — in batch mode, form collects tasks into a local queue without API calls
- Clicking "Schedule All N Tasks" calls `POST /api/tasks/batch-create`
- The batch API fetches busy intervals **once**, then makes **one LLM call** for all tasks together (fewer API calls than N individual creates)
- Each LLM result is validated for overlaps; falls back per-task if needed
- All tasks are bulk-inserted in one DB call; GCal events are created in parallel

### Google Calendar integration (`lib/googleCalendar.ts`, `app/api/calendar/`)

OAuth 2.0 via `googleapis`. Credentials in `google-calendar-mcp/gcp-oauth.keys.json`, referenced by env vars.

**Shared helpers in `lib/googleCalendar.ts`:**
- `createOAuthClient()` — builds an `OAuth2Client`
- `getCalendarClient(supabase, userId)` — fetches stored tokens, returns authenticated `calendar` client or `null` if not connected
- `deleteCalendarEvent(calendar, eventId)` — non-fatal event deletion (logs on error)

**API routes:**
- `GET /api/calendar/oauth` — redirects to Google consent screen
- `GET /api/calendar/callback` — exchanges code for tokens, stores in `user_tokens`, triggers sync
- `GET /api/calendar/status` — returns `{ connected: bool }`
- `POST /api/calendar/sync` — fetches today+tomorrow events from Google, upserts `calendar_events`; auto-persists refreshed tokens
- `GET /api/calendar/events` — returns cached `calendar_events` for today (not used by the app directly; app uses `/api/blocks`)

**GCal event lifecycle (full):**
- **Create**: when a task is created, a GCal event is inserted and the returned `event.id` is stored in `tasks.google_event_id`
- **Reschedule**: `POST /api/tasks/reschedule` deletes the old GCal event and inserts a new one; updates `tasks.google_event_id`
- **Complete**: both `/api/timer/complete` and `/api/tasks/[id]/complete` delete the GCal event using the stored `google_event_id`
- All GCal operations are non-fatal — task operations succeed even if GCal calls fail

**Auto-resync:** `app/page.tsx` syncs GCal every 5 minutes when connected, then calls `POST /api/tasks/reschedule` to fix any conflicts that appeared.

**Setup checklist:**
1. Run all migrations through `007` in the Supabase SQL editor
2. Add `http://localhost:3000/api/calendar/callback` as an authorized redirect URI in GCP Console
3. Add `http://localhost:3000/auth/callback` to Supabase Auth → URL Configuration → Redirect URLs

### Calendar blocks (`app/api/blocks/`, `components/ScheduleView.tsx`)

Users can add manual busy blocks from `ScheduleView` (right panel). Stored in `calendar_blocks` table. Also mirrored to GCal if connected. Accepts `?date=YYYY-MM-DD&timezone=IANA_TZ` query params.

**Deduplication logic in `GET /api/blocks`:**
The endpoint merges two sources — `calendar_blocks` (manual) and `calendar_events` (synced GCal). To prevent double-rendering, it runs three parallel queries and applies two exclusion filters before returning:
1. **Task-owned events**: fetches all `tasks.google_event_id` for the user and excludes any `calendar_event` whose `google_event_id` matches — these are already rendered as task blocks in `ScheduleView`.
2. **Start-time collision**: excludes any GCal event whose start time exactly matches a manual block (legacy safety net for blocks mirrored to GCal before the `google_event_id` approach).

### Conflict rescheduling (`app/api/tasks/reschedule/route.ts`)

Called after every calendar sync. Fetches pending tasks for today+tomorrow, checks each against GCal busy events, and for any conflict: finds a new free slot with `fallbackSchedule()`, deletes the old GCal event, creates a new one, and updates the task in DB.

### Timer state machine (`lib/timerService.ts`)

Client-side singleton backed by **localStorage** (key: `timeslot_timer`) with 30-second background sync to Supabase. States: `WORKING → PAUSED → WORKING`, `WORKING → ON_BREAK → WORKING`. Elapsed time is derived from wall-clock timestamps, never from a counter.

Key invariant: **localStorage is authoritative**. All mutations write to localStorage first; API calls are fire-and-forget. The next `/api/timer/sync` corrects any DB divergence.

`CornerTimerWidget` calls `timer.restoreTimerOnLoad()` on mount (auto-ends stale breaks >2h) and drives a 1-second `setInterval` to refresh display state.

**Timer API routes:**
- `POST /api/timer/start` — upserts `active_timers`
- `POST /api/timer/pause` — updates timer state
- `POST /api/timer/sync` — keeps DB in sync with localStorage state
- `POST /api/timer/complete` — marks task completed, deletes `active_timers` row, bulk-inserts `timer_sessions`, deletes GCal event

### Browser Notifications (`lib/notifications.ts`, `app/page.tsx`)

Three notification types, all using localStorage keys to prevent duplicates:
- **15-minute warning**: `checkTaskStartingSoon(tasks)` — fires when a pending task's `scheduled_start` is 13–17 min away. Called every minute via `setInterval`.
- **Deadline warning**: `checkDeadlineApproaching(tasks)` — fires if a non-completed task's deadline is tomorrow. Called on task load/change.
- **Morning summary**: `sendMorningSummary(tasks, dateKey)` — fires at 8am with today's task count and first task. Handled via `setTimeout` until 8am if page loads before then.

Permission is requested once on mount via `requestPermission()`.

### Database schema

Six tables in Supabase (migrations in `supabase/migrations/`, run manually in order):

| Table | Key columns |
|-------|-------------|
| `tasks` | `id, user_id, title, description, tag, priority, estimated_minutes, actual_duration, deadline, scheduled_start, scheduled_end, status, google_event_id` |
| `active_timers` | `user_id (UNIQUE), task_id, state, started_at, paused_at, current_break_started_at, total_break_seconds` |
| `timer_sessions` | `task_id, user_id, type (work/break), started_at, ended_at, duration` |
| `user_tokens` | `user_id, google_access_token, google_refresh_token, google_token_expiry` |
| `calendar_events` | `user_id, google_event_id, title, start_time, end_time, is_busy` — read-only GCal cache |
| `calendar_blocks` | `user_id, title, start_time, end_time, is_busy` — user-created manual blocks |

**Migration order** (run in Supabase SQL editor, not CLI):
1. `001_initial.sql` — base schema
2. `002_add_scheduled_time.sql` — adds `scheduled_start`
3. `003_add_task_fields.sql` — adds `description, tag, priority, scheduled_end`
4. `004_calendar_tables.sql` — adds `user_tokens`, `calendar_events`
5. `005_fix_tag_constraint.sql` — fixes tag CHECK constraint
6. `006_calendar_blocks.sql` — adds `calendar_blocks` + RLS
7. `007_add_google_event_id.sql` — adds `google_event_id TEXT` to `tasks`

### Tag / color system

`lib/tagColors.ts` maps tag names → `{ hex, bg, text, border, gcalColorId }`. Tags: Study, Work, Personal, Exercise, Health, Social, Errands, Other.

Custom Tailwind palette in `tailwind.config.ts`:
- `teal-{50–900}` — primary brand (`teal-600` = `#027381` is the main action color)
- `surface-{50–900}` — neutral grays for backgrounds, borders, text

Use `teal-600` / `hover:teal-700` for primary buttons. Use `surface-*` for all neutral UI.

### Key file index

| File | Purpose |
|------|---------|
| `app/page.tsx` | Main dashboard, calendar sync loop, notification setup, per-date blocks cache |
| `app/login/page.tsx` | Google sign-in page |
| `app/auth/callback/route.ts` | Supabase OAuth code exchange |
| `middleware.ts` | Auth guard — redirects unauthenticated to `/login` |
| `app/api/tasks/create/route.ts` | LLM scheduling + GCal event creation |
| `app/api/tasks/batch-create/route.ts` | Batch scheduling (one LLM call for N tasks) |
| `app/api/tasks/reschedule/route.ts` | Conflict detection + GCal event replace |
| `app/api/tasks/[id]/route.ts` | `PATCH` — edit task fields + update GCal event |
| `app/api/tasks/[id]/complete/route.ts` | Quick-complete (no timer) + GCal cleanup |
| `app/api/timer/complete/route.ts` | Timer completion + GCal cleanup |
| `app/api/calendar/sync/route.ts` | Fetch GCal events → cache in `calendar_events` |
| `app/api/blocks/route.ts` | Merge manual blocks + GCal events; deduplicate task-owned events |
| `lib/googleCalendar.ts` | OAuth client, `getCalendarClient()`, `deleteCalendarEvent()` |
| `lib/scheduleUtils.ts` | `fallbackSchedule()` deterministic free-slot finder; `WORK_START_HOUR = 8` |
| `lib/timerService.ts` | localStorage timer state machine + 30s DB sync |
| `lib/estimateDuration.ts` | `estimateDurationWithLLM()` — GPT-4o-mini duration estimate with tag-based fallback |
| `lib/notifications.ts` | Browser notification helpers |
| `lib/tagColors.ts` | Tag → color mapping |
| `lib/supabase.ts` | Browser Supabase client singleton |
| `lib/supabase-server.ts` | `createSupabaseServer()` + `getAuthUser()` for API routes |
| `components/TaskDrawer.tsx` | Slide-up drawer with single/batch mode toggle |
| `components/TaskForm.tsx` | Task creation form; supports `onQueue` prop for batch mode |
| `components/TaskEditModal.tsx` | Modal to edit existing pending tasks |
| `components/ScheduleView.tsx` | Hourly calendar grid with task blocks + GCal overlays |
| `components/CornerTimerWidget.tsx` | Floating active timer display |
| `components/TimerSelector.tsx` | Modal to pick which task to time |
| `types/timer.ts` | Shared TypeScript interfaces (`TaskRow`, `TimerDisplayState`, etc.) |

## PWA

Configured via `@ducanh2912/next-pwa` in `next.config.mjs`:
- Service worker auto-generated to `public/sw.js` on build (disabled in dev)
- Manifest at `public/manifest.json` (theme `#027381`)
- SVG icon at `public/icon.svg` — **replace with actual PNG files** (`public/icon-192.png`, `public/icon-512.png`) for iOS and Android home-screen install; use [pwabuilder.com](https://www.pwabuilder.com/imageGenerator) to generate all sizes
- `components/InstallPrompt.tsx` — listens to `beforeinstallprompt`, renders a dismiss-able banner (stored in `ts_install_dismissed` localStorage key); hidden when already running as standalone
- `app/layout.tsx` exports `viewport` (themeColor, no user scaling) and `metadata.manifest`

## Mobile layout

`app/page.tsx` is responsive:
- **Desktop (md+):** two-column layout — 288px task list on left, schedule view on right
- **Mobile (< md):** single-column with tab switcher (`mobileView` state: `'tasks'` | `'schedule'`)
- **Tab bar** (`md:hidden`) renders as part of the flex column (not fixed) at the bottom of the screen
- **FAB** is `bottom-6 max-md:bottom-20` (no timer) or `bottom-52 max-md:bottom-[17rem]` (timer active) to clear tab bar
- **CornerTimerWidget** is `bottom-6 max-md:bottom-20` and `w-72 max-md:w-[calc(100vw-3rem)]` on mobile
- **Beta Feedback link** in header is `hidden sm:flex` — hidden on very small screens to keep the mobile header clean

## LLM duration estimation

`lib/estimateDuration.ts` exports `estimateDurationWithLLM(title, description, tag, priority)`:
- Calls GPT-4o-mini to estimate minutes; falls back to tag-based defaults if API key missing or call fails
- Called by both `api/tasks/create` and `api/tasks/batch-create` when `estimatedMinutes` is absent
- In `TaskForm.tsx` the first duration option is **"AI Estimate"** (value `-1`); when selected, `estimatedMinutes` is sent as `undefined` and the server estimates it
- Queue list in `TaskDrawer` shows "AI estimate" label for tasks without a manual duration

## Scheduling window

- **Preferred**: 8 AM – 11 PM
- **Last resort**: 11 PM – 3 AM (used only when earlier slots are all taken; college students work late)
- **Hard blackout**: 3 AM – 8 AM (never scheduled)
- `WORK_START_HOUR = 8` in `lib/scheduleUtils.ts` — single source of truth for the start boundary
- Both LLM prompts (create and batch-create) say "preferred 8 AM–11 PM; last resort up to 3 AM; never 3 AM–8 AM"
- `fallbackSchedule()` snaps any candidate in the 3–8 AM blackout forward to 8 AM via `snapToWorkHours()`
- LLM validation in `create/route.ts` rejects starts/ends in 3–8 AM; rejects cross-day ends at 8 AM+; allows midnight–3 AM

## Planned / future work

- **Smarter batch scheduling**: Let users reorder the batch queue before submitting to influence scheduling priority
- **Vercel deployment**: Add all env vars to Vercel project settings
