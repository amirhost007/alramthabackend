// Creates the database tables and fills them with the website's default content.
// Safe to run more than once: it never overwrites content you have already edited.
//   npm run setup
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import bcrypt from 'bcryptjs'
import { config } from './config.js'
import { pool, query, tbl } from './db.js'
import { tables } from './schema.js'
import { saveMenu, savePage, saveSettings, saveSocial } from './content.js'
import { createProject } from './projects.js'

// The default content lives with the website, so the site and the database start out the same.
const defaultsFile = path.join(config.frontendDir, 'src', 'content', 'defaults.js')
let defaults
try {
  defaults = await import(pathToFileURL(defaultsFile).href)
} catch (err) {
  console.error(`Could not read ${defaultsFile}. Run setup from the full project (website + backend).`)
  console.error(err.message)
  process.exit(1)
}

const count = async (table) => Number((await query(`SELECT COUNT(*) n FROM ${table}`))[0].n)

try {
  console.log(`Connecting to ${config.db.database} on ${config.db.host} (tables "${config.tablePrefix}*")...`)
  for (const sql of tables) await pool.query(sql)
  console.log('✓ Tables ready')

  await saveSettings(defaults.settings, { onlyMissing: true })
  console.log('✓ Settings')

  if ((await count(tbl.menu_items)) === 0) {
    await saveMenu(defaults.menu)
    console.log('✓ Header menu added')
  }

  if ((await count(tbl.social_links)) === 0) {
    await saveSocial(defaults.social)
    console.log('✓ Social accounts added (add your links in the admin panel)')
  }

  for (const [slug, content] of Object.entries(defaults.pages)) {
    await savePage(slug, defaults.pageTitles[slug] || slug, content, { onlyMissing: true })
  }
  console.log('✓ Page content')

  if ((await count(tbl.projects)) === 0) {
    for (const [i, project] of (defaults.projects || []).entries()) {
      await createProject({ position: i + 1, ...project })
    }
    console.log(`✓ ${defaults.projects?.length || 0} projects added`)
  }

  if ((await count(tbl.users)) === 0) {
    const { email, password } = config.admin
    if (!email || !password || password.length < 8) {
      console.log('! No admin created: set ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters) in .env, then run setup again.')
    } else {
      await query(`INSERT INTO ${tbl.users} (name, email, password_hash) VALUES (?, ?, ?)`, [
        'Admin',
        email.toLowerCase(),
        await bcrypt.hash(password, 12),
      ])
      console.log(`✓ Admin account created: ${email}`)
    }
  }

  console.log('Done.')
} catch (err) {
  console.error('Setup failed:', err.code || '', err.message)
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('Check DB_HOST / DB_USER / DB_PASSWORD in .env. For Hostinger from your own computer, allow your IP under Databases > Remote MySQL.')
  }
  process.exitCode = 1
} finally {
  await pool.end()
}
