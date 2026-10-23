// build: 2026-10-23 19:0x gen module
/**
 * 翻唱工作台 · Host 半。
 * 路由给界面用，工具给 Agent 用，两者都走 pipeline.js 里的同一套任务函数。
 */
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildGenSong,
  cancelJob,
  createGenTask,
  createProject,
  deleteProject,
  genRenderingIds,
  genToolchain,
  getJob,
  historyFile,
  historyReadyPromise,
  jobSummaryText,
  listGenProjects,
  listJobs,
  listProjects,
  listSongs,
  makeRef,
  renderGenSong,
  tidyGenProject,
  renameProject,
  revealInExplorer,
  startJob,
  streamMedia,
  COVER_PROJECTS,
  GEN_PROJECTS,
  PROJECTS,
  ROOT,
  SOURCE,
} from './pipeline.js'

const ROUTE = '/api/dsh-singer'

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 256 * 1024) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw)
}

function route(method, handler) {
  return async (req, res) => {
    try {
      if (method === 'POST' && req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '需要 POST' })
      if (method === 'GET' && req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { ok: false, error: '需要 GET' })
      }
      const body = method === 'POST' ? await readJson(req) : {}
      const payload = await handler(body, req)
      return sendJson(res, 200, { ok: true, ...(payload || {}) })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

function parseIni(text) {
  const sections = {}
  let sec = 'root'
  sections[sec] = {}
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const head = line.match(/^\[(.+)\]$/)
    if (head) {
      sec = head[1].trim().toLowerCase()
      sections[sec] = sections[sec] || {}
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    sections[sec] = sections[sec] || {}
    sections[sec][line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return sections
}

/** 读取各工作区里的 persona*.ini（人格），供生成任务选用。 */
async function readWorkspacePersonas(ctx) {
  const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : null
  const workspaces = registry && typeof registry.list === 'function' ? registry.list() : []
  const targets = workspaces.length ? workspaces : [{ id: 'local', title: ROOT, path: ROOT }]
  const out = []
  for (const ws of targets) {
    if (!ws || !ws.path || !existsSync(ws.path)) continue
    let files = []
    try {
      files = (await readdir(ws.path)).filter((name) => /^persona.*\.ini$/i.test(name))
    } catch {
      continue
    }
    for (const file of files) {
      const path = join(ws.path, file)
      let text = ''
      try {
        text = await readFile(path, 'utf8')
      } catch {
        continue
      }
      const s = parseIni(text)
      const name = (s.identity && s.identity.name) || (s.meta && s.meta.name) || ws.title || file
      out.push({
        id: `${ws.id}:${file}`,
        name,
        workspaceId: ws.id,
        workspaceTitle: ws.title,
        workspacePath: ws.path,
        file: path,
        traits: (s.personality && s.personality.traits) || '',
        tone: (s.style && (s.style.tone || s.style['语气'])) || '',
        address: (s.behavior && s.behavior.address) || '',
      })
    }
  }
  return out
}

/** 把生成指令交给本工作区里最近的 Agent；失败时把指令回传界面。 */
async function dispatchToAgent(ctx, prompt) {
  const agents = typeof ctx.get === 'function' ? ctx.get('agents') : null
  if (!agents || typeof agents.list !== 'function') {
    return { queued: false, reason: 'agents 服务不可用', prompt }
  }
  const list = (agents.list() || []).filter((agent) => {
    try {
      const cwd = agent.session && agent.session.header ? agent.session.header.cwd : ''
      return cwd && String(cwd).toLowerCase() === ROOT.toLowerCase()
    } catch {
      return false
    }
  })
  if (!list.length) return { queued: false, reason: `没有在 ${ROOT} 下运行的 Agent 会话`, prompt }
  const score = (agent) => {
    let updated = 0
    try {
      updated = Number(agent.session.header.updatedAt || 0)
    } catch {
      updated = 0
    }
    const idle = agent.phase && agent.phase.kind === 'idle' ? 1 : 0
    return updated + idle
  }
  list.sort((a, b) => score(b) - score(a))
  const agent = list[0]
  const id = String(agent.id || '')
  const parts = [{ type: 'text', text: prompt }]
  let lastError = null
  for (const method of ['send', 'followup', 'inject']) {
    if (typeof agent[method] !== 'function') continue
    for (const arg of [parts, prompt, { text: prompt }]) {
      try {
        await agent[method](arg)
        return { queued: true, agent: id, via: `${method}/${Array.isArray(arg) ? 'parts' : typeof arg}` }
      } catch (err) {
        lastError = err
      }
    }
  }
  return {
    queued: false,
    reason: lastError ? String(lastError.message || lastError) : '这个 Agent 不支持 send/followup',
    prompt,
  }
}

function createRoutes(ctx) {
  const state = route('GET', async () => {
    await historyReadyPromise()
    return {
      songs: await listSongs(),
      projects: await listProjects(),
      jobs: listJobs(),
      root: ROOT,
      sourceDir: SOURCE,
      projectsRoot: PROJECTS,
      projectsDir: COVER_PROJECTS,
      genDir: GEN_PROJECTS,
      historyFile: historyFile(),
    }
  })

  const run = route('POST', async (body) => {
    const kind = String(body.kind || '')
    if (!['separate', 'pitch', 'voice', 'mix'].includes(kind)) throw new Error('kind 必须是 separate / pitch / voice / mix')
    return { job: startJob(kind, body.params || {}) }
  })

  const job = route('GET', async (_body, req) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const id = url.searchParams.get('id') || ''
    await historyReadyPromise()
    return { job: getJob(id) }
  })

  const cancel = route('POST', async (body) => {
    await historyReadyPromise()
    return { job: cancelJob(String(body.id || '')) }
  })

  const ref = route('POST', async (body) => makeRef(String(body.vocals || ''), {
    duration: body.duration,
    project: body.project,
  }))

  const open = route('POST', async (body) => revealInExplorer(String(body.path || '')))

  const projectCreate = route('POST', async (body) => createProject(String(body.name || ''), body.source || null))
  const projectRename = route('POST', async (body) => renameProject(String(body.id || ''), String(body.name || '')))
  const projectDelete = route('POST', async (body) =>
    deleteProject(String(body.id || ''), { trash: body.trash !== false }))

  const genState = route('GET', async () => ({
    projects: await listGenProjects(),
    rendering: genRenderingIds(),
    toolchain: genToolchain(),
    projectsDir: GEN_PROJECTS,
    projectsRoot: PROJECTS,
  }))

  const genRender = route('POST', async (body) => ({ rendered: await renderGenSong(String(body.id || '')) }))
  const genBuild = route('POST', async (body) => ({ built: await buildGenSong(String(body.id || '')) }))
  const genTidy = route('POST', async (body) => ({ tidied: await tidyGenProject(String(body.id || '')) }))

  const media = async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    await streamMedia(req, res, url.searchParams.get('path') || '')
  }

  // ---- 生成任务：读工作区人格、建任务、交给 Agent ----
  const personas = route('GET', async () => {
    const list = await readWorkspacePersonas(ctx)
    return { personas: list }
  })

  const genTask = route('POST', async (body) => {
    const title = String(body.title || '').trim()
    const theme = String(body.theme || '').trim()
    if (!title) throw new Error('歌名不能为空')
    const list = await readWorkspacePersonas(ctx)
    const persona = list.find((item) => item.id === body.persona) || null
    const task = await createGenTask({ title, theme, persona })
    return { task }
  })

  const genDispatch = route('POST', async (body) => {
    const prompt = String(body.prompt || '')
    if (!prompt) throw new Error('没有可执行的指令')
    return dispatchToAgent(ctx, prompt)
  })

  return [
    { path: `${ROUTE}/state`, handler: state },
    { path: `${ROUTE}/run`, handler: run },
    { path: `${ROUTE}/job`, handler: job },
    { path: `${ROUTE}/cancel`, handler: cancel },
    { path: `${ROUTE}/ref`, handler: ref },
    { path: `${ROUTE}/open`, handler: open },
    { path: `${ROUTE}/project/create`, handler: projectCreate },
    { path: `${ROUTE}/project/rename`, handler: projectRename },
    { path: `${ROUTE}/project/delete`, handler: projectDelete },
    { path: `${ROUTE}/gen/state`, handler: genState },
    { path: `${ROUTE}/gen/render`, handler: genRender },
    { path: `${ROUTE}/gen/build`, handler: genBuild },
    { path: `${ROUTE}/gen/tidy`, handler: genTidy },
    { path: `${ROUTE}/gen/personas`, handler: personas },
    { path: `${ROUTE}/gen/task`, handler: genTask },
    { path: `${ROUTE}/gen/dispatch`, handler: genDispatch },
    { path: `${ROUTE}/media`, handler: media },
  ]
}

function textResult(text) {
  return [{ type: 'text', text }]
}

function registerTools(tools) {
  return tools.register({
    name: 'cover_workbench',
    description:
      '音乐工作台，两个子项：①翻唱——分离人声/伴奏、分析音高与调性、零样本换音色、合成成品；②生成——扫描 song-sheet 与 MIDI，用本机 FluidSynth 钢琴音源离线渲染试听。所有步骤都在 D:\\singer 工作区里执行，长任务（换音色约 10 分钟）不会阻塞调用，用 action=job 查询进度。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'scan', 'separate', 'pitch', 'voice', 'mix', 'job', 'cancel', 'gen', 'gen_render', 'gen_build', 'gen_tidy'],
          description: 'status 看最近任务；scan 列源文件与产物；gen 看生成项目；gen_render/gen_build/gen_tidy 是生成子项操作；其余是启动/查询具体步骤',
        },
        input: { type: 'string', description: 'separate 用：源音频路径（mp3/wav）' },
        vocals: { type: 'string', description: 'pitch/voice/mix 用：人声 wav 路径' },
        instrumental: { type: 'string', description: 'pitch/mix 用：伴奏路径' },
        ref: { type: 'string', description: 'voice 用：参考音色音频（10-30 秒）' },
        semitones: { type: 'string', description: 'pitch 用：变调半音数或 auto；voice 用：半音偏移' },
        steps: { type: 'number', description: 'voice 用：扩散步数，默认 30' },
        tune: { type: 'boolean', description: 'voice 用：换音色前先修音准（WORLD）' },
        tuneStrength: { type: 'number', description: 'voice 用：修音准强度 0-1，默认 0.6' },
        tuneMode: { type: 'string', enum: ['scale', 'semitone'], description: 'voice 用：吸到调内音或十二平均律' },
        tuneKey: { type: 'string', description: 'voice 用：调性，如 "G# major"' },
        online: { type: 'boolean', description: 'voice 用：true 允许联网（首次下载模型时），默认离线' },
        out: { type: 'string', description: '输出目录或文件路径，可省略' },
        id: { type: 'string', description: 'job/cancel 用：任务 id' },
        project: { type: 'string', description: 'gen_render/gen_build 用：projects 下的生成项目目录名' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => textResult(value && value.text ? value.text : JSON.stringify(value)),
    },
    async execute(args) {
      const action = String((args && args.action) || 'status')
      if (action === 'status') {
        await historyReadyPromise()
        const jobs = listJobs()
        const text =
          jobs.length === 0
            ? '还没有任务。用 action=separate 传 input 开始第一步。'
            : jobs
                .map((j) => `${j.id} [${j.status}] ${j.title}${j.outDir ? ` -> ${j.outDir}` : ''}`)
                .join('\n')
        return { text, jobs }
      }
      if (action === 'scan') {
        const songs = await listSongs()
        const projects = await listProjects()
        const text = [
          `源文件 ${songs.length} 个：`,
          ...songs.map((s) => `  ${s.name} (${s.sizeMb} MB) ${s.file}`),
          `项目 ${projects.length} 个：`,
          ...projects.map(
            (p) =>
              `  ${p.id}: audio ${p.files.audio.length} / analysis ${p.files.analysis.length} / work ${p.files.work.length}`,
          ),
        ].join('\n')
        return { text, songs, projects }
      }
      if (action === 'job') {
        await historyReadyPromise()
        const job = getJob(String((args && args.id) || ''))
        return { text: jobSummaryText(job), job }
      }
      if (action === 'cancel') {
        await historyReadyPromise()
        const job = cancelJob(String((args && args.id) || ''))
        return { text: jobSummaryText(job), job }
      }
      if (action === 'gen') {
        const projects = await listGenProjects()
        const text = projects.length
          ? projects
              .map(
                (p) =>
                  `${p.id} · ${p.title} · 总稿${p.sheet ? '✓' : '—'} · MIDI ${p.midi ? p.midi.name : '—'} · 试听${p.audio ? '✓' : '—'}`,
              )
              .join('\n')
          : '还没有生成项目。'
        return { text, projects, toolchain: genToolchain(), projectsDir: PROJECTS }
      }
      if (action === 'gen_render') {
        const id = String((args && (args.project || args.id)) || '')
        if (!id) throw new Error('gen_render 需要 project')
        const rendered = await renderGenSong(id)
        return { text: `已渲染 ${rendered.id} → ${rendered.mp3}（${rendered.sizeMb} MB）`, rendered }
      }
      if (action === 'gen_build') {
        const id = String((args && (args.project || args.id)) || '')
        if (!id) throw new Error('gen_build 需要 project')
        const built = await buildGenSong(id)
        return { text: `已重跑 ${built.script}\n${built.output}`, built }
      }
      if (action === 'gen_tidy') {
        const id = String((args && (args.project || args.id)) || '')
        if (!id) throw new Error('gen_tidy 需要 project')
        const tidied = await tidyGenProject(id)
        const moved = tidied.moved.map((m) => `${m.from} → ${m.to}`).join('\n')
        return { text: `已整理 ${tidied.id}：\n${moved || '（没有需要移动的文件）'}`, tidied }
      }
      const kind = action
      if (kind === 'separate' && !args.input) throw new Error('separate 需要 input')
      if (kind === 'pitch' && !args.vocals) throw new Error('pitch 需要 vocals')
      if (kind === 'voice' && (!args.vocals || !args.ref)) throw new Error('voice 需要 vocals 和 ref')
      if (kind === 'mix' && (!args.vocals || !args.instrumental)) throw new Error('mix 需要 vocals 和 instrumental')
      const job = startJob(kind, {
        input: args.input,
        vocals: args.vocals,
        instrumental: args.instrumental,
        ref: args.ref,
        semitones: args.semitones,
        steps: args.steps,
        online: args.online,
        tune: args.tune,
        tuneStrength: args.tuneStrength,
        tuneMode: args.tuneMode,
        tuneKey: args.tuneKey,
        out: args.out,
      })
      return {
        text: `已启动 ${job.id}（${job.title}），状态 ${job.status}。用 action=job 且 id=${job.id} 查询进度。`,
        job,
      }
    },
  })
}

export function apply(ctx) {
  const register = (scope) => {
    const disposers = []
    if (scope.webServer) {
      for (const entry of createRoutes(ctx)) {
        disposers.push(scope.webServer.register({ kind: 'exact', path: entry.path, handler: entry.handler }))
      }
    }
    if (scope.tools) disposers.push(registerTools(scope.tools))
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* 已随服务器一起销毁 */
        }
      }
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => scope.effect(() => register({ webServer: scope.webServer })))
    ctx.inject(['tools'], (scope) => scope.effect(() => register({ tools: scope.tools })))
  } else {
    ctx.effect(() =>
      register({
        webServer: ctx.get('webServer'),
        tools: ctx.get('tools'),
      }),
    )
  }
}
