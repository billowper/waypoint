import { createServer, createConnection, type Server } from 'net'
import { createHash } from 'crypto'
import { userInfo } from 'os'
import { resolve } from 'path'

/**
 * A local pipe between the running app and the Claude Code connector (src/mcp). When Waypoint has
 * a vault open, the connector asks the app to save open editors before it changes a file, and to do
 * renames and moves itself, so tabs follow the file and the file watcher doesn't block folder renames.
 * When the app isn't running the connector works on the files directly.
 *
 * One request per connection: a JSON line in, a JSON line out. No Electron here (the connector uses it too).
 */

export type BridgeRequest =
  | { op: 'flush' }
  | { op: 'rename'; path: string; name: string }
  | { op: 'move'; path: string; dest: string }

/** Pipe name for a vault: per user and per vault folder, so two vaults (or users) never cross */
export function pipeFor(vaultRoot: string): string {
  const id = createHash('sha1').update(`${userInfo().username}|${resolve(vaultRoot).toLowerCase()}`).digest('hex').slice(0, 16)
  return process.platform === 'win32' ? `\\\\.\\pipe\\waypoint-${id}` : `/tmp/waypoint-${id}.sock`
}

/** App side: answer requests for the open vault. Returns the server so it can be closed on vault change. */
export function serveBridge(vaultRoot: string, handle: (req: BridgeRequest) => Promise<unknown>): Server {
  const server = createServer((sock) => {
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('data', async (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      const line = buf.slice(0, nl)
      buf = ''
      let reply: object
      try {
        reply = { ok: true, result: await handle(JSON.parse(line)) }
      } catch (e) {
        reply = { ok: false, error: (e as Error).message }
      }
      sock.end(JSON.stringify(reply) + '\n')
    })
    sock.on('error', () => {})
  })
  server.on('error', (e) => console.error('[bridge]', e.message))
  server.listen(pipeFor(vaultRoot))
  return server
}

/**
 * Connector side: ask the app. Resolves `{ running: false }` when no Waypoint has this vault open;
 * rejects with the app's error when it tried and failed.
 */
export function askApp(vaultRoot: string, req: BridgeRequest, timeoutMs = 20000): Promise<{ running: boolean; result?: unknown }> {
  return new Promise((done, fail) => {
    const sock = createConnection(pipeFor(vaultRoot))
    let buf = ''
    let connected = false
    const timer = setTimeout(() => {
      sock.destroy()
      fail(new Error('Waypoint did not answer in time'))
    }, timeoutMs)
    sock.setEncoding('utf8')
    sock.on('connect', () => {
      connected = true
      sock.write(JSON.stringify(req) + '\n')
    })
    sock.on('data', (chunk) => (buf += chunk))
    sock.on('end', () => {
      clearTimeout(timer)
      try {
        const reply = JSON.parse(buf)
        reply.ok ? done({ running: true, result: reply.result }) : fail(new Error(reply.error))
      } catch {
        fail(new Error('Waypoint gave an unreadable answer'))
      }
    })
    sock.on('error', (e) => {
      clearTimeout(timer)
      connected ? fail(e) : done({ running: false })
    })
  })
}
