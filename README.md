# ملت اسلامی — نظام ریکارڈ (Millat-e-Islami Log System)

A full institutional record-keeping system for **Members**, **Projects**, and **Meetings** — trilingual (Urdu / Arabic / English), RTL-primary, built to run for free on Render.

## What changed from the old version

The previous site was a single static `index.html` with hardcoded fake data in JavaScript arrays — nothing was saved anywhere real, and every visitor saw the same placeholder content with no way to add genuine records.

This version is a proper full-stack app:

- **Backend:** Node.js + Express serving a REST API
- **Database:** MongoDB Atlas — free tier (512MB), permanent, no credit card required, and your data survives every restart/redeploy (Render's free plan doesn't support persistent local disks at all, and its filesystem is wiped on every restart — Atlas avoids that entirely since the data lives outside the app)
- **Auth:** Single shared admin password (bcrypt-hashed, session-based) — visitors can browse and view everything; only the admin can add, edit, or delete records.
- **Trilingual UI:** Urdu (primary, RTL) with Arabic and English toggle, switchable site-wide with one click.

## Project structure

```
millat-e-islami/
├── server.js           # Express server + all API routes (talks to MongoDB Atlas)
├── package.json
├── render.yaml          # Render deployment blueprint
└── public/
    └── index.html        # Full frontend (single-page app)
```

## Setting up MongoDB Atlas (do this first — free, takes about 5 minutes)

1. Go to https://www.mongodb.com/cloud/atlas/register and create a free account.
2. Create a free **M0 cluster** (no card needed for this tier).
3. Under **Database Access**, create a database user with a username and password.
4. Under **Network Access**, add `0.0.0.0/0` (allow access from anywhere) — needed because Render's free plan doesn't have a static IP to whitelist.
5. Click **Connect** on your cluster → **Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. Replace `<username>` and `<password>` with your actual database user credentials.

This connection string is your `MONGO_URI` — you'll need it both locally and on Render.

## Running locally

```bash
npm install
MONGO_URI="your-connection-string-here" node server.js
```

Visit `http://localhost:3000`. Default admin password: **admin1234** — change this immediately via the Admin Panel after first login, or set the `ADMIN_PASSWORD` environment variable before first run.

## Deploying to Render (free tier)

1. Push this folder to your GitHub repo, replacing the old code.
2. On Render, choose **New → Blueprint**, point it at your repo — it reads `render.yaml` automatically.
3. Render will prompt you to fill in `MONGO_URI` during setup (it's marked as a manually-entered secret in the blueprint, not committed to the repo).
4. Also set `ADMIN_PASSWORD` to your real password in the Render dashboard before going live — don't leave it as `admin1234`.
5. Render's free tier spins down after 15 minutes of inactivity and takes roughly 30–50 seconds to wake on the next request — this is a Render platform limitation on the free plan, unrelated to the database choice.

## Notes on scaling later

MongoDB Atlas's free M0 tier (512MB) comfortably handles years of records for a single institution — members, projects, meetings, and progress logs are all small documents. If you ever need more space, upgrading the Atlas cluster doesn't require any code changes, just a plan change in the Atlas dashboard.
