/**
 * MCP tool dispatcher: bridges MCP tools/call to the upstream 3.1 tool executors
 * (lib/tools/*) with an in-memory PNG attachment service and stable caller context.
 */
import { BACKEND_HINT } from '../constants.js'
import { asRecord, isRecord, text } from '../contracts/dynamic.js'
import { ensureBackend } from '../host/backend/index.js'
import type { HostContext } from '../host/context.js'
import { EXEC_CTX, type CallerInfo } from '../host/exec-context.js'
import { errorLine, toolError } from '../tools/errors.js'
import { executeInspect } from '../tools/inspect/execute.js'
import { legacyToolHint } from '../tools/migration.js'
import { executeOp } from '../tools/op/execute.js'
import { executePy } from '../tools/py/execute.js'
import { executeRun } from '../tools/run/execute.js'
import { executeSee } from '../tools/see/execute.js'
import { pngSize } from '../tools/see/presenter.js'
import { executeSession } from '../tools/session/execute.js'
import { requireReadySession, sessionRequiredFailure } from '../tools/shared/session.js'
import type { AttachmentRef } from '../utils/image.js'

export type McpContentBlock =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

export interface McpToolResult {
  content: McpContentBlock[]
  isError?: boolean
}

export interface CapturedImage {
  data: Uint8Array
  mediaType: string
  name: string
}

interface VirtualAttachmentHost {
  ctx: HostContext
  captured: Map<string, CapturedImage>
}

let callSeq = 0

function createVirtualHost(): VirtualAttachmentHost {
  const captured = new Map<string, CapturedImage>()
  let imgSeq = 0
  const attachmentsService = {
    imageLimits: { mediaTypes: ['image/png'] },
    async saveImage(input: {
      data: Uint8Array
      mediaType: string
      name: string
    }): Promise<AttachmentRef> {
      imgSeq += 1
      const attachmentId = 'mcp-img-' + String(Date.now()) + '-' + String(imgSeq)
      captured.set(attachmentId, {
        data: input.data,
        mediaType: input.mediaType || 'image/png',
        name: input.name,
      })
      const [width, height] = pngSize(input.data)
      return {
        attachmentId,
        mediaType: input.mediaType || 'image/png',
        bytes: input.data.byteLength,
        width,
        height,
        name: input.name,
      }
    },
  }
  const host = {
    get(serviceName: string): unknown {
      if (serviceName === 'attachments') return attachmentsService
      return undefined
    },
  }
  return { ctx: host as unknown as HostContext, captured }
}

function defaultCaller(callId: string): CallerInfo {
  return {
    hostId: process.env.DSH_HOST_ID || 'antigravity-pid-' + String(process.pid),
    dshSessionId: process.env.DSH_SESSION_ID || 'antigravity-session-' + String(process.pid),
    agentId: process.env.DSH_AGENT_ID || 'antigravity-main',
    role: 'main',
    callId,
    displayName: 'antigravity-mcp',
  }
}

function extractAttachmentIds(result: Record<string, unknown>): string[] {
  const ids: string[] = []
  const pushRef = (entry: unknown): void => {
    if (typeof entry === 'string' && entry) {
      ids.push(entry)
      return
    }
    if (isRecord(entry) && typeof entry.attachmentId === 'string' && entry.attachmentId) {
      ids.push(entry.attachmentId)
    }
  }
  pushRef(result.image)
  if (Array.isArray(result.images)) {
    for (const item of result.images) pushRef(item)
  }
  return ids
}

export function toMcpToolResult(raw: unknown, captured: Map<string, CapturedImage>): McpToolResult {
  const rec = asRecord(raw)
  const content: McpContentBlock[] = []
  const bodyText =
    typeof rec.text === 'string'
      ? rec.text
      : typeof raw === 'string'
        ? raw
        : JSON.stringify(raw ?? {})
  content.push({ type: 'text', text: bodyText })

  const seen = new Set<string>()
  const referencedIds = extractAttachmentIds(rec)
  for (const id of referencedIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const img = captured.get(id)
    if (!img) continue
    content.push({
      type: 'image',
      data: Buffer.from(img.data).toString('base64'),
      mimeType: img.mediaType,
    })
  }
  if (!referencedIds.length && captured.size > 0) {
    for (const img of captured.values()) {
      content.push({
        type: 'image',
        data: Buffer.from(img.data).toString('base64'),
        mimeType: img.mediaType,
      })
    }
  }

  const envelope = asRecord(rec.envelope)
  const isError = isRecord(envelope.error)
  return isError ? { content, isError: true } : { content }
}

async function runTool(
  ctx: HostContext,
  port: number,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'blender_session':
      return executeSession(port, args)
    case 'blender_op':
      return executeOp(ctx, port, args)
    case 'blender_py': {
      if (!(await ensureBackend(port)))
        return toolError(
          'gateway_unreachable',
          'Gateway 不可用（127.0.0.1:' + String(port) + '）',
          BACKEND_HINT,
        )
      const ready = await requireReadySession(port)
      if (!ready.ok) return ready.failure
      return executePy(ctx, port, args, ready.session)
    }
    case 'blender_see': {
      if (!(await ensureBackend(port)))
        return toolError(
          'gateway_unreachable',
          'Gateway 不可用（127.0.0.1:' + String(port) + '）',
          BACKEND_HINT,
        )
      const ready = await requireReadySession(port)
      if (!ready.ok) {
        const errCode = text(asRecord(asRecord(ready.failure).envelope).code)
        if (errCode === 'gateway_unreachable') return ready.failure
        return sessionRequiredFailure()
      }
      return executeSee(ctx, port, args, ready.session)
    }
    case 'blender_run':
      return executeRun(port, args)
    case 'blender_inspect':
      return executeInspect(port, args)
    default: {
      const hint = legacyToolHint(name)
      if (hint) {
        return toolError(
          'legacy_tool',
          hint,
          '请改用 3.1 六工具面（blender_session/op/py/see/run/inspect）',
        )
      }
      return toolError(
        'unknown_tool',
        '未知工具：' + name,
        '可用工具：blender_session | blender_op | blender_py | blender_see | blender_run | blender_inspect',
      )
    }
  }
}

export async function dispatchMcpTool(
  port: number,
  name: string,
  rawArgs: unknown,
  signal?: AbortSignal,
): Promise<McpToolResult> {
  callSeq += 1
  const callId = 'mcp-call-' + String(callSeq)
  const args = isRecord(rawArgs) ? rawArgs : {}
  const { ctx, captured } = createVirtualHost()
  const caller = defaultCaller(callId)
  try {
    const raw = await EXEC_CTX.run({ caller, signal }, () => runTool(ctx, port, name, args))
    return toMcpToolResult(raw, captured)
  } catch (err: unknown) {
    return {
      content: [
        {
          type: 'text',
          text: 'MCP 工具执行异常（' + name + '）：' + errorLine(err),
        },
      ],
      isError: true,
    }
  }
}
