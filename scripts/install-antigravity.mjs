#!/usr/bin/env node
/**
 * Build and install the Antigravity plugin bundle for dsh-blender-plugin.
 *
 * Installs plugin.json, mcp_config.json, rules/AGENTS.md, README.md, and
 * skills/blender-modeling/ into ~/.gemini/config/plugins/blender-bridge/
 * (or a custom directory via --dir).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DEFAULT_PLUGIN_DIR = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'blender-bridge')

function parseOption(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === name && argv[i + 1]) return argv[i + 1]
    if (arg.startsWith(name + '=')) return arg.slice(name.length + 1)
  }
  return null
}

function copyRecursive(src, dst) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const ent of fs.readdirSync(src)) {
      if (ent === '__pycache__' || ent === '.DS_Store') continue
      copyRecursive(path.join(src, ent), path.join(dst, ent))
    }
    return
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
}

const argv = process.argv.slice(2)
const pluginDir = path.resolve(parseOption(argv, '--dir') || DEFAULT_PLUGIN_DIR)
const skipBuild = argv.includes('--skip-build')
const uninstall = argv.includes('--uninstall')
const portOpt = parseOption(argv, '--port')
const nodeBin = parseOption(argv, '--node') || process.execPath

if (uninstall) {
  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true })
    console.log('install-antigravity: removed ' + pluginDir)
  } else {
    console.log('install-antigravity: nothing to remove at ' + pluginDir)
  }
  process.exit(0)
}

if (!skipBuild) {
  for (const script of ['gen-routes.mjs', 'gen-gateway-schema.mjs']) {
    const gen = spawnSync(process.execPath, [path.join(HERE, script)], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    })
    if (gen.status !== 0) process.exit(gen.status ?? 1)
  }
  const built = spawnSync(process.execPath, [path.join(HERE, 'build.mjs'), 'all'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  })
  if (built.status !== 0) process.exit(built.status ?? 1)
}

const mcpEntry = path.join(ROOT, 'lib', 'mcp', 'index.js')
const gatewayEntry = path.join(ROOT, 'lib', 'runtime', 'gateway.js')
if (!fs.existsSync(mcpEntry) || !fs.existsSync(gatewayEntry)) {
  console.error(
    'install-antigravity: missing built artifacts (expected lib/mcp/index.js and lib/runtime/gateway.js). Run npm run build first.',
  )
  process.exit(1)
}

fs.mkdirSync(pluginDir, { recursive: true })

// Copy plugin manifest, README, and rules
const templateDir = path.join(ROOT, 'antigravity')
copyRecursive(path.join(templateDir, 'plugin.json'), path.join(pluginDir, 'plugin.json'))
copyRecursive(path.join(templateDir, 'README.md'), path.join(pluginDir, 'README.md'))
copyRecursive(path.join(templateDir, 'rules'), path.join(pluginDir, 'rules'))

// Copy bundled blender-modeling skill
const skillSrc = path.join(ROOT, 'skills', 'blender-modeling')
const skillDst = path.join(pluginDir, 'skills', 'blender-modeling')
if (fs.existsSync(skillDst)) fs.rmSync(skillDst, { recursive: true, force: true })
copyRecursive(skillSrc, skillDst)

// Generate mcp_config.json pointing to the built MCP stdio server
const args = [mcpEntry]
if (portOpt) {
  const n = Number(portOpt)
  if (!Number.isFinite(n) || n <= 0) {
    console.error('install-antigravity: invalid --port value: ' + portOpt)
    process.exit(2)
  }
  args.push('--port', String(Math.floor(n)))
}

const mcpConfig = {
  mcpServers: {
    'blender-bridge': {
      command: nodeBin,
      args,
    },
  },
}

fs.writeFileSync(
  path.join(pluginDir, 'mcp_config.json'),
  JSON.stringify(mcpConfig, null, 2) + '\n',
  'utf8',
)

console.log('install-antigravity: installed plugin to ' + pluginDir)
console.log('  MCP server : ' + nodeBin + ' ' + args.join(' '))
console.log('  Skill      : ' + path.join(skillDst, 'SKILL.md'))
console.log('  Blender ext: ' + path.join(ROOT, 'extension', 'dsh_blender_bridge.zip'))
