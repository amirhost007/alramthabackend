// Keeps the last good answer of each public API request (in memory and in backend/cache/), and serves it
// when the database can't be reached, so the website keeps showing its content during a database problem,
// even after the backend restarts. Admin requests never use this: they always need the real data.
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

const dir = path.join(config.uploadsDir, '..', 'cache')
const memory = new Map()
const MAX_ENTRIES = 500

const fileOf = (key) => path.join(dir, `${key.replace(/[^a-z0-9-]/gi, '_').slice(0, 120)}.json`)

async function remember(key, data) {
  const json = JSON.stringify(data)
  if (memory.get(key)?.json === json) return
  if (!memory.has(key) && memory.size >= MAX_ENTRIES) memory.delete(memory.keys().next().value)
  memory.set(key, { json, data })
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(fileOf(key), json)
  } catch (err) {
    console.error('Could not save the fallback copy:', err.message)
  }
}

async function recall(key) {
  if (memory.has(key)) return memory.get(key).data
  try {
    const data = JSON.parse(await fs.readFile(fileOf(key), 'utf8'))
    memory.set(key, { json: JSON.stringify(data), data })
    return data
  } catch {
    return undefined
  }
}

// Runs `load()`; on success remembers the result, on a server-side failure answers with the last good copy.
// Errors meant for the visitor (4xx) are passed on as they are.
export async function withFallback(key, res, load) {
  try {
    const data = await load()
    if (data !== undefined && data !== null) remember(key, data)
    return data
  } catch (err) {
    if (err.status && err.status < 500) throw err
    const copy = await recall(key)
    if (copy === undefined) throw err
    console.error(`Database problem (${err.code || err.message}); serving the saved copy of "${key}".`)
    res.set('X-Content-Fallback', 'saved-copy')
    return copy
  }
}
