/**
 * 翻唱工作台 · Host 半。
 * 路由给界面用，工具给 Agent 用，两者都走 pipeline.js 里的同一套任务函数。
 */
import {
  cancelJob,
  createProject,
  deleteProject,
  getJob,
  historyFile,
  historyReadyPromise,
  jobSummaryText,
  listJobs,
  listProjects,
  listSongs,
  makeRef,
  renameProject,
  revealInExplorer,
  startJob,
  streamMedia,
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

function createRoutes() {
  const state = route('GET', async () => {
    await historyReadyPromise()
    return {
      songs: await listSongs(),
      projects: await listProjects(),
      jobs: listJobs(),
      root: ROOT,
      sourceDir: SOURCE,
      projectsDir: PROJECTS,
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

  const media = async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    await streamMedia(req, res, url.searchParams.get('path') || '')
  }

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
      '翻唱工作台：分离人声/伴奏、分析音高与调性、零样本换音色、合成成品。所有步骤都在 D:\\singer 工作区里执行，长任务（换音色约 10 分钟）不会阻塞调用，用 action=job 查询进度。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'scan', 'separate', 'pitch', 'voice', 'mix', 'job', 'cancel'],
          description: 'status 看最近任务；scan 列源文件与产物；其余是启动/查询具体步骤',
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
      for (const entry of createRoutes()) {
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
