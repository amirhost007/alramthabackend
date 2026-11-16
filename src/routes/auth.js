import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { query, tbl } from '../db.js'
import { rateLimit, requireAuth, signToken } from '../auth.js'
import { str } from '../util.js'

const router = Router()

router.post(
  '/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts. Please wait 15 minutes.' }),
  async (req, res) => {
    const email = str(req.body?.email, 190).toLowerCase()
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const [user] = await query(`SELECT * FROM ${tbl.users} WHERE email = ?`, [email])
    const ok = user && (await bcrypt.compare(password, user.password_hash))
    if (!ok) return res.status(401).json({ error: 'Wrong email or password.' })
    res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email } })
  },
)

router.get('/me', requireAuth, async (req, res) => {
  const [user] = await query(`SELECT id, name, email FROM ${tbl.users} WHERE id = ?`, [req.user.sub])
  if (!user) return res.status(401).json({ error: 'Please log in.' })
  res.json({ user })
})

router.put('/account', requireAuth, async (req, res) => {
  const { currentPassword = '', newPassword = '', name, email } = req.body || {}
  const [user] = await query(`SELECT * FROM ${tbl.users} WHERE id = ?`, [req.user.sub])
  if (!user) return res.status(401).json({ error: 'Please log in.' })
  if (!(await bcrypt.compare(String(currentPassword), user.password_hash))) {
    return res.status(400).json({ error: 'Your current password is not correct.' })
  }
  const updates = {}
  if (name !== undefined) updates.name = str(name, 120) || user.name
  if (email !== undefined) {
    const e = str(email, 190).toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return res.status(400).json({ error: 'Please enter a valid email.' })
    updates.email = e
  }
  if (newPassword) {
    if (String(newPassword).length < 8) return res.status(400).json({ error: 'The new password needs at least 8 characters.' })
    updates.password_hash = await bcrypt.hash(String(newPassword), 12)
  }
  if (Object.keys(updates).length) {
    try {
      await query(`UPDATE ${tbl.users} SET ? WHERE id = ?`, [updates, user.id])
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Another admin already uses that email.' })
      throw err
    }
  }
  const [fresh] = await query(`SELECT id, name, email FROM ${tbl.users} WHERE id = ?`, [user.id])
  res.json({ user: fresh, token: signToken(fresh) })
})

export default router
