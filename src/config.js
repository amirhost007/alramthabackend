import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
export const rootDir = path.resolve(here, '..')

dotenv.config({ path: path.join(rootDir, '.env'), quiet: true })

const env = process.env

function required(name) {
  if (!env[name]) {
    console.error(`Missing ${name} in backend/.env (see .env.example).`)
    process.exit(1)
  }
  return env[name]
}

// Table names start with this prefix, so several sites can share one database without clashing.
const tablePrefix = env.DB_TABLE_PREFIX ?? 'ramtha_'
if (!/^[a-zA-Z0-9_]{0,24}$/.test(tablePrefix)) {
  console.error('DB_TABLE_PREFIX may only contain letters, numbers and _ (max 24 characters).')
  process.exit(1)
}

// The React app sits next to the backend, in "frontend" (called "fronted" in this project).
const frontendDir =
  ['frontend', 'fronted'].map((name) => path.resolve(rootDir, '..', name)).find((dir) => fs.existsSync(dir)) ||
  path.resolve(rootDir, '..', 'frontend')

export const config = {
  port: Number(env.PORT) || 5000,
  isProd: env.NODE_ENV === 'production',
  corsOrigins: (env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  db: {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: env.DB_PASSWORD || '',
  },
  // Hostinger's remote MySQL accepts only one connection at a time from outside, so use 1 when the
  // backend runs on your own computer. On the hosting itself (DB_HOST=localhost) more is fine.
  dbConnectionLimit: Math.max(1, Number(env.DB_CONNECTION_LIMIT) || 10),
  tablePrefix,
  jwtSecret: required('JWT_SECRET'),
  admin: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  uploadsDir: path.join(rootDir, 'uploads'),
  // Images go to this FTP account when FTP_HOST is set (see storage.js).
  ftp: env.FTP_HOST
    ? {
        host: env.FTP_HOST,
        port: Number(env.FTP_PORT) || 21,
        user: required('FTP_USER'),
        password: required('FTP_PASSWORD'),
        secure: env.FTP_SECURE !== 'false',
        dir: `/${(env.FTP_DIR || 'alramtha_media').replace(/^\/+|\/+$/g, '')}`,
        publicUrl: required('MEDIA_URL').replace(/\/+$/, ''),
      }
    : null,
  // Keeps a free Render service awake (see keep-alive.js). Render sets RENDER_EXTERNAL_URL itself;
  // KEEP_ALIVE_URL overrides it, and KEEP_ALIVE_URL=off switches the pings off.
  keepAlive: {
    url: env.KEEP_ALIVE_URL === 'off' ? '' : (env.KEEP_ALIVE_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
    minutes: Number(env.KEEP_ALIVE_MINUTES) || 14,
  },
  // When the React app has been built, the backend can serve it too (one app to deploy).
  frontendDir,
  frontendDist: path.join(frontendDir, 'dist'),
}
