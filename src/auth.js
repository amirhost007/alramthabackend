import jwt from 'jsonwebtoken'
import { config } from './config.js'

export const signToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email, name: user.name }, config.jwtSecret, { expiresIn: '7d' })

// Protects admin routes. Expects "Authorization: Bearer <token>".
export function requireAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return res.status(401).json({ error: 'Please log in.' })
  try {
    req.user = jwt.verify(token, config.jwtSecret)
    next()
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please log in again.' })
  }
}

// Very small in-memory rate limiter (per IP), enough to slow down password guessing and form spam.
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    const key = req.ip
    const entry = hits.get(key)
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs })
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k)
      return next()
    }
    entry.count++
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)))
      return res.status(429).json({ error: message })
    }
    next()
  }
}
