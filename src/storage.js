// Saves uploaded images. With FTP settings in .env they go to the hosting account over FTP (TLS)
// and are served from MEDIA_URL; otherwise they are written to backend/uploads and served by this app.
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { Client } from 'basic-ftp'
import { config } from './config.js'

// Opens one FTP session, runs `fn(client)`, and always closes it.
export async function withFtp(fn) {
  const { host, port, user, password, secure } = config.ftp
  const client = new Client(30000)
  try {
    await client.access({ host, port, user, password, secure })
    return await fn(client)
  } catch (err) {
    console.error('FTP error:', err.code || '', err.message)
    throw Object.assign(new Error('The image could not be saved to the media server. Please try again.'), { status: 502, cause: err })
  } finally {
    client.close()
  }
}

// files: [{ name, buffer }]. Returns the public URL of each file, in order.
export async function saveImages(files) {
  const now = new Date()
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}` // e.g. 2026/11

  if (config.ftp) {
    return withFtp(async (client) => {
      await client.ensureDir(`${config.ftp.dir}/uploads/${month}`) // creates it if needed and moves into it
      for (const f of files) await client.uploadFrom(Readable.from(f.buffer), f.name)
      return files.map((f) => `${config.ftp.publicUrl}/uploads/${month}/${f.name}`)
    })
  }

  const dir = path.join(config.uploadsDir, ...month.split('/'))
  await fs.mkdir(dir, { recursive: true })
  for (const f of files) await fs.writeFile(path.join(dir, f.name), f.buffer)
  return files.map((f) => `/uploads/${month}/${f.name}`)
}
