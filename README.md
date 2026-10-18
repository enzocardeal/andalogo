# andalogo

A transit map of São Paulo. It shows bus, Metrô, CPTM and EMTU stops, and live bus arrivals from SPTrans Olho Vivo.

Stack: Next.js on Vercel (`gru1`), Supabase (`sa-east-1`), MapLibre GL JS with OpenFreeMap tiles. The login, the invite gate, RLS and the keepalive cron follow [dividesperto](https://github.com/enzocardeal/dividesperto).

## Status

Milestone M1: all SPTrans bus stops and Metrô and CPTM stations on the map. A tap on a stop shows its lines and the scheduled frequency now.

| Milestone | Content |
|---|---|
| M0 | Login, map, GTFS inspection, ID mapping test |
| M1 | SPTrans and rail stops on the map, scheduled frequency per line |
| M2 | Live bus arrivals through the Olho Vivo proxy |
| M3 | Favorite stops, installable app |
| M4 | Line routes and search |
| M5 | EMTU stops and timetables from the ARTESP feed |
| M6 | Automatic weekly GTFS refresh |

## Data sources

| Source | URL | Login |
|---|---|---|
| SPTrans GTFS (buses, Metrô, CPTM) | `https://www.sptrans.com.br/umbraco/Surface/PerfilDesenvolvedor/BaixarGTFS?memberName=sptrans` | No |
| ARTESP GTFS (EMTU and other regions) | [dadosabertos.artesp.sp.gov.br/dataset/gtfs](https://dadosabertos.artesp.sp.gov.br/dataset/gtfs) | No |
| Olho Vivo API v2.1 (live buses) | `https://api.olhovivo.sptrans.com.br/v2.1` | Token from the SPTrans developer portal |

## Setup

### 1. Olho Vivo token

1. Register at the [SPTrans developer portal](https://www.sptrans.com.br/desenvolvedores/).
2. In "Meus Aplicativos", create an application. The portal shows its token.
3. Put the token in `OLHOVIVO_TOKEN` in `.env.local` and in Vercel.

### 2. Supabase

1. Create a new project in `sa-east-1`.
2. Authentication → Providers: turn on Google and turn off Email.
3. Authentication → URL Configuration: set the Site URL to the production domain. Add `https://<domain>/auth/callback` and `http://localhost:3000/auth/callback` as redirect URLs.
4. Apply the migrations:
   ```sh
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push --linked
   ```
5. Authentication → Hooks: point "Before User Created" to `public.before_user_created_hook`.

### 3. Google OAuth

1. In Google Cloud, create an OAuth client of type "Web application".
2. Add the Supabase callback URI (`https://<project-ref>.supabase.co/auth/v1/callback`) as a redirect URI.
3. Put the client ID and secret in the Supabase Google provider.
4. Publish the consent screen. In "Testing", only listed users can sign in.

### 4. Vercel

1. Import the GitHub repository with the Next.js preset.
2. Settings → Functions: set the region to `gru1`.
3. Add the environment variables below. Then deploy.

### Environment variables

| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key (public, RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key that bypasses RLS. Only `/api/invite` and `/api/cron/keepalive` use it. |
| `INVITE_CODE` | Code that the `/invite` page requires |
| `CRON_SECRET` | Bearer token that Vercel sends to the keepalive cron |
| `OLHOVIVO_TOKEN` | Olho Vivo API token. Server only. |
| `SUPABASE_DB_URL` | Postgres connection string for `gtfs:load`. Use the "Session pooler" string from Supabase → Connect. Local only, never in Vercel. |
| `NEXT_PUBLIC_MAP_STYLE_URL` | Optional. Map style URL. The default is OpenFreeMap "liberty". |

The secret keys must never get the `NEXT_PUBLIC_` prefix.

## Invites

- A friend opens `/invite`, types the invite code and the email of the Google account. `/api/invite` stores the email in lowercase.
- `public.before_user_created_hook` refuses every sign-up whose email is not in `invited_emails`.
- `invited_emails` holds at most 11 rows. A trigger refuses the 12th. The app cannot delete a row. Delete a wrong email by hand in the SQL editor.
- To close invites, remove `INVITE_CODE` in Vercel and deploy again. `/api/invite` then returns 404.

## Keepalive

`vercel.json` calls `/api/cron/keepalive` every day at 09:00 UTC. The route reads one auth user, so the free Supabase project does not pause after 7 days without traffic.

## Development

Node.js 22.18 or later.

```sh
npm install
npm run dev          # copies the MapLibre worker to public/, then starts Next.js
npm run typecheck
npm test             # unit tests in lib/
npm run test:rls     # RLS test, needs a local Supabase stack (supabase start)
```

CI runs the type check, the unit tests and the RLS test on every push to `main`.

### Data scripts

Download a feed into its own folder under `data/` (Git ignores it):

```sh
mkdir -p data/sptrans data/artesp
curl -L -o data/sptrans/gtfs.zip "https://www.sptrans.com.br/umbraco/Surface/PerfilDesenvolvedor/BaixarGTFS?memberName=sptrans"
curl -L -o data/artesp/gtfs.zip "https://dadosabertos.artesp.sp.gov.br/dataset/92e8bb31-df66-4700-ad9a-42a48f04fb7f/resource/3918f5ec-206d-4826-8a88-5d9f6f791fe2/download/artesp_gtfs.zip"
```

`npm run gtfs:inspect -- <feed.zip> …` prints the files, routes by type, rail lines, stops, trips, frequencies and shapes of each feed.

`npm run gtfs:load -- --feed sptrans --zip data/sptrans/gtfs.zip` loads the feed. It needs `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. It does these steps:

1. It skips the load when the active version has the same sha256. `--force` loads it again.
2. It builds the stops, routes, lines per stop and frequency windows from the feed.
3. It uploads the stops file for the map to the public Storage bucket `gtfs`, and creates the bucket when it is missing.
4. In one transaction, it replaces the rows of the feed and records the version in `feed_versions`. The app reads the old rows until the commit.

Run it again when SPTrans publishes a new feed, about once a week.

`npm run idmap:check -- --gtfs data/sptrans/gtfs.zip` checks that GTFS IDs match Olho Vivo IDs. It needs `OLHOVIVO_TOKEN` in `.env.local`. Run it on a weekday between 08:00 and 19:00. It checks three hypotheses on 100 random bus stops and 20 corridor stops:

| Hypothesis | Check |
|---|---|
| H1 | GTFS `stop_id` equals the Olho Vivo stop code `cp`, and the positions are less than 50 m apart |
| H2 | GTFS `route_id` (for example `8000-10`) equals the Olho Vivo line sign `c`, and the route serves the stop |
| H3 | GTFS `direction_id` equals Olho Vivo `sl - 1` |

Each check passes at 95 % or more. The script exits with code 1 when a check fails.
