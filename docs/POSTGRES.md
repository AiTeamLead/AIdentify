# PostgreSQL: every account, sign-in and record in one database (v2.15.5)

Without `DATABASE_URL` the app saves everything in `data/kv.json` (fine for a quick local test, not for real users).
With `DATABASE_URL` set, **everything people do in the app is saved in PostgreSQL**: accounts, sign-ins, businesses,
enquiries, leads, posts, approvals, chats, settings. The app creates its own tables on start.

## 1. Set it up

### On your computer
**With Docker** (easiest):
```
docker compose up -d db        # PostgreSQL only (user aaas, password aaas, database aaas, localhost:5432)
npm run db:setup               # creates the tables, copies data/kv.json in, writes DATABASE_URL into .env
npm start                      # the app now uses PostgreSQL
```
(`docker compose up -d` runs the app in Docker too, already connected.)

**Without Docker (Windows):** install PostgreSQL from postgresql.org/download/windows (keep port 5432, note the
password you choose for `postgres`). Open **SQL Shell (psql)**, sign in as `postgres`, then:
```sql
create role aaas with login password 'choose-a-password';
create database aaas owner aaas;
```
Then in the project folder: `npm run db:setup -- --url postgres://aaas:choose-a-password@localhost:5432/aaas`

### On the server (AWS EC2, Ubuntu)
```
cd /path/to/AaaS && sudo bash scripts/setup-postgres.sh
```
Installs PostgreSQL, creates database + login `aaas` with a random password (reachable only from the server),
writes `DATABASE_URL` into `.env`, creates the tables and copies the existing `data/kv.json` in. Then restart the app.
Using AWS RDS instead: create a PostgreSQL instance, put its address in `.env` as
`DATABASE_URL=postgres://user:password@your-rds-host:5432/aaas` and run `npm run db:setup`.

`npm run db:setup` is safe to run again: it never deletes anything and copies `data/kv.json` only the first time.

## 2. What you can see (readable tables — no passwords, tokens or keys)

| Name | One row per | Columns |
|---|---|---|
| `aaas_users` | account | email, name, account_type, signed_up_at, last_seen_at (India time), sign_in_method, suspended, business, industry, city, business_phone |
| `aaas_logins` | sign-up or sign-in (from v2.15.5 on) | email, event (signup / login), method (password / google / email link), at |
| `aaas_businesses` | business set up in the app | email, business, industry, city, phone, sample_data, enquiries, leads, posts, customers |
| `aaas_enquiries` | enquiry a business received | business_email, business, name, phone, email, channel, message, status, source, at |
| `aaas_leads` | lead | business_email, business, name, phone, email, channel, stage, message, at |
| `aaas_posts` | social post | business_email, business, text, status, networks, published, at |

The raw data is in table `agentsphere_kv` (one JSON value per key). Don't query it directly: it also holds password
hashes and encrypted keys.

## 3. Look at the data

**Quickest — one command in the project folder:**
```
npm run users -- --since 2026-11-10                    # who signed up since the promotion started
npm run users -- --since 2026-11-10 --csv signups.csv  # same, saved for Excel
npm run users -- --logins --since 2026-11-10           # every sign-up and sign-in since then
```

**With a database app** (pgAdmin or DBeaver, free): new connection → host `localhost` (on the server: use an SSH
tunnel), port 5432, database `aaas`, user `aaas`, the password from `DATABASE_URL` in `.env`. Open the views above.

**With psql:** `psql "$DATABASE_URL"` (on the server, from the project folder: `psql "$(grep ^DATABASE_URL= .env | cut -d= -f2-)"`)

### Ready-made questions
```sql
-- Who signed up since the promotion started (newest first)
select email, name, signed_up_at, sign_in_method, business, industry, city
from aaas_users where account_type = 'customer' and signed_up_at >= '2026-11-10'
order by signed_up_at desc;

-- Sign-ups per day
select date(signed_up_at) as day, count(*) from aaas_users
where account_type = 'customer' group by 1 order by 1 desc;

-- Of those, how many set up a business, and who came back after the first day
select count(*) as signed_up,
       count(business) as set_up_business,
       count(*) filter (where last_seen_at > signed_up_at + interval '1 day') as came_back
from aaas_users where account_type = 'customer' and signed_up_at >= '2026-11-10';

-- Every sign-in today
select email, event, method, at at time zone 'Asia/Kolkata' as at_ist from aaas_logins
where at >= current_date order by at desc;

-- Busiest businesses
select business, industry, city, enquiries, leads, posts from aaas_businesses order by enquiries desc limit 20;

-- Export to a file (psql)
\copy (select * from aaas_users where signed_up_at >= '2026-11-10') to 'signups.csv' csv header
```

The promotion itself isn't recorded on accounts; use the date it started (`signed_up_at >= …`).
Sign-ins before v2.15.5 weren't recorded (for those, `last_seen_at` shows the latest).

## 4. Optional: a read-only login (for a teammate or a reporting tool)
Run once as the database owner (`psql "$DATABASE_URL"`):
```sql
create role aaas_readonly with login password 'another-strong-password';
grant usage on schema public to aaas_readonly;
grant select on aaas_users, aaas_logins, aaas_businesses, aaas_enquiries, aaas_leads, aaas_posts to aaas_readonly;
```
It can read only these six — not `agentsphere_kv`, so never passwords or keys.

## 5. Keep it safe
- Emails and phone numbers are personal data: keep exports inside the team, delete CSVs when done.
- Back up daily on the server: `pg_dump "$DATABASE_URL" -Fc -f aaas-$(date +%F).dump` (restore with `pg_restore`).
- Port 5432 stays closed to the internet (both setups bind to this machine only). Reach it with an SSH tunnel.
