// Small helpers for cleaning user input.

export const str = (v, max = 255) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).trim().slice(0, max))

export const bool = (v) => v === true || v === 1 || v === '1' || v === 'true'

export const int = (v, fallback = 0) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

export const strList = (v, max = 500) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
    .map((s) => str(s, max))
    .filter(Boolean)

export function slugify(text) {
  return (
    str(text, 200)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 150) || 'project'
  )
}

// Links may be site paths (/about, #faq), web links or mailto/tel. Anything else (e.g. javascript:) is dropped.
export function safeUrl(v, max = 255) {
  const url = str(v, max)
  if (!url) return ''
  if (/^(\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i.test(url)) return url
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(url)) return `https://${url}` // "linkedin.com/company/x"
  return ''
}

// Image addresses: a path on this site (/img/…, /uploads/…) or a full web link (the FTP media folder).
export function imageUrl(v, max = 500) {
  const url = str(v, max)
  return /^(\/(?!\/)|https?:\/\/)/i.test(url) ? url : ''
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
