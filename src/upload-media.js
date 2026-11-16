// Copies the website's built-in images (fronted/public/img: logo, slides, projects, partner logos, team photos)
// to the FTP media folder, where they are served from MEDIA_URL like images uploaded in the admin panel.
// Then points saved content (pages, settings, projects) from "/img/..." to those copies.
// Safe to run again: files are overwritten, nothing else on the FTP account is touched.
//   npm run media
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { config } from './config.js'
import { pool, query, tbl } from './db.js'
import { withFtp } from './storage.js'

if (!config.ftp) {
  console.error('Add FTP_HOST, FTP_USER, FTP_PASSWORD and MEDIA_URL to backend/.env first (see .env.example).')
  process.exit(1)
}

const imgDir = path.join(config.frontendDir, 'public', 'img')
const { dir, publicUrl } = config.ftp

// The media folder only holds images: no folder listings, and script files are never run.
const htaccess = `# Website media (images only)
Options -Indexes
<FilesMatch "\\.(php[0-9]?|phtml|phar|cgi|pl|py|sh|asp|aspx|jsp)$">
  Require all denied
</FilesMatch>
`

// "/img/..." in stored JSON -> "<MEDIA_URL>/img/...". Also matches lists stored as JSON strings inside JSON.
const rewrite = (text) => (typeof text === 'string' ? text.replaceAll('"/img/', `"${publicUrl}/img/`) : text)

// Every file under `folder`, as paths relative to it ("projects/1.jpg").
const listFiles = (folder, prefix = '') =>
  fs.readdirSync(folder, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(folder, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  )

// Uploads the files one folder at a time. Files already there with the same size are skipped,
// and a dropped connection is retried, so a run that stopped halfway can simply be started again.
async function uploadImages() {
  const files = listFiles(imgDir)
  const folders = [...new Set(files.map((f) => path.posix.dirname(f)))]
  let uploaded = 0
  let skipped = 0
  for (const folder of folders) {
    const remote = folder === '.' ? `${dir}/img` : `${dir}/img/${folder}`
    const names = files.filter((f) => path.posix.dirname(f) === folder)
    for (let attempt = 1; ; attempt++) {
      try {
        await withFtp(async (client) => {
          await client.ensureDir(remote)
          const sizes = new Map((await client.list()).map((f) => [f.name, f.size]))
          for (const file of names) {
            const name = path.posix.basename(file)
            const local = path.join(imgDir, file)
            if (sizes.get(name) === fs.statSync(local).size) {
              skipped++
              continue
            }
            await client.uploadFrom(local, name)
            sizes.set(name, fs.statSync(local).size)
            uploaded++
          }
        })
        break
      } catch (err) {
        if (attempt >= 4) throw err
        // An upload cut off earlier leaves a hidden temporary file that blocks the next try: remove it.
        const leftover = /Temporary hidden file (\/\S+) already exists/.exec(err.cause?.message || '')?.[1]
        if (leftover) {
          await withFtp((client) => client.remove(leftover)).catch(() => {})
          console.log(`  …removed an unfinished earlier upload (${path.posix.basename(leftover)}), retrying`)
        } else {
          console.log(`  …connection dropped in img/${folder === '.' ? '' : folder}, retrying (${attempt}/3)`)
        }
      }
    }
  }
  console.log(`✓ img/ (${uploaded} uploaded, ${skipped} already there) → ${publicUrl}/img/`)
}

// Points saved content at the media folder. Running it twice changes nothing, so it can simply be retried.
async function pointContentAtMedia() {
  let changed = 0
  for (const row of await query(`SELECT slug, content FROM ${tbl.pages}`)) {
    const next = rewrite(row.content)
    if (next !== row.content) changed += (await query(`UPDATE ${tbl.pages} SET content = ? WHERE slug = ?`, [next, row.slug])).affectedRows
  }
  for (const row of await query(`SELECT name, value FROM ${tbl.settings}`)) {
    const next = rewrite(row.value)
    if (next !== row.value) changed += (await query(`UPDATE ${tbl.settings} SET value = ? WHERE name = ?`, [next, row.name])).affectedRows
  }
  for (const row of await query(`SELECT id, cover_image, gallery FROM ${tbl.projects}`)) {
    const cover = row.cover_image?.startsWith('/img/') ? publicUrl + row.cover_image : row.cover_image
    const gallery = rewrite(row.gallery)
    if (cover !== row.cover_image || gallery !== row.gallery) {
      changed += (await query(`UPDATE ${tbl.projects} SET cover_image = ?, gallery = ? WHERE id = ?`, [cover, gallery, row.id])).affectedRows
    }
  }
  return changed
}

try {
  await withFtp(async (client) => {
    await client.ensureDir(dir)
    const existing = await client.list(dir)
    if (!existing.some((f) => f.name === '.htaccess')) {
      await client.uploadFrom(Readable.from([htaccess]), `${dir}/.htaccess`)
      console.log('✓ .htaccess (no folder listings, no scripts)')
    }
  })
  await uploadImages()

  // Only point the content at the media folder once its images really load over the web.
  const test = await fetch(`${publicUrl}/img/logo.jpg`, { method: 'HEAD' }).catch((err) => ({ ok: false, status: err.message }))
  if (!test.ok || !String(test.headers?.get('content-type')).startsWith('image/')) {
    throw new Error(`${publicUrl}/img/logo.jpg does not load (${test.status}). Check MEDIA_URL; saved content was not changed.`)
  }
  console.log(`✓ ${publicUrl}/img/logo.jpg loads`)

  let changed = 0
  for (let attempt = 1; ; attempt++) {
    try {
      changed += await pointContentAtMedia()
      break
    } catch (err) {
      // The database host sometimes drops a connection; the next try picks up where this one stopped.
      if (attempt >= 3 || !['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT'].includes(err.code)) throw err
    }
  }
  console.log(`✓ Saved content now uses the media folder (${changed} rows updated)`)
  console.log('Done.')
} catch (err) {
  if (err.status === 502) console.error('Failed: the FTP server could not be reached. Run `npm run media` again to continue.')
  else if (err.code === 'ER_NO_SUCH_TABLE') console.error('Images uploaded. Run `npm run setup` first, then `npm run media` again to update saved content.')
  else console.error('Failed:', err.code || '', err.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
