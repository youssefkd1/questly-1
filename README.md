# Questly

Questly is a responsive family tasks, learning habits, and rewards app. Without Supabase settings it starts in **local demo mode**; demo changes are saved only in this browser and do not sync. When a project URL and publishable key are configured, it opens **real account mode** with Supabase Auth, family data, RLS-protected reads, secure task/reward functions, and database change updates.

## Run locally

Requirements: Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Vite prints a local URL (usually `http://localhost:5173`). Choose a child in the family strip, use **Child view** to switch to a child's dashboard, and use **Parent** for management. No demo password is needed. **Settings → Reset demo data** restores the starting family.

Other commands:

```sh
npm run build
npm test
npm run preview
```

## Demo capabilities

- Four children across the age modes, with sample missions, rewards, progress, badges, approvals, and family activity.
- Parent and child views, child selector, mission category/search filters, responsive progress views, and reward shop.
- Create missions from editable starter values; assign a child, choose category, due date, duration, XP, points, and parent review.
- Submit tasks for review, approve once to award XP and points, or send back for a retry.
- Request rewards. The demo rewards workflow is local; the UI demonstrates the shop and balance, while production approval/redemption is provided by the SQL function.
- Demo data reset and local persistence.

## Real account mode

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, apply the migration below, and restart Vite. The app will show sign-in and registration instead of local demo mode.

- A parent can create a family or join another guardian’s family with a six-digit code and QR that expire after 15 minutes. Guardian codes can be used by multiple invited guardians during that window.
- Registration asks whether the account is for a parent or child. On later sign-ins, the active parent/child role is resolved from the account’s family membership; the registration choice is only used to guide setup, not to grant permissions.
- Parents create private child profiles and can show a six-digit child code and QR that expire after 15 minutes. A child signs in with their own account and redeems it once to link only their assigned profile.
- Parents assign missions, review submissions, create rewards, and approve redemption requests. Task XP and points are awarded exactly once by database functions; rewards deduct points only after approval.
- Authorized family members receive database updates through Supabase Realtime. Children are restricted by RLS to their own profile, assigned tasks, transactions, achievements, and redemptions.

Child sign-in collects an email address through Supabase Auth. Before using it with children, configure guardian-controlled email/account setup and review parental consent and age requirements for the jurisdictions you serve. The implementation has not had an independent security review.

## Supabase setup

To prepare the Supabase project:

1. Create a project in the Supabase Dashboard under your account. Save the database password somewhere private; it is separate from the API keys.
2. In the project Connect panel, copy the Project URL and **publishable key** (`sb_publishable_…`). Do not use a secret key (`sb_secret_…`) or service-role key in this frontend.
3. Install the Supabase CLI in this project with `npm install --save-dev supabase`, then sign in with `npx supabase login`.
4. Run `npx supabase link --project-ref <your-project-ref>` from this folder. The project ref appears in your project’s Dashboard URL.
5. Preview the schema change with `npx supabase db push --dry-run`; then apply it with `npx supabase db push` and your database password when prompted.
6. Copy `.env.example` to `.env.local`, fill in the Project URL and publishable key, and restart Vite.
7. Configure email sign-in, redirect URLs, rate limits, and account deletion policies. Test with separate parent, linked child, and unrelated-family accounts before using real family data.

`create_family` establishes the authenticated creator as the first parent. Short family codes use cryptographically random digits, can be viewed only through parent-only database functions, and expire after 15 minutes. Child codes link one profile once; guardian codes may add multiple guardians during their active window. `assign_task` and `request_reward` validate family membership and child balance on the server. `submit_completion`, `review_completion`, and `decide_redemption` control completion and point changes inside database transactions. Do not expose a secret or service-role key to a browser.

## Deployment

The frontend is Vercel-compatible. Import the repository, set the build command to `npm run build`, output directory to `dist`, and Node version to 20.19+ (or 22.12+). Add only the Supabase URL and publishable key as Vercel environment variables. Apply the migration independently with the Supabase CLI.

## Project structure

```text
src/Questly.tsx                 App screens, local demo workflows, reusable UI
src/data.ts                     Seed family, sample missions, rewards, templates
src/styles.css                  Responsive design system and page styles
src/main.tsx                    React entry point
src/CloudApp.tsx                Supabase Auth and shared-family UI
src/lib/                          Supabase configuration and client
supabase/migrations/            PostgreSQL schema, indexes, RLS, transactional RPCs
```

## Child privacy and production limits

Local demo mode uses no authentication, stores data in browser local storage, and is not secure for real family data. The cloud mode provides authenticated access and RLS but still needs a deployed/configured Supabase project and independent security review. There is no photo upload, location collection, public profile, messaging, advertising, or analytics. Production launch still needs legal review for child-data collection, verifiable parental consent, retention/deletion, age-specific privacy requirements, and the jurisdictions served. Do not describe the app as legally compliant or production-secure.

## Next improvements

1. Apply and test the migration on a Supabase project; add automated RLS tests for cross-family access, role escalation, duplicate awards, and insufficient reward balances.
2. Add account/data deletion, guardian invitation revocation, child profile editing, and persistent notification history.
3. Add recurrence scheduling, task editing/pausing/archive controls, and a true weekly planner/calendar.
