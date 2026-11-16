import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { pool } from './db.js'
import publicRoutes from './routes/public.js'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import { keepAliveStatus, startKeepAlive } from './keep-alive.js'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  })
  next()
})

// Only needed when the website and the API are on different domains.
if (config.corsOrigins.length) app.use('/api', cors({ origin: config.corsOrigins }))

app.use(express.json({ limit: '1mb' }))

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, database: 'connected', keepAlive: keepAliveStatus() })
  } catch (err) {
    res.status(503).json({ ok: false, database: err.code || 'error', keepAlive: keepAliveStatus() })
  }
})

app.use('/api', publicRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }))

app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', fallthrough: false }))

// Serve the built React app (frontend/dist) if it exists, so one Node app runs the whole site.
if (fs.existsSync(path.join(config.frontendDist, 'index.html'))) {
  app.use(express.static(config.frontendDist, { index: false, maxAge: '1h' }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    res.sendFile(path.join(config.frontendDist, 'index.html'))
  })
}

// Errors: send a short message, never a stack trace.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500
  let message = status < 500 ? err.message : 'Something went wrong. Please try again.'
  if (err.code === 'LIMIT_FILE_SIZE') [status, message] = [400, 'That image is too large (max 8 MB).']
  else if (err.type === 'entity.parse.failed') [status, message] = [400, 'Invalid request.']
  else if (err.code === 'ENOENT' && req.path.startsWith('/uploads')) [status, message] = [404, 'Not found.']
  else if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ER_ACCESS_DENIED_ERROR') {
    status = 503
    message = 'The database is not reachable right now.'
  }
  if (status >= 500) console.error(err)
  res.status(status).json({ error: message })
})

app.listen(config.port, () => {
  console.log(`Backend running on http://localhost:${config.port} (tables "${config.tablePrefix}*")`)
  startKeepAlive()
})
