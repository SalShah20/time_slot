# TimeSlot

AI-powered task scheduling and time tracking app. Add tasks in plain English, and TimeSlot automatically schedules them into your calendar using an LLM — no manual time-blocking needed.

Built with Next.js 14, TypeScript, Tailwind CSS, Supabase, Google Calendar, Google Classroom, and Canvas LMS.

## Features

### AI Auto-Scheduling
Every task you create is automatically placed into the best available time slot. GPT-4o-mini analyzes your existing schedule, deadlines, priorities, and calendar events to find the optimal slot. If the LLM fails or the API key is missing, a deterministic fallback scheduler takes over.

### Brain Dump
Paste a freeform list of tasks in plain English — one per line — and the AI parses them into structured tasks with deadlines, durations, priorities, and tags extracted automatically.

```
Finish CS homework by Friday 2 hours
Study for exam tomorrow high priority
Gym workout 1hr personal
Submit job app Monday work
```

Supports natural language deadlines ("by Friday"), durations ("2 hours", "90 min"), priorities ("urgent", "high"), and fixed times ("meeting at 3 PM").

### Batch Scheduling
Queue multiple tasks and schedule them all at once with a single LLM call. More efficient than creating tasks one at a time. Brain dump is the default input mode for batch scheduling.

### Task Splitting
Long tasks that would miss their deadline are automatically split into multiple focused sessions (30–90 minutes each) spread across available time slots before the deadline. Sessions have mandatory 30-minute buffers between them.

### Fixed-Time Tasks
Pin tasks to a specific time (e.g., "class at 9 AM", "meeting at 2:30 PM"). Fixed tasks skip auto-scheduling, are never auto-rescheduled, and act as immovable blocks that other tasks schedule around.

### Google Calendar Integration
Two-way sync with Google Calendar via OAuth 2.0:
- **Dedicated "TimeSlot" calendar** created automatically with brand colors
- **Scheduled tasks** appear as color-coded events on your Google Calendar
- **External events** are imported and shown as busy blocks in the schedule view
- **Real-time webhook** — when someone adds an event to your Google Calendar, TimeSlot detects the conflict and automatically reschedules affected tasks
- **Auto-resync** every 5 minutes with automatic conflict resolution
- **Calendar filtering** — choose which calendars TimeSlot considers when scheduling (Settings)
- All GCal operations are non-fatal — task features work even without Google Calendar connected

### Google Classroom Integration
Import assignments from Google Classroom as tasks:
- **Read-only access** — TimeSlot reads your courses and coursework, never modifies Classroom data
- **Incremental authorization** — Classroom scopes are only requested when you connect the integration from Settings
- **Automatic deduplication** — previously imported assignments are tracked and skipped
- **AI duration estimation** — imported assignments get estimated durations via GPT-4o-mini
- Imports assignments due in the next 2 weeks

### Canvas LMS Integration
Import assignments from Canvas LMS as tasks:
- **API token auth** — connect by providing your Canvas API token and institution domain
- **Automatic deduplication** — previously imported assignments are tracked and skipped
- **AI duration estimation** — imported assignments get estimated durations via GPT-4o-mini
- Imports assignments due in the next 2 weeks
- Disconnect at any time from Settings (deletes stored token)

### Focus Timer
Start a timer against any pending task. The timer state machine supports work sessions, pauses, and breaks. Timer state is stored in localStorage (authoritative) with 30-second background sync to the database. Stale breaks are auto-ended after 2 hours.

### AI Duration Estimation
When you don't specify a duration, GPT-4o-mini estimates it based on:
- Task title, description, tag, and priority
- Your personal timing history (per-tag averages from completed tasks)
- Falls back to tag-based defaults if the API key is missing

### Configurable Working Hours
Customize your scheduling window from the Settings page:
- **Preferred window** (default 8 AM – 11 PM)
- **Last resort window** (default 11 PM – 3 AM)
- **Hard blackout** (default 3 AM – 8 AM — never scheduled)

All scheduling — LLM prompts, fallback algorithm, and conflict rescheduling — respects your configured hours.

### Natural Language Scheduling Preferences
Describe your schedule in plain English ("I'm a night owl — don't schedule anything before 11am"), and TimeSlot parses it into working hours and preferences. Supports:
- **Working hours extraction** — start, end, and late-night cutoff
- **Preference flags** — prefers mornings, prefers evenings, avoid back-to-back tasks
- Manual time selectors for fine-tuning after AI parsing

### Smart Conflict Resolution
When a new Google Calendar event conflicts with a scheduled task, TimeSlot automatically:
1. Detects the conflict via webhook or periodic sync
2. Finds the next available free slot (respecting your working hours)
3. Moves the task and updates the Google Calendar event
4. Flags tasks that can't fit before their deadline with a warning

### Browser Notifications
- **15-minute warning** before a task starts
- **Deadline warning** when a task's deadline is approaching
- **Morning summary** at 8 AM with your task count and first task

### Tags and Colors
8 built-in tags (Study, Work, Personal, Exercise, Health, Social, Errands, Other) with distinct colors. Custom tags are supported with auto-assigned colors. Tags are suggested by AI based on task content.

### Quick Complete
Complete tasks directly from the sidebar with a single click — no timer required. Cleans up the associated Google Calendar event automatically.

### Task Editing
Click any task in the sidebar to edit its title, deadline, duration, tag, or pinned status. If you change the deadline and the current time slot no longer fits, the task is automatically rescheduled.

### Manual Calendar Blocks
Add busy blocks directly on the schedule view to block off time. Blocks are mirrored to Google Calendar if connected. Supports bulk creation (up to 90 blocks at once).

### PWA Support
Installable as a Progressive Web App on mobile and desktop. Service worker generated on build for offline caching.

### Responsive Design
- **Desktop**: two-column layout — task list on the left, hourly schedule view on the right
- **Mobile**: single-column with tab switcher between Tasks and Schedule views
- Floating timer widget adapts to screen size

### Legal Pages
Privacy Policy and Terms of Service pages (public, no auth required) for Google OAuth verification. Covers Google API scope, data handling, and Limited Use compliance.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS (custom teal + surface palette)
- **Auth**: Supabase Auth with Google OAuth
- **Database**: Supabase (PostgreSQL)
- **Calendar**: Google Calendar API (googleapis)
- **Classroom**: Google Classroom API (googleapis)
- **Canvas**: Canvas LMS REST API
- **AI**: OpenAI GPT-4o-mini (scheduling, parsing, duration estimation, tag suggestion)
- **PWA**: @ducanh2912/next-pwa

## Getting Started

### Prerequisites
- Node.js 18+
- A Supabase project
- A Google Cloud project with Calendar API enabled (and optionally Classroom API)
- An OpenAI API key (optional — falls back to deterministic scheduling)

### Environment Variables

Create `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
OPENAI_API_KEY=
```

### Database Setup

Run the SQL migrations in order (001–018) in the Supabase SQL editor:

1. `001_initial.sql` — base schema (tasks, active_timers, timer_sessions)
2. `002_add_scheduled_time.sql` — adds scheduled_start to tasks
3. `003_add_task_fields.sql` — adds description, tag, priority, scheduled_end
4. `004_calendar_tables.sql` — adds user_tokens, calendar_events tables
5. `005_fix_tag_constraint.sql` — fixes tag CHECK constraint
6. `006_calendar_blocks.sql` — adds calendar_blocks table + RLS
7. `007_add_google_event_id.sql` — adds google_event_id to tasks
8. `008_webhook_channels.sql` — adds webhook fields to user_tokens; adds needs_rescheduling to tasks
9. `009_task_sessions.sql` — adds session_number, total_sessions, parent_task_id to tasks
10. `010_google_calendar_id.sql` — adds google_calendar_id to user_tokens
11. `011_add_is_fixed.sql` — adds is_fixed to tasks
12. `012_working_hours.sql` — adds work_start_hour, work_end_hour, work_end_late_hour to user_tokens
13. `013_work_hours_real.sql` — changes work hour columns to REAL for 30-min granularity; adds work_timezone
14. `014_calendar_filter.sql` — calendar filter preferences
15. `015_task_reminders.sql` — per-task reminders
16. `016_canvas_integration.sql` — Canvas LMS integration (canvas_token, canvas_domain, imported assignments tracking)
17. `017_scheduling_preferences.sql` — natural language scheduling preferences columns
18. `018_classroom_integration.sql` — Google Classroom integration (classroom_connected, imported assignments tracking)

### Auth Setup

1. **Supabase**: Auth > Providers > Google — enable and add your Google client ID + secret
2. **Supabase**: Auth > URL Configuration — add `http://localhost:3000/auth/callback` to Redirect URLs
3. **GCP Console**: Add `http://localhost:3000/api/calendar/callback` as an authorized redirect URI

### Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # Production build (also validates TypeScript)
npm run lint     # ESLint
```

There are no automated tests. Run `npm run build` to verify changes compile.

## Architecture

See `CLAUDE.md` for a detailed breakdown of every component, API route, database schema, and key design decisions.

## Deployment

Deploy to Vercel and add all `.env.local` variables to the Vercel project settings. The PWA service worker is generated automatically on build. PWA icons are pre-generated in `public/icons/` (72–512px PNGs).
