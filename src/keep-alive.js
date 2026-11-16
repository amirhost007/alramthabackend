// Render's free plan stops a web service after 15 minutes without requests, and the next visitor then waits
// about a minute while it starts again. While the backend runs, it calls its own public address every
// 14 minutes (KEEP_ALIVE_MINUTES), which counts as a request, so the service never goes to sleep.
import { config } from './config.js'

export function startKeepAlive() {
  const { url, minutes } = config.keepAlive
  if (!url) return // e.g. on your own computer

  const target = `${url}/api/health`
  let failures = 0

  const ping = async () => {
    try {
      const res = await fetch(target, {
        headers: { 'User-Agent': 'alramtha-keep-alive' },
        signal: AbortSignal.timeout(60000),
      })
      if (!res.ok) throw new Error(`answered ${res.status}`)
      if (failures) console.log(`Keep-alive: ${target} answers again`)
      failures = 0
    } catch (err) {
      failures++
      console.error(`Keep-alive: ${target} failed (${err.message})${failures > 1 ? `, ${failures} times in a row` : ''}`)
    }
  }

  setInterval(ping, minutes * 60 * 1000)
  console.log(`Keep-alive: calling ${target} every ${minutes} minutes`)
}

export const keepAliveStatus = () => (config.keepAlive.url ? `every ${config.keepAlive.minutes} minutes` : 'off')
