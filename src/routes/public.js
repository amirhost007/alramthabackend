import { Router } from 'express'
import { getMenu, getPages, getSettings, getSocial } from '../content.js'
import { getProjectBySlug, listProjects } from '../projects.js'
import { query, tbl } from '../db.js'
import { rateLimit } from '../auth.js'
import { withFallback } from '../fallback.js'
import { str } from '../util.js'

const router = Router()

// The website's content requests answer with the last good copy if the database has a problem (fallback.js).

// Everything the website needs on first load, in one request.
router.get('/site', async (req, res) => {
  const site = await withFallback('site', res, async () => {
    const [settings, menu, social, pages] = await Promise.all([getSettings(), getMenu(), getSocial(), getPages()])
    return { settings, menu, social, pages: Object.fromEntries(pages.map((p) => [p.slug, p.content])) }
  })
  res.set('Cache-Control', 'no-cache')
  res.json(site)
})

router.get('/projects', async (req, res) => {
  const projects = await withFallback('projects', res, async () =>
    (await listProjects({ publishedOnly: true })).map(({ body, gallery, ...p }) => p),
  )
  res.json(projects)
})

router.get('/projects/:slug', async (req, res) => {
  const slug = str(req.params.slug, 160)
  const project = await withFallback(`project-${slug}`, res, () => getProjectBySlug(slug))
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  res.json(project)
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

router.post(
  '/enquiries',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 5, message: 'Too many messages. Please try again in a few minutes.' }),
  async (req, res) => {
    const b = req.body || {}
    // Hidden "website" field: real visitors leave it empty, bots fill it in.
    if (str(b.website)) return res.status(201).json({ ok: true })
    const data = {
      name: str(b.name, 160),
      email: str(b.email, 190),
      phone: str(b.phone, 60),
      company: str(b.company, 160),
      service: str(b.service, 160),
      message: str(b.message, 5000),
    }
    if (!data.name || !EMAIL_RE.test(data.email) || !data.message) {
      return res.status(400).json({ error: 'Please fill in your name, a valid email and a message.' })
    }
    await query(`INSERT INTO ${tbl.enquiries} SET ?`, [data])
    res.status(201).json({ ok: true })
  },
)

export default router
