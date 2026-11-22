# Antigravity × Blender Bridge

本仓库已适配为 **Google Antigravity 插件**（MCP Server + Skill + Rule），完整复用原仓的 3.1 后端 Gateway、`runtime/py/`（34 family / 228 op）、`extension/dsh_blender_bridge.zip`（Blender 扩展）以及 `skills/blender-modeling/` 建模技能。

## 1. 环境要求

- **Node.js**：推荐 `>= 22`（原仓 CI 为 `24.9+`，实测 Node `22.14+` 可正常构建与运行）
- **Python**：`>= 3.11`（用于 Blender 侧脚本与可选本地测试）
- **Blender**：`4.2 LTS`（推荐；4.x 通常可用）

## 2. 安装步骤

### 第一步：在 Blender 中安装配套扩展

1. 打开 Blender 4.2 LTS → **编辑 (Edit) → 偏好设置 (Preferences) → 扩展/插件 (Get Extensions / Add-ons)**。
2. 从磁盘安装本仓库中的 `extension/dsh_blender_bridge.zip` 并启用 **DSH Blender Bridge**。
3. 如果之前装过 `blender-mcp` / `MCP for Blender` 等其他桥接插件，请先**停用**以免端口/桥接冲突。
4. 在 3D 视图按 `N` 打开侧边栏，找到 **DSH Blender Bridge** 面板，点击 **Connect**（连接到本地 Gateway `127.0.0.1:39877`）。

### 第二步：构建并安装 Antigravity 插件

在仓库根目录执行：

```bash
npm ci --legacy-peer-deps
npm run install:antigravity
```

该脚本会自动完成：
1. 编译 `runtime/` → `lib/runtime/`、`src/` → `lib/`、`mcp/src/` → `lib/mcp/`；
2. 将插件安装到 `~/.gemini/config/plugins/blender-bridge/`，包含：
   - `plugin.json`（插件清单）
   - `mcp_config.json`（指向本仓库 `lib/mcp/index.js` 的 Stdio MCP Server）
   - `rules/AGENTS.md`（建模工具使用规范）
   - `skills/blender-modeling/`（完整建模 SOP 与参考文档）

> 可选参数：
> - `--port <端口>`：指定自定义 Gateway 端口（默认 `39877`）
> - `--dir <目录>`：指定自定义插件安装目录
> - `--skip-build`：跳过 TypeScript 构建直接刷新插件文件
> - `--uninstall`：卸载 `~/.gemini/config/plugins/blender-bridge/`

## 3. 验证是否可用

在 Antigravity 中（插件加载后的下一轮对话）直接让 Agent 执行：

- `blender_session(action="doctor")` — 确认 Gateway 与 Blender addon 连通（`kind=ok`）；
- `blender_op(op="catalog")` — 列出 34 个 family / 228 个建模与质检算子；
- `blender_session(action="attach")` — 附着到已打开的 Blender GUI 会话；
- `blender_py(code="...", see=true)` / `blender_see(...)` — 执行建模并直接回传视口截图。

## 4. 架构说明

```text
Antigravity Agent
  -> MCP Stdio (lib/mcp/index.js)
  -> Upstream Tool Executors (lib/tools/*) + In-Memory PNG Bridge
  -> Local Gateway HTTP (127.0.0.1:39877)
  <- WebSocket /addon (reverse connection from Blender)
  -> Blender Extension (extension/dsh_blender_bridge.zip) -> bpy
```

- 零额外运行时 npm 依赖，保留全部原仓 `src/`、`runtime/`、`extension/`、`skills/` 行为与测试门禁。
- 仅不承载 DSH 宿主专属前端外壳（TUI 底部状态栏、`@` 补全、选中物体发往 DSH 输入框、DSH 卡片 UI）。
