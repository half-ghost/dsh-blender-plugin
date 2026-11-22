/**
 * Minimal zero-dependency MCP JSON-RPC 2.0 stdio transport.
 *
 * Implements the MCP tool server lifecycle (initialize, ping, tools/list,
 * tools/call, notifications/cancelled) over newline-delimited JSON on stdin/stdout.
 */
import { PLUGIN_VERSION } from '../constants.js'
import { asRecord, isRecord } from '../contracts/dynamic.js'
import { dispatchMcpTool } from './dispatch.js'
import { MCP_TOOLS } from './schemas.js'

const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05'])
const DEFAULT_PROTOCOL_VERSION = '2025-03-26'

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: unknown
}

export interface StdioServerOptions {
  port: number
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  onClose?: () => void
}

export function startStdioMcpServer(options: StdioServerOptions): { stop: () => void } {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const inFlight = new Map<string, AbortController>()
  let buffer = ''
  let closed = false

  const writeMessage = (payload: Record<string, unknown>): void => {
    if (closed) return
    output.write(JSON.stringify(payload) + '\n')
  }

  const sendResult = (id: JsonRpcId, result: unknown): void => {
    writeMessage({ jsonrpc: '2.0', id, result })
  }

  const sendError = (id: JsonRpcId, code: number, message: string, data?: unknown): void => {
    const error: Record<string, unknown> = { code, message }
    if (data !== undefined) error.data = data
    writeMessage({ jsonrpc: '2.0', id, error })
  }

  const handleRequest = async (msg: JsonRpcRequest): Promise<void> => {
    const method = typeof msg.method === 'string' ? msg.method : ''
    const hasId = msg.id !== undefined && msg.id !== null
    const id: JsonRpcId = hasId ? (msg.id as JsonRpcId) : null

    if (method === 'notifications/initialized') return

    if (method === 'notifications/cancelled') {
      const params = asRecord(msg.params)
      const reqId = params.requestId
      if (reqId !== undefined && reqId !== null) {
        const ac = inFlight.get(String(reqId))
        if (ac) ac.abort()
      }
      return
    }

    if (method === 'initialize') {
      const params = asRecord(msg.params)
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION
      if (hasId) {
        sendResult(id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: {
            name: 'blender-bridge',
            version: PLUGIN_VERSION,
          },
        })
      }
      return
    }

    if (method === 'ping') {
      if (hasId) sendResult(id, {})
      return
    }

    if (method === 'tools/list') {
      if (hasId) sendResult(id, { tools: MCP_TOOLS })
      return
    }

    if (method === 'resources/list') {
      if (hasId) sendResult(id, { resources: [] })
      return
    }

    if (method === 'prompts/list') {
      if (hasId) sendResult(id, { prompts: [] })
      return
    }

    if (method === 'tools/call') {
      if (!hasId) return
      const params = asRecord(msg.params)
      const toolName = typeof params.name === 'string' ? params.name : ''
      if (!toolName) {
        sendError(id, -32602, 'Invalid params: missing tool name')
        return
      }
      const ac = new AbortController()
      const key = String(id)
      inFlight.set(key, ac)
      try {
        const result = await dispatchMcpTool(options.port, toolName, params.arguments, ac.signal)
        sendResult(id, result)
      } catch (err: unknown) {
        sendError(id, -32603, err instanceof Error ? err.message : String(err))
      } finally {
        inFlight.delete(key)
      }
      return
    }

    if (hasId) {
      sendError(id, -32601, 'Method not found: ' + method)
    }
  }

  const processLine = (rawLine: string): void => {
    const line = rawLine.trim()
    if (!line) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      sendError(null, -32700, 'Parse error')
      return
    }
    if (!isRecord(parsed)) {
      sendError(null, -32600, 'Invalid Request')
      return
    }
    void handleRequest(parsed as JsonRpcRequest)
  }

  const onData = (chunk: Buffer | string): void => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let idx = buffer.indexOf('\n')
    while (idx >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      processLine(line)
      idx = buffer.indexOf('\n')
    }
  }

  const stop = (): void => {
    if (closed) return
    closed = true
    for (const ac of inFlight.values()) ac.abort()
    inFlight.clear()
    input.off('data', onData)
    options.onClose?.()
  }

  input.on('data', onData)
  input.once('end', () => {
    if (buffer.trim()) {
      const tail = buffer
      buffer = ''
      processLine(tail)
    }
    stop()
  })
  input.once('close', stop)
  input.resume()

  return { stop }
}
