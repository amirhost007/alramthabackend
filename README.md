# Al-Ramtha website: backend

Node.js + Express + MySQL API and admin login for the Al-Ramtha Engineering Consultancy website.
The website and admin panel (React) live in a separate folder, `fronted/`, next to this one:

```
alramtha-react/
  backend/   ← this repository
  fronted/   ← the React website and admin panel
```

## Setup

```bash
npm install
cp .env.example .env     # then fill in the database, admin and FTP settings
npm run setup            # creates the tables and fills them with the default content (safe to re-run)
npm run media            # copies the website's built-in images to the FTP media folder
npm run dev              # API on http://localhost:5000
```

`npm run setup` reads the default content from `../fronted/src/content/defaults.js`, and `npm run media`
uploads `../fronted/public/img`, so run them with the `fronted` folder in place.

| Command                              | What it does                                              |
| ------------------------------------ | --------------------------------------------------------- |
| `npm run dev`                        | Starts the API and restarts it when a file changes        |
| `npm start`                          | Starts the API (production); also serves `../fronted/dist` if it is built |
| `npm run setup`                      | Creates the tables and default content                    |
| `npm run media`                      | Uploads the built-in images to FTP and points content at them |
| `npm run admin -- <email> <password>` | Creates an admin, or resets its password                 |

## Settings (`.env`)

See `.env.example`. In short: MySQL connection (`DB_*`, tables start with `DB_TABLE_PREFIX`), `JWT_SECRET`,
the first admin (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) and the FTP media folder (`FTP_*`, `MEDIA_URL`).
Hostinger's remote MySQL accepts one connection at a time from outside: use `DB_CONNECTION_LIMIT=1` on your
own computer and `10` on the hosting (`DB_HOST=localhost`).

## API

| Route                          | Use                                                          |
| ------------------------------ | ------------------------------------------------------------ |
| `GET /api/site`                | Settings, menu, social links and page content in one request |
| `GET /api/projects`, `/api/projects/:slug` | Published projects                               |
| `POST /api/enquiries`          | Contact form                                                 |
| `POST /api/auth/login`         | Admin login (returns a token)                                |
| `/api/admin/*`                 | Admin panel: pages, projects, settings, menu, social, uploads, enquiries |

If the database stops answering, the public routes serve the last good copy saved in `cache/`.

## Keep-alive (Render)

Render's free plan puts a service to sleep after 15 minutes without requests. While the backend runs, it calls
its own `/api/health` every 14 minutes (`src/keep-alive.js`), so it stays awake. On Render this needs no
settings; `GET /api/health` shows `"keepAlive": "every 14 minutes"` when it is on. One always-on service uses
about 744 of the 750 free hours a month.
