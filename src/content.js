// Reads and writes the editable site content (settings, menu, social links, pages).
import { parseJson, query, transaction, tbl } from './db.js'
import { bool, imageUrl, int, safeUrl, str } from './util.js'

export const SOCIAL_PLATFORMS = ['linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok', 'whatsapp', 'snapchat', 'threads']
export const SETTING_KEYS = ['company', 'headerCta', 'offices', 'stats']

/* ---------- settings ---------- */

export async function getSettings() {
  const rows = await query(`SELECT name, value FROM ${tbl.settings}`)
  return Object.fromEntries(rows.map((r) => [r.name, parseJson(r.value, null)]))
}

function cleanSetting(name, value) {
  switch (name) {
    case 'company': {
      const v = value || {}
      return {
        name: str(v.name, 120),
        legalName: str(v.legalName, 160),
        founded: int(v.founded, 2012),
        phone: str(v.phone, 40),
        fax: str(v.fax, 40),
        email: str(v.email, 160),
        whatsapp: str(v.whatsapp, 40),
        tagline: str(v.tagline, 200),
        licenseNote: str(v.licenseNote, 200),
        footerText: str(v.footerText, 600),
        logo: imageUrl(v.logo),
        footerLogo: imageUrl(v.footerLogo),
        favicon: imageUrl(v.favicon),
      }
    }
    case 'headerCta':
      return { label: str(value?.label, 40), url: safeUrl(value?.url) }
    case 'offices':
      return (Array.isArray(value) ? value : []).slice(0, 12).map((o) => ({
        city: str(o.city, 80),
        label: str(o.label, 80),
        address: str(o.address, 300),
        poBox: str(o.poBox, 80),
        mapQuery: str(o.mapQuery, 200),
        mapUrl: safeUrl(o.mapUrl),
      }))
    case 'stats':
      return (Array.isArray(value) ? value : [])
        .slice(0, 8)
        .map((s) => ({ value: str(s.value, 20), label: str(s.label, 80) }))
        .filter((s) => s.value || s.label)
    default:
      return undefined
  }
}

export async function saveSettings(values, { onlyMissing = false } = {}) {
  for (const name of SETTING_KEYS) {
    if (!(name in values)) continue
    const json = JSON.stringify(cleanSetting(name, values[name]))
    await query(
      onlyMissing
        ? `INSERT IGNORE INTO ${tbl.settings} (name, value) VALUES (?, ?)`
        : `INSERT INTO ${tbl.settings} (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [name, json],
    )
  }
}

/* ---------- header menu ---------- */

const toMenuItem = (r) => ({
  id: r.id,
  label: r.label,
  url: r.url,
  description: r.description || '',
  newTab: !!r.new_tab,
  visible: !!r.is_visible,
})

export async function getMenu({ includeHidden = false } = {}) {
  const rows = await query(
    `SELECT * FROM ${tbl.menu_items} ${includeHidden ? '' : 'WHERE is_visible = 1'} ORDER BY position, id`,
  )
  const top = rows.filter((r) => !r.parent_id).map((r) => ({ ...toMenuItem(r), children: [] }))
  const byId = new Map(top.map((t) => [t.id, t]))
  for (const r of rows) {
    if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id).children.push(toMenuItem(r))
  }
  return top
}

// Replaces the whole menu with `items` (two levels: items and their children).
export async function saveMenu(items) {
  const list = (Array.isArray(items) ? items : []).slice(0, 20)
  await transaction(async (conn) => {
    await conn.query(`DELETE FROM ${tbl.menu_items}`)
    const insert = (item, parentId, position) =>
      conn.query(
        `INSERT INTO ${tbl.menu_items} (parent_id, label, url, description, position, is_visible, new_tab) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          parentId,
          str(item.label, 100) || 'Untitled',
          safeUrl(item.url) || '/',
          str(item.description, 255),
          position,
          item.visible === undefined ? 1 : bool(item.visible) ? 1 : 0,
          bool(item.newTab) ? 1 : 0,
        ],
      )
    for (const [i, item] of list.entries()) {
      const [res] = await insert(item, null, i)
      const children = Array.isArray(item.children) ? item.children.slice(0, 20) : []
      for (const [j, child] of children.entries()) await insert(child, res.insertId, j)
    }
  })
}

/* ---------- social links ---------- */

export async function getSocial({ includeHidden = false } = {}) {
  const rows = await query(
    `SELECT * FROM ${tbl.social_links} ${includeHidden ? '' : "WHERE is_visible = 1 AND url <> ''"} ORDER BY position, id`,
  )
  return rows.map((r) => ({ id: r.id, platform: r.platform, url: r.url, visible: !!r.is_visible }))
}

export async function saveSocial(items) {
  const list = (Array.isArray(items) ? items : []).slice(0, 20)
  await transaction(async (conn) => {
    await conn.query(`DELETE FROM ${tbl.social_links}`)
    for (const [i, s] of list.entries()) {
      const platform = SOCIAL_PLATFORMS.includes(s.platform) ? s.platform : 'linkedin'
      const url = s.platform === 'whatsapp' && /^\+?[\d\s-]+$/.test(str(s.url)) ? str(s.url, 40) : safeUrl(s.url)
      await conn.query(`INSERT INTO ${tbl.social_links} (platform, url, position, is_visible) VALUES (?, ?, ?, ?)`, [
        platform,
        url,
        i,
        s.visible === undefined ? 1 : bool(s.visible) ? 1 : 0,
      ])
    }
  })
}

/* ---------- page content ---------- */

export async function getPages() {
  const rows = await query(`SELECT slug, title, content, updated_at FROM ${tbl.pages} ORDER BY slug`)
  return rows.map((r) => ({ slug: r.slug, title: r.title, content: parseJson(r.content, {}), updatedAt: r.updated_at }))
}

// Page content is a flat object of text fields and lists of text.
function cleanPageContent(content) {
  const out = {}
  for (const [key, value] of Object.entries(content || {}).slice(0, 80)) {
    if (!/^[a-zA-Z][\w]{0,59}$/.test(key)) continue
    if (Array.isArray(value)) out[key] = value.slice(0, 30).map((v) => str(v, 3000)).filter(Boolean)
    else out[key] = str(value, 5000)
  }
  return out
}

export async function savePage(slug, title, content, { onlyMissing = false } = {}) {
  const json = JSON.stringify(cleanPageContent(content))
  await query(
    onlyMissing
      ? `INSERT IGNORE INTO ${tbl.pages} (slug, title, content) VALUES (?, ?, ?)`
      : `INSERT INTO ${tbl.pages} (slug, title, content) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE content = VALUES(content)`,
    [slug, str(title, 120) || slug, json],
  )
}
