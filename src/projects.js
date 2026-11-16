import { parseJson, query, tbl } from './db.js'
import { bool, int, slugify, str, strList, HttpError } from './util.js'

const toProject = (r) => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  client: r.client,
  location: r.location,
  sector: r.sector,
  year: r.year,
  summary: r.summary,
  body: r.body || '',
  scope: parseJson(r.scope, []),
  coverImage: r.cover_image,
  gallery: parseJson(r.gallery, []),
  featured: !!r.is_featured,
  published: !!r.is_published,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const ORDER = 'ORDER BY position ASC, created_at DESC, id DESC'

export async function listProjects({ publishedOnly = true } = {}) {
  const rows = await query(`SELECT * FROM ${tbl.projects} ${publishedOnly ? 'WHERE is_published = 1' : ''} ${ORDER}`)
  return rows.map(toProject)
}

export async function getProjectBySlug(slug) {
  const [row] = await query(`SELECT * FROM ${tbl.projects} WHERE slug = ? AND is_published = 1`, [str(slug, 160)])
  return row ? toProject(row) : null
}

export async function getProject(id) {
  const [row] = await query(`SELECT * FROM ${tbl.projects} WHERE id = ?`, [int(id)])
  return row ? toProject(row) : null
}

async function uniqueSlug(wanted, excludeId = 0) {
  const base = slugify(wanted)
  for (let n = 1; n < 500; n++) {
    const slug = n === 1 ? base : `${base}-${n}`
    const [hit] = await query(`SELECT id FROM ${tbl.projects} WHERE slug = ? AND id <> ?`, [slug, excludeId])
    if (!hit) return slug
  }
  throw new HttpError(409, 'Could not create a unique web address for this project.')
}

const imagePath = (v) => {
  const s = str(v, 255)
  return /^(\/|https?:\/\/)/i.test(s) ? s : ''
}

function clean(data) {
  const title = str(data.title, 200)
  if (!title) throw new HttpError(400, 'Please give the project a title.')
  return {
    title,
    client: str(data.client, 160),
    location: str(data.location, 160),
    sector: str(data.sector, 80),
    year: str(data.year, 10),
    summary: str(data.summary, 500),
    body: str(data.body, 20000),
    scope: JSON.stringify(strList(data.scope, 300).slice(0, 30)),
    cover_image: imagePath(data.coverImage),
    gallery: JSON.stringify(strList(data.gallery, 255).map(imagePath).filter(Boolean).slice(0, 30)),
    is_featured: bool(data.featured) ? 1 : 0,
    is_published: bool(data.published) ? 1 : 0,
    position: int(data.position, 0),
  }
}

export async function createProject(data) {
  const row = clean(data)
  row.slug = await uniqueSlug(data.slug || row.title)
  const res = await query(`INSERT INTO ${tbl.projects} SET ?`, [row])
  return getProject(res.insertId)
}

export async function updateProject(id, data) {
  const existing = await getProject(id)
  if (!existing) throw new HttpError(404, 'Project not found.')
  const row = clean(data)
  row.slug = await uniqueSlug(data.slug || existing.slug || row.title, existing.id)
  await query(`UPDATE ${tbl.projects} SET ? WHERE id = ?`, [row, existing.id])
  return getProject(existing.id)
}

export async function deleteProject(id) {
  const res = await query(`DELETE FROM ${tbl.projects} WHERE id = ?`, [int(id)])
  if (!res.affectedRows) throw new HttpError(404, 'Project not found.')
}
