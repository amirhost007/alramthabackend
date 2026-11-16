import path from 'node:path'
import crypto from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../auth.js'
import { query, tbl } from '../db.js'
import {
  SETTING_KEYS,
  SOCIAL_PLATFORMS,
  getMenu,
  getPages,
  getSettings,
  getSocial,
  saveMenu,
  savePage,
  saveSettings,
  saveSocial,
} from '../content.js'
import { createProject, deleteProject, getProject, listProjects, updateProject } from '../projects.js'
import { saveImages } from '../storage.js'
import { bool, int, str } from '../util.js'

const router = Router()
router.use(requireAuth)

router.get('/overview', async (req, res) => {
  const [[p], [e], [m], pages] = await Promise.all([
    query(`SELECT COUNT(*) total, SUM(is_published) published, SUM(is_featured) featured FROM ${tbl.projects}`),
    query(`SELECT COUNT(*) total, SUM(is_read = 0) unread FROM ${tbl.enquiries}`),
    query(`SELECT COUNT(*) total FROM ${tbl.menu_items}`),
    query(`SELECT slug, title, updated_at FROM ${tbl.pages} ORDER BY updated_at DESC LIMIT 5`),
  ])
  const latest = await query(`SELECT id, name, company, service, created_at, is_read FROM ${tbl.enquiries} ORDER BY id DESC LIMIT 5`)
  res.json({
    projects: { total: Number(p.total), published: Number(p.published || 0), featured: Number(p.featured || 0) },
    enquiries: { total: Number(e.total), unread: Number(e.unread || 0), latest },
    menuItems: Number(m.total),
    recentPages: pages,
  })
})

/* ---------- settings (company, contact, offices, figures, header button) ---------- */

router.get('/settings', async (req, res) => res.json(await getSettings()))

router.put('/settings', async (req, res) => {
  const body = req.body || {}
  const values = Object.fromEntries(SETTING_KEYS.filter((k) => k in body).map((k) => [k, body[k]]))
  await saveSettings(values)
  res.json(await getSettings())
})

/* ---------- header menu ---------- */

router.get('/menu', async (req, res) => res.json(await getMenu({ includeHidden: true })))

router.put('/menu', async (req, res) => {
  await saveMenu(req.body?.items)
  res.json(await getMenu({ includeHidden: true }))
})

/* ---------- social accounts ---------- */

router.get('/social', async (req, res) => res.json({ platforms: SOCIAL_PLATFORMS, items: await getSocial({ includeHidden: true }) }))

router.put('/social', async (req, res) => {
  await saveSocial(req.body?.items)
  res.json({ platforms: SOCIAL_PLATFORMS, items: await getSocial({ includeHidden: true }) })
})

/* ---------- page content ---------- */

router.get('/pages', async (req, res) => res.json(await getPages()))

router.put('/pages/:slug', async (req, res) => {
  const slug = str(req.params.slug, 60)
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) return res.status(400).json({ error: 'Invalid page.' })
  await savePage(slug, req.body?.title || slug, req.body?.content || {})
  const page = (await getPages()).find((p) => p.slug === slug)
  res.json(page)
})

/* ---------- projects ---------- */

router.get('/projects', async (req, res) => res.json(await listProjects({ publishedOnly: false })))

router.get('/projects/:id', async (req, res) => {
  const project = await getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  res.json(project)
})

router.post('/projects', async (req, res) => res.status(201).json(await createProject(req.body || {})))

router.put('/projects/:id', async (req, res) => res.json(await updateProject(req.params.id, req.body || {})))

router.delete('/projects/:id', async (req, res) => {
  await deleteProject(req.params.id)
  res.status(204).end()
})

/* ---------- image uploads (to the FTP media folder, see storage.js) ---------- */

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }

// The file extension always comes from the checked image type, never from the uploaded name.
const safeName = (file) => {
  const base = path
    .parse(file.originalname)
    .name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${base || 'image'}-${crypto.randomBytes(4).toString('hex')}${IMAGE_TYPES[file.mimetype]}`
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) cb(null, true)
    else cb(Object.assign(new Error('Only JPG, PNG, WebP, GIF or AVIF images can be uploaded.'), { status: 400 }))
  },
})

router.post('/upload', upload.array('files', 20), async (req, res) => {
  const files = (req.files || []).map((f) => ({ name: safeName(f), buffer: f.buffer, originalName: f.originalname, size: f.size }))
  if (!files.length) return res.status(400).json({ error: 'Please choose an image.' })
  const urls = await saveImages(files)
  res.status(201).json({ files: files.map((f, i) => ({ url: urls[i], name: f.originalName, size: f.size })) })
})

/* ---------- enquiries from the contact form ---------- */

router.get('/enquiries', async (req, res) => {
  res.json(await query(`SELECT * FROM ${tbl.enquiries} ORDER BY id DESC LIMIT 500`))
})

router.patch('/enquiries/:id', async (req, res) => {
  await query(`UPDATE ${tbl.enquiries} SET is_read = ? WHERE id = ?`, [bool(req.body?.isRead) ? 1 : 0, int(req.params.id)])
  res.json({ ok: true })
})

router.delete('/enquiries/:id', async (req, res) => {
  await query(`DELETE FROM ${tbl.enquiries} WHERE id = ?`, [int(req.params.id)])
  res.status(204).end()
})

export default router
