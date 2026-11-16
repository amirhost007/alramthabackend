// Creates an admin account, or resets its password if the email already exists.
//   npm run admin -- you@example.com "a-strong-password"
import bcrypt from 'bcryptjs'
import { pool, query, tbl } from './db.js'

const [email, password] = process.argv.slice(2)
if (!email || !password || password.length < 8) {
  console.log('Usage: npm run admin -- <email> <password (8+ characters)>')
  process.exit(1)
}

try {
  const hash = await bcrypt.hash(password, 12)
  await query(
    `INSERT INTO ${tbl.users} (name, email, password_hash) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    ['Admin', email.toLowerCase(), hash],
  )
  console.log(`✓ Admin ${email} is ready. You can log in at /admin.`)
} catch (err) {
  console.error('Failed:', err.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
