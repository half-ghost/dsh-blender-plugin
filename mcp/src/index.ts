#!/usr/bin/env node
/**
 * Antigravity / standard MCP stdio server entry for dsh-blender-plugin.
 *
 * Manages the local Blender Gateway lifecycle (auto-start, watchdog, clean shutdown)
 * and exposes the 6 upstream Blender tools over MCP stdio.
 */
import {
  ensureBackend,
  isPaused,
  killBackendByCmd,
  killChildHandle,
  probe,
  resolveHttpPort,
  sleep,
} from '../host/backend/index.js'
import {
  canRestartGateway,
  noteGatewayRestartFailure,
  noteGatewayRestartSuccess,
} from '../host/backend/restart.js'
import { startStdioMcpServer } from './stdio.js'

// Protect MCP JSON-RPC stdout from accidental console.log output.
console.log = (...args: unknown[]): void => {
  console.error(...args)
}

function parsePortFlag(argv: string[]): number | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' && argv[i + 1]) {
      const n = Number(argv[i + 1])
      if (Number.isFinite(n) && n > 0) return n
    } else if (arg.startsWith('--port=')) {
      const n = Number(arg.slice('--port='.length))
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

const argv = process.argv.slice(2)
const port = parsePortFlag(argv) ?? resolveHttpPort()
const autoStart = !argv.includes('--no-autostart') && process.env.DSH_BLENDER_AUTOSTART !== '0'

let probeMisses = 0
let watchdog: ReturnType<typeof setInterval> | null = null
let cleaned = false

function cleanup(): void {
  if (cleaned) return
  cleaned = true
  if (watchdog) {
    clearInterval(watchdog)
    watchdog = null
  }
  killChildHandle()
}

if (autoStart) {
  void (async () => {
    if (!isPaused()) {
      if (await ensureBackend(port)) noteGatewayRestartSuccess()
      else noteGatewayRestartFailure()
    }
  })()

  watchdog = setInterval(() => {
    void (async () => {
      try {
        if (isPaused()) return
        if (await probe(port)) {
          probeMisses = 0
          noteGatewayRestartSuccess()
          return
        }
        probeMisses += 1
        if (probeMisses >= 2) {
          probeMisses = 0
          try {
            killBackendByCmd(port, 'SIGTERM')
          } catch {
            /* ignore */
          }
          await sleep(1200)
          try {
            killBackendByCmd(port, 'SIGKILL')
          } catch {
            /* ignore */
          }
        }
        if (!canRestartGateway()) return
        if (await ensureBackend(port)) noteGatewayRestartSuccess()
        else noteGatewayRestartFailure()
      } catch {
        /* keep watchdog resilient */
      }
    })()
  }, 15000)
  watchdog.unref()
}

const server = startStdioMcpServer({
  port,
  onClose: () => {
    cleanup()
  },
})

const onSignal = (): void => {
  server.stop()
  cleanup()
  process.exit(0)
}

process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)
process.once('exit', cleanup)
