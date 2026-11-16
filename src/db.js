import mysql from 'mysql2/promise'
import { config } from './config.js'

// Full table names, e.g. tbl.projects -> "ramtha_projects" (see DB_TABLE_PREFIX in .env).
export const tbl = Object.fromEntries(
  ['users', 'settings', 'menu_items', 'social_links', 'pages', 'projects', 'enquiries'].map((name) => [
    name,
    config.tablePrefix + name,
  ]),
)

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: config.dbConnectionLimit,
  charset: 'utf8mb4',
  timezone: 'Z',
  connectTimeout: 15000,
  // Hostinger's MySQL closes connections idle for 20 seconds (wait_timeout=20): keep one open
  // between requests, and close idle ones before the server does.
  maxIdle: 1,
  idleTimeout: 10000,
  // Say goodbye properly when closing an idle connection. Otherwise the server keeps counting it
  // until its own timeout, and (with one connection allowed from outside) the next request waits.
  gracefulEnd: true,
})

const CONNECTION_LOST = new Set(['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'EPIPE', 'ETIMEDOUT'])

// Runs a query and returns the rows (or the result for INSERT/UPDATE/DELETE).
// A read that fails because the server dropped an idle connection is tried once more on a fresh one.
export async function query(sql, params) {
  for (let attempt = 1; ; attempt++) {
    try {
      const [rows] = await pool.query(sql, params)
      return rows
    } catch (err) {
      if (attempt >= 3 || !CONNECTION_LOST.has(err.code) || !/^\s*(SELECT|SHOW)\b/i.test(sql)) throw err
    }
  }
}

// Runs `fn(conn)` inside a transaction.
export async function transaction(fn) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

export function parseJson(text, fallback) {
  if (text == null) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}
