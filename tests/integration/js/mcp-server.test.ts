import { afterAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { ensureBuild } from '../../helpers/ensure-build'
import { PKG_ROOT } from '../../helpers/pkg'

ensureBuild()

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = addr && typeof addr === 'object' ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

interface RpcResponse {
  jsonrpc: string
  id: number | string | null
  result?: any
  error?: { code: number; message: string }
}

class McpStdioClient {
  private child: ChildProcess
  private pending = new Map<number, (msg: RpcResponse) => void>()
  private nextId = 1
  private buffer = ''
  public stderr = ''

  constructor(port: number) {
    const entry = path.join(PKG_ROOT, 'lib', 'mcp', 'index.js')
    const env = { ...process.env }
    delete env.DSH_BLENDER_TEST_NO_SPAWN
    this.child = spawn(process.execPath, [entry, '--port', String(port)], {
      cwd: PKG_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      let idx = this.buffer.indexOf('\n')
      while (idx >= 0) {
        const line = this.buffer.slice(0, idx).trim()
        this.buffer = this.buffer.slice(idx + 1)
        if (line) {
          const parsed = JSON.parse(line) as RpcResponse
          const cb = typeof parsed.id === 'number' ? this.pending.get(parsed.id) : undefined
          if (cb) {
            this.pending.delete(parsed.id as number)
            cb(parsed)
          }
        }
        idx = this.buffer.indexOf('\n')
      }
    })
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString('utf8')
    })
  }

  request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 15000,
  ): Promise<RpcResponse> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('MCP request timed out: ' + method + ' (stderr: ' + this.stderr + ')'))
      }, timeoutMs)
      this.pending.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
      this.child.stdin?.write(payload + '\n')
    })
  }

  notify(method: string, params?: Record<string, unknown>): void {
    const payload = JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })
    this.child.stdin?.write(payload + '\n')
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          this.child.kill('SIGKILL')
        } catch {
          /* already exited */
        }
        resolve()
      }, 3000)
      this.child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      this.child.stdin?.end()
    })
  }
}

describe('Antigravity MCP stdio server', () => {
  let client: McpStdioClient | null = null
  let port = 0

  afterAll(async () => {
    if (client) await client.close()
  })

  it('handshakes over stdio, lists all 6 tools, and serves live Gateway calls', async () => {
    port = await freePort()
    client = new McpStdioClient(port)

    const init = await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '1.0.0' },
    })
    expect(init.error).toBeUndefined()
    expect(init.result.protocolVersion).toBe('2025-03-26')
    expect(init.result.serverInfo.name).toBe('blender-bridge')

    client.notify('notifications/initialized')

    const ping = await client.request('ping')
    expect(ping.error).toBeUndefined()
    expect(ping.result).toEqual({})

    const listed = await client.request('tools/list')
    expect(listed.error).toBeUndefined()
    const names = listed.result.tools.map((t: any) => t.name).sort()
    expect(names).toEqual([
      'blender_inspect',
      'blender_op',
      'blender_py',
      'blender_run',
      'blender_see',
      'blender_session',
    ])

    // Live Gateway call: blender_session status
    const status = await client.request('tools/call', {
      name: 'blender_session',
      arguments: { action: 'status' },
    })
    expect(status.error).toBeUndefined()
    expect(status.result.isError).toBeUndefined()
    expect(status.result.content[0].type).toBe('text')
    expect(status.result.content[0].text).toContain('Gateway')

    // Live Gateway call: blender_op catalog (34 families / 228 ops)
    const catalog = await client.request('tools/call', {
      name: 'blender_op',
      arguments: { action: 'plan', op: 'catalog' },
    })
    expect(catalog.error).toBeUndefined()
    expect(catalog.result.isError).toBeUndefined()
    expect(catalog.result.content[0].text).toContain('OP catalog ok')
    expect(catalog.result.content[0].text).toContain('audit')

    // Session-bound tool without GUI session returns structured error
    const seeNoSession = await client.request('tools/call', {
      name: 'blender_see',
      arguments: { viewpoint: 'viewport' },
    })
    expect(seeNoSession.error).toBeUndefined()
    expect(seeNoSession.result.isError).toBe(true)
    expect(seeNoSession.result.content[0].text).toContain('session_required')

    // Legacy tool returns migration guidance
    const legacy = await client.request('tools/call', {
      name: 'blender_rt_do',
      arguments: { code: 'pass' },
    })
    expect(legacy.error).toBeUndefined()
    expect(legacy.result.isError).toBe(true)
    expect(legacy.result.content[0].text).toContain('blender_py')
  }, 20000)

  it('converts captured PNG attachments into base64 MCP image content blocks', async () => {
    const mod = await import(path.join(PKG_ROOT, 'lib', 'mcp', 'dispatch.js'))
    const samplePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const captured = new Map([
      ['img-1', { data: samplePng, mediaType: 'image/png', name: 'frame.png' }],
      ['img-2', { data: samplePng, mediaType: 'image/png', name: 'seq.png' }],
    ])

    const single = mod.toMcpToolResult(
      { text: 'SEE viewport ok', image: { attachmentId: 'img-1' } },
      captured,
    )
    expect(single.isError).toBeUndefined()
    expect(single.content).toHaveLength(2)
    expect(single.content[0]).toEqual({ type: 'text', text: 'SEE viewport ok' })
    expect(single.content[1]).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: Buffer.from(samplePng).toString('base64'),
    })

    const sequence = mod.toMcpToolResult(
      { text: 'SEE sequence ok', images: ['img-1', 'img-2'] },
      captured,
    )
    expect(sequence.content).toHaveLength(3)
    expect(sequence.content[1].type).toBe('image')
    expect(sequence.content[2].type).toBe('image')
  })
})
