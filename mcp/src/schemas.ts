/** MCP tool definitions for the six Blender model-facing tools (3.1 surface). */

export interface JsonSchemaProperty {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  additionalProperties?: boolean
  items?: { type: string }
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, JsonSchemaProperty>
    required?: string[]
  }
}

const SESSION_ACTIONS = [
  'list',
  'status',
  'doctor',
  'attach',
  'claim',
  'detach',
  'release',
  'grant',
  'revoke',
  'grants',
  'pause',
  'resume',
  'mark_read',
  'presence',
  'heartbeat',
  'start',
  'stop',
  'txn',
  'help',
]

const OP_ACTIONS = ['plan', 'loop', 'opt', 'preset', 'help']
const RUN_ACTIONS = [
  'submit',
  'status',
  'wait',
  'collect',
  'cancel',
  'list',
  'perf',
  'tune',
  'help',
]

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'blender_session',
    description:
      '【会话 / 归属 / 权限】管理 GUI 会话：list/status/doctor 看状态；attach 附着到用户已打开的 Blender（多实例必须给 instance_id）；grant/revoke 管理写 scope（exclusive | collection:名 | prefix:名 | object:名）；pause/resume 仅人类可操作；mark_read 清掉 human_modified 冲突。start/stop 仅用于 virtual-gui；txn 子面提供 snapshot/restore/list/prune/mark/revert/marks/drop 事务快照与回滚。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: SESSION_ACTIONS.join(' | ') },
        session_id: { type: 'string', description: '会话 id（大多数会话级动作必填）' },
        instance_id: {
          type: 'string',
          description: 'attach/claim 时的 addon 实例 id（多实例必填；status 里能看到 instanceId）',
        },
        kind: { type: 'string', description: 'start 的会话类型，只接受 virtual-gui' },
        consent_token: {
          type: 'string',
          description: 'virtual-gui 经用户授权后的一次性 consent token（可选）',
        },
        scopes: {
          type: 'string',
          description:
            'grant / mark_read 的 scope 列表：exclusive、collection:COL、prefix:OBJ_、object:Cube；多个用逗号分隔',
        },
        target_agent_id: { type: 'string', description: 'grant 的目标 agent id' },
        target_dsh_session_id: { type: 'string', description: 'grant 的目标 session id' },
        target_host_id: { type: 'string', description: 'grant 的目标 host id' },
        grant_id: { type: 'string', description: 'revoke 的 grant id' },
        ttl_ms: { type: 'integer', description: 'grant 有效期毫秒（默认由 Gateway 决定）' },
        op: {
          type: 'string',
          description:
            'txn 子动作：snapshot | restore | list | prune | mark | revert | marks | drop | help（默认 list）',
        },
        label: { type: 'string', description: 'txn：快照 / mark 的名字' },
        note: { type: 'string', description: 'txn：snapshot 备注' },
        objects: { type: 'string', description: 'txn：mark 限定的对象（逗号分隔）' },
        keep: { type: 'integer', description: 'txn prune：保留最近 N 个快照' },
        into: { type: 'string', description: 'txn restore：auto | snapshot | original' },
        backup: { type: 'boolean', description: 'txn restore：是否先留 pre_restore 备份' },
        force: { type: 'boolean', description: '保留参数：由 Gateway 决定是否接受强抢语义' },
      },
      required: ['action'],
    },
  },
  {
    name: 'blender_op',
    description:
      '【算子】执行 catalog 的 plan 算子（34 family / 228 op；op=catalog 看目录），以及参数搜索 loop、对象精简 opt、配方库 preset。执行型 op 需要 ready 的 GUI 会话；catalog / 只读 op / args.dry_run=true 不需要会话，也不会启动 Blender。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: OP_ACTIONS.join(' | ') + '（默认 plan）' },
        op: {
          type: 'string',
          description:
            'plan：catalog 算子名（如 catalog / audit_mesh / img_digest / blockout_base / asm_scan / surface_loft；op=help 列 family）；loop: start|status|stop|board|export|help|bench；opt: analyze|join|help；preset: list|get|apply|save|delete|export|import|help',
        },
        args: {
          type: 'object',
          additionalProperties: true,
          description: 'plan/opt/preset 的参数对象（JSON），例如 {"family":"audit"}',
        },
        path: { type: 'string', description: 'plan report / loop export 的输出路径（可选）' },
        attach_images: {
          type: 'boolean',
          description: 'plan：是否把结果里的图回传给模型（默认按 op 决定）',
        },
        session: {
          type: 'string',
          description: 'loop target=session 时的无头 worker 名（默认 dsh-loop）',
        },
        target: {
          type: 'string',
          description: 'loop：gui（默认，GUI 内环）| session（持久无头 worker）',
        },
        spec: {
          type: 'object',
          additionalProperties: true,
          description: 'loop start：{setup, step, measure, iterations, budget_ms, ...}',
        },
        history: { type: 'integer', description: 'loop status：返回的指标尾迹长度，默认 8' },
        board: { type: 'integer', description: 'loop status：同时返回前 N 个候选，默认 0' },
        limit: { type: 'integer', description: 'loop board：候选条数，默认 10' },
        groups: { type: 'boolean', description: 'loop board：是否包含分组候选（默认 true）' },
        top: { type: 'integer', description: 'loop export：变体数量，默认 1' },
        include_variants: { type: 'boolean', description: 'loop export：是否导出候选表' },
        note: { type: 'string', description: 'loop export / preset save：备注' },
        iterations: { type: 'integer', description: 'loop bench：迭代次数，默认 5000' },
        name: { type: 'string', description: 'preset：配方名（get/apply/delete/save）' },
        kind: { type: 'string', description: 'preset：分类（material/object/scene）' },
        tags: { type: 'string', description: 'preset：标签（逗号分隔）' },
        names: {
          type: 'string',
          description: 'preset export：要导出的配方名（逗号分隔；省略=全部）',
        },
        targets: {
          type: 'string',
          description: 'preset apply：MAT:名 / OBJ:名 / SCENE（逗号分隔）',
        },
        data: {
          type: 'object',
          additionalProperties: true,
          description: 'preset save：点路径 JSON，如 {"inputs.Roughness":0.4}',
        },
        overwrite: {
          type: 'boolean',
          description: 'preset save/import：是否覆盖同名（默认 true）',
        },
      },
    },
  },
  {
    name: 'blender_py',
    description:
      '【执行 Python】在 ready 的 GUI 会话里跑 Python（/act 通道，固定 exclusive，不卡队列）。没有会话直接拒绝，不会自动启动 headless。超过 ~1s 的重活请改用 blender_run(kind=headless)。可选 see=true（默认）跑完顺手抓当前视口一帧。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要执行的 Python 源码（与 file 二选一）' },
        file: { type: 'string', description: '要执行的 .py 文件路径（与 code 二选一）' },
        see: { type: 'boolean', description: '跑完是否抓当前视口一帧（默认 true）' },
        max_size: { type: 'integer', description: 'see 的最长边像素，默认 560' },
        force: { type: 'boolean', description: 'see：同画面默认不重复附图，true 强制重发' },
        wait_ms: {
          type: 'integer',
          description: '等待其它 py 释放的毫秒数（0–5000，默认 0；占用中返回 py_busy）',
        },
      },
    },
  },
  {
    name: 'blender_see',
    description:
      '【看 GUI】只服务 GUI 会话：viewpoint=viewport（当前视口）/ camera（当前帧相机）/ custom（from+look_at 自定义机位），mode=frame（默认单帧）或 sequence（固定机位序列帧）。固定档位 aspect=1:1（544/768/1024/1280）、4:3（640/960/1280）、16:9（1024/1152/1280），默认 16:9+1024。不动用户视口；headless 渲染请用 blender_run(kind=render)。',
    inputSchema: {
      type: 'object',
      properties: {
        viewpoint: {
          type: 'string',
          description:
            'viewport（默认，当前 GUI 视口）| camera（当前帧相机）| custom（from+look_at）',
        },
        mode: { type: 'string', description: 'frame（默认，单帧）| sequence（固定机位序列帧）' },
        camera: {
          type: 'string',
          description: 'viewpoint=camera 时可选相机名；省略 = scene.camera',
        },
        aspect: {
          type: 'string',
          description: '1:1 | 4:3 | 16:9（默认 16:9）。viewport/custom/sequence 用；camera 不接受',
        },
        max_size: {
          type: 'integer',
          description:
            '固定档位：1:1 544/768/1024/1280；4:3 640/960/1280；16:9 1024/1152/1280；camera 544/768/1024/1280。默认 1024',
        },
        from: { type: 'string', description: '【custom】相机位置 "x,y,z"（世界坐标）' },
        look_at: { type: 'string', description: '【custom】看向的点 "x,y,z"' },
        lens: { type: 'number', description: '【custom】焦距 mm，默认 50' },
        ortho: { type: 'boolean', description: '【custom】正交投影（配合 ortho_scale）' },
        ortho_scale: { type: 'number', description: '【custom】正交尺度（贴长边），默认 10' },
        full: {
          type: 'boolean',
          description: 'frame+viewport：整窗口/区域截图（固定 1024 长边，看 Blender UI 时用）',
        },
        area: { type: 'integer', description: 'full=true 时的区域序号，默认 0（第 1 个区域）' },
        shading: {
          type: 'string',
          description: '【custom/sequence】临时着色 WIREFRAME/SOLID/MATERIAL/RENDERED，出图后还原',
        },
        overlays: { type: 'boolean', description: '【custom/sequence】临时开关覆盖物，出图后还原' },
        diagnostics: {
          type: 'boolean',
          description: '【frame+custom】强制跑覆盖率/空帧诊断（默认按需）',
        },
        seconds: { type: 'number', description: '【sequence】采样时长，0.2–20 秒，默认 2' },
        fps: {
          type: 'number',
          description: '【sequence】采样频率，0.5–8，默认 4；帧数 round(seconds*fps) ≤32',
        },
        force: { type: 'boolean', description: '同画面默认不重复附图；true 强制重发' },
      },
    },
  },
  {
    name: 'blender_run',
    description:
      '【作业 / 渲染】唯一异步作业入口：submit 立即返回 jobId，之后用 status/wait/collect/cancel/list/perf 跟踪。kind=render 是声明式最终渲染；kind=headless 是 fresh blender -b 跑脚本。队列有界：pending 64、GPU 1、CPU 2；wait 默认 120s、上限 600s，超时不取消作业。action=tune 提供 Cycles 渲染分析。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: RUN_ACTIONS.join(' | ') + '（默认：带 kind 则 submit，否则 list）',
        },
        kind: { type: 'string', description: 'submit：render（声明式渲染）| headless（跑脚本）' },
        id: { type: 'string', description: 'status/wait/collect/cancel 的 jobId' },
        priority: {
          type: 'integer',
          description: 'submit：队列优先级（-100..100，默认 0；越大越优先）',
        },
        timeout_ms: {
          type: 'integer',
          description:
            'wait：等待上限毫秒（默认 120000，最大 600000，超时不取消）；headless：进程上限',
        },
        tail: { type: 'integer', description: 'collect：日志尾部字符数，默认 4000' },
        state: {
          type: 'string',
          description: 'list：按状态过滤 queued/assigned/running/completed/failed/canceled',
        },
        owner: { type: 'string', description: 'list：按 session id 过滤' },
        file: { type: 'string', description: 'render：.blend 路径；headless：可选 .blend' },
        output: { type: 'string', description: 'render：输出文件模板（如 //render/frame_####）' },
        outdir: { type: 'string', description: 'render/headless：输出目录' },
        frames: {
          type: 'string',
          description: 'render：帧区间 "1-10" 或单帧 "5"；给了区间自动加 -a（相机动画）',
        },
        resolution: {
          type: 'array',
          items: { type: 'integer' },
          description: 'render：[width, height]',
        },
        samples: {
          type: 'integer',
          description: 'render：采样数（Cycles samples / EEVEE taa_render_samples）',
        },
        engine: {
          type: 'string',
          description:
            'render/headless：渲染引擎（CYCLES / BLENDER_EEVEE_NEXT / BLENDER_WORKBENCH）',
        },
        format: { type: 'string', description: 'render：图片格式（PNG/JPEG/OPEN_EXR…）' },
        camera: { type: 'string', description: 'render：场景相机对象名，或 "true" 使用默认相机' },
        script: { type: 'string', description: 'headless：Python 脚本内容（--python 临时文件）' },
        script_file: { type: 'string', description: 'headless：磁盘上的 .py 脚本路径' },
        preload: { type: 'string', description: 'headless：预载模块（逗号分隔）' },
        factory_startup: {
          type: 'boolean',
          description: 'headless：--factory-startup（默认 true）',
        },
        bootstrap: { type: 'boolean', description: 'headless：是否注入持久内核 K（默认 true）' },
        workdir: { type: 'string', description: 'headless：chdir + sys.path 首位' },
        include_noise: { type: 'boolean', description: 'headless：产物清单是否含噪音文件' },
        out_json: { type: 'string', description: 'headless：结构化结果落盘路径' },
        args: {
          type: 'string',
          description: 'headless：追加到 -- 之后的命令行参数；tune：JSON 字符串参数对象',
        },
        env: {
          type: 'object',
          additionalProperties: true,
          description: 'headless：子进程环境变量 {KEY:"VALUE"}',
        },
        op: {
          type: 'string',
          description: 'tune：status | analyze | apply | revert | help（默认 status）',
        },
      },
    },
  },
  {
    name: 'blender_inspect',
    description:
      '【只读检查】help 列出 addon 的可执行只读命令（name(args) / enabled / pause_safe / description）；command=<name> args={...} 执行其中一条。写操作请使用 blender_py / blender_op / blender_run / blender_session。',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '只读命令名；省略=help（列目录）。参数见 help 的 name(args)',
        },
        args: {
          type: 'object',
          additionalProperties: true,
          description: '命令参数对象，例如 {"name":"Cube"}（可选）',
        },
      },
    },
  },
]
