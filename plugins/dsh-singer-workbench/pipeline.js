/**
 * 翻唱工作台的业务核心：把 D:\singer 下已有的四步脚本包装成可查询的任务。
 * Host 的 HTTP 路由和 Agent 工具都只调用这里，两条路径共用同一套逻辑。
 */
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'

export const ROOT = 'D:\\singer'
export const WORK = join(ROOT, 'work')
export const SOURCE = join(ROOT, 'source')
export const PROJECTS = join(ROOT, 'projects')
export const COVER_PROJECTS = join(PROJECTS, 'cover')
export const GEN_PROJECTS = join(PROJECTS, 'gen')

const PY = join(WORK, 'venv', 'Scripts', 'python.exe')
const PYVC = join(WORK, 'venv_vc', 'Scripts', 'python.exe')
const STATE_DIR = join(ROOT, 'state')
const HISTORY_FILE = join(STATE_DIR, 'history.json')

const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.opus', '.aac'])
const MAX_LOG_LINES = 400
const HISTORY_LIMIT = 200
const HISTORY_LOG_LINES = 40

const jobs = new Map()
let jobSeq = 0

/** 落盘的完成记录，按开始时间倒序；进程内运行时与 jobs 合并展示。 */
const history = []
let historyLoaded = null
let saveTimer = null
let saveChain = Promise.resolve()

function persistable(job) {
  return {
    id: job.id,
    kind: job.kind,
    title: job.title,
    status: job.status,
    project: job.project || null,
    outDir: job.outDir,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    exitCode: job.exitCode,
    error: job.error,
    command: job.command,
    params: job.params,
    log: (job.log || []).slice(-HISTORY_LOG_LINES),
    persisted: true,
  }
}

function upsertHistory(job) {
  const record = persistable(job)
  const index = history.findIndex((item) => item.id === record.id)
  if (index >= 0) history[index] = record
  else history.unshift(record)
  history.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
  scheduleSave()
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushHistory().catch(() => {})
  }, 400)
  if (typeof saveTimer.unref === 'function') saveTimer.unref()
}

/** 串行写盘：先写临时文件再 rename，进程被强杀也不会留下半个 JSON。 */
export function flushHistory() {
  const payload = JSON.stringify(
    { version: 1, savedAt: nowIso(), jobs: history.map((item) => ({ ...item, persisted: undefined })) },
    null,
    2,
  )
  saveChain = saveChain
    .then(async () => {
      await mkdir(dirname(HISTORY_FILE), { recursive: true })
      const temp = `${HISTORY_FILE}.tmp`
      await writeFile(temp, payload, 'utf8')
      await rename(temp, HISTORY_FILE)
    })
    .catch(() => {})
  return saveChain
}

function loadHistory() {
  historyLoaded = (async () => {
    try {
      const raw = await readFile(HISTORY_FILE, 'utf8')
      const parsed = JSON.parse(raw)
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.jobs) ? parsed.jobs : []
      for (const item of items) {
        if (!item || typeof item.id !== 'string') continue
        history.push({
          ...item,
          // 重启时还写着 running 的任务，进程已经没了
          status: item.status === 'running' ? 'interrupted' : item.status,
          persisted: true,
        })
      }
      history.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
      // 重启后 id 不能从头开始，否则会和历史记录撞号
      for (const item of history) {
        const match = /^job-(\d+)$/.exec(item.id)
        if (match) jobSeq = Math.max(jobSeq, Number(match[1]))
      }
    } catch {
      /* 第一次运行时还没有历史文件 */
    }
  })()
  return historyLoaded
}

const historyReady = loadHistory()

export function historyReadyPromise() {
  return historyReady
}

export function historyFile() {
  return HISTORY_FILE
}

/** 跑一次短命令（makeref 这种 1-2 秒的），收集输出用于报错。 */
export function runOnce(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, windowsHide: true })
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      buffer += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(buffer)
      else reject(new Error((buffer || `退出码 ${code}`).trim().slice(-500)))
    })
  })
}

/** 从项目人声里自动挑最响的一段，存成 <项目>\work\ref.wav。 */export async function makeRef(vocals, options = {}) {
  const src = safePath(vocals)
  const pid = projectIdFor(src, options.project)
  const paths = projectPaths(pid)
  const duration = Math.min(30, Math.max(10, Number(options.duration) || 20))
  await mkdir(paths.work, { recursive: true })
  const out = join(paths.work, 'ref.wav')
  const output = await runOnce(
    PY,
    [join(WORK, 'makeref.py'), src, '--auto', '-d', String(duration), '-o', out],
    baseEnv(),
  )
  return { path: out, project: pid, duration, output: output.trim() }
}

/** 在资源管理器里打开目录；给的是文件就打开它所在的文件夹。 *  不用 explorer 的 /select：这台机器上非纯 ASCII 路径会被忽略，反而跳到「文档」。 */
export function revealInExplorer(target) {
  const full = safePath(target)
  let info
  try {
    info = statSync(full)
  } catch {
    throw new Error(`路径不存在: ${full}`)
  }
  const folder = info.isDirectory() ? full : dirname(full)
  const child = spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', () => {})
  child.unref()
  return { opened: folder, target: full, isDirectory: info.isDirectory() }
}

function nowIso() {
  return new Date().toISOString()
}

/** 只允许访问工作区里的路径，防止用 ?path=.. 读到别处。 */
export function safePath(input) {
  if (typeof input !== 'string' || input.trim() === '') throw new Error('路径为空')
  const full = resolve(input)
  const root = resolve(ROOT)
  if (full !== root && !full.startsWith(root + sep)) throw new Error('只允许访问 D:\\singer 工作区内的文件')
  return full
}

function songName(input) {
  return basename(input, extname(input))
}

function ext(file) {
  return extname(file).toLowerCase()
}

export async function listSongs() {
  let entries = []
  try {
    entries = await readdir(SOURCE, { withFileTypes: true })
  } catch {
    return []
  }
  const songs = []
  for (const entry of entries) {
    if (!entry.isFile() || !AUDIO_EXT.has(ext(entry.name))) continue
    const full = join(SOURCE, entry.name)
    const info = await stat(full).catch(() => null)
    if (!info) continue
    songs.push({
      name: basename(entry.name, extname(entry.name)),
      file: full,
      sizeMb: Math.round((info.size / 1024 / 1024) * 10) / 10,
      mtime: info.mtime.toISOString(),
    })
  }
  songs.sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
  return songs
}

/** 项目 id 规则与 work/projectlib.py 保持一致：projects/cover/<id>/ 里的用 id，否则用父目录名，最后才用文件名。 */
export function projectIdFor(input, explicit) {
  if (explicit) return sanitize(explicit)
  const full = resolve(input)
  const root = resolve(COVER_PROJECTS)
  if (full.startsWith(root + sep)) {
    const rel = full.slice(root.length + sep.length)
    const first = rel.split(sep)[0]
    if (first && first !== '.' && first !== '..') return sanitize(first)
  }
  const parent = basename(dirname(full))
  const skip = new Set(['out', 'source', 'audio', 'work', 'analysis', 'tmp', 'baselines', 'cover', 'gen'])
  if (parent && !skip.has(parent.toLowerCase())) return sanitize(parent)
  return sanitize(songName(full))
}

export function projectPaths(id) {
  const base = join(COVER_PROJECTS, sanitize(id))
  return {
    base,
    audio: join(base, 'audio'),
    analysis: join(base, 'analysis'),
    work: join(base, 'work'),
    baselines: join(base, 'baselines'),
    meta: join(base, 'project.json'),
  }
}

export function sanitize(name) {
  const text = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '')
  return (text || 'project').slice(0, 60)
}

/** 列出所有翻唱项目及其产物，界面按项目组织。 */
export async function listProjects() {
  let entries = []
  try {
    entries = await readdir(COVER_PROJECTS, { withFileTypes: true })
  } catch {
    return []
  }
  const projects = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const base = join(COVER_PROJECTS, entry.name)
    let meta = {}
    try {
      meta = JSON.parse(await readFile(join(base, 'project.json'), 'utf8'))
    } catch {
      /* 没有元数据也能列出来 */
    }
    const files = { audio: [], analysis: [], work: [], baselines: [] }
    for (const key of Object.keys(files)) {
      let list = []
      try {
        list = await readdir(join(base, key), { withFileTypes: true })
      } catch {
        continue
      }
      for (const file of list) {
        if (!file.isFile()) continue
        if (!/\.(wav|mp3|png|json|csv)$/i.test(file.name)) continue
        const info = await stat(join(base, key, file.name)).catch(() => null)
        files[key].push({
          name: file.name,
          path: join(base, key, file.name),
          sizeMb: info ? Math.round((info.size / 1024 / 1024) * 10) / 10 : 0,
          mtime: info ? info.mtime.toISOString() : null,
        })
      }
    }
    if (!files.audio.length && !files.analysis.length && !files.work.length && !meta.createdAt) continue
    projects.push({
      id: entry.name,
      dir: base,
      title: meta.title || entry.name,
      source: meta.source || null,
      createdAt: meta.createdAt || null,
      updatedAt: meta.updatedAt || null,
      steps: meta.steps || {},
      files,
    })
  }
  return projects.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
}

function baseEnv() {
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  env.PATH = [join(WORK, 'bin'), env.PATH || ''].filter(Boolean).join(';')
  env.TORCH_HOME = join(WORK, 'models', 'torch')
  if (!env.HTTP_PROXY && env.HTTPS_PROXY) env.HTTP_PROXY = env.HTTPS_PROXY
  return env
}

function assertNoRunningJob(dir) {
  const target = resolve(dir)
  for (const job of jobs.values()) {
    if (job.status !== 'running') continue
    const out = job.outDir ? resolve(job.outDir) : ''
    if (out && (out === target || out.startsWith(target + sep))) {
      throw new Error(`项目里有任务在跑（${job.id}），等它结束再操作`)
    }
  }
}

async function writeMeta(metaPath, meta) {
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8')
}

/** 新建一个空项目（不跑分离，只建目录和 project.json）。 */
export async function createProject(name, source) {
  const pid = sanitize(name)
  if (!pid) throw new Error('项目名为空')
  const p = projectPaths(pid)
  if (existsSync(p.base)) throw new Error(`项目已存在: ${pid}`)
  for (const key of ['audio', 'analysis', 'work', 'baselines']) await mkdir(p[key], { recursive: true })
  const now = new Date().toISOString().slice(0, 19)
  await writeMeta(p.meta, {
    id: pid,
    title: pid,
    source: source ? safePath(source) : null,
    createdAt: now,
    updatedAt: now,
    steps: {},
  })
  return { id: pid, dir: p.base }
}

/** 重命名项目目录并同步 project.json。 */
export async function renameProject(id, newName) {
  const from = projectPaths(id)
  if (!existsSync(from.base)) throw new Error(`项目不存在: ${id}`)
  const pid = sanitize(newName)
  if (!pid) throw new Error('新名称为空')
  if (pid === sanitize(id)) return { id: pid, dir: from.base, unchanged: true }
  const to = projectPaths(pid)
  if (existsSync(to.base)) throw new Error(`目标项目已存在: ${pid}`)
  assertNoRunningJob(from.base)
  await rename(from.base, to.base)
  let meta = {}
  try {
    meta = JSON.parse(await readFile(to.meta, 'utf8'))
  } catch {
    meta = {}
  }
  meta.id = pid
  if (!meta.title || meta.title === sanitize(id)) meta.title = pid
  meta.updatedAt = new Date().toISOString().slice(0, 19)
  await writeMeta(to.meta, meta)
  return { id: pid, dir: to.base }
}

/** 删除项目：默认挪到 archive\trash 留底，trash=false 才真删。 */
export async function deleteProject(id, options = {}) {
  const p = projectPaths(id)
  if (!existsSync(p.base)) throw new Error(`项目不存在: ${id}`)
  assertNoRunningJob(p.base)
  if (options.trash === false) {
    await rm(p.base, { recursive: true, force: true })
    return { removed: p.base }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = join(ROOT, 'archive', 'trash', `${stamp}-${sanitize(id)}`)
  await mkdir(dirname(dest), { recursive: true })
  await rename(p.base, dest)
  return { movedTo: dest }
}

// ---------------------------------------------------------------------------
// 生成模块（翻唱工作台的第二个子项）：扫描 song-sheet + MIDI，调用本机
// FluidSynth 与音源渲染钢琴试听。全部离线，产物写回项目 midi\ 目录。
// ---------------------------------------------------------------------------

const FLUIDSYNTH = join(WORK, 'tools', 'fluidsynth', 'fluidsynth-v2.6.1-win10-x64-cpp11', 'bin', 'fluidsynth.exe')
const SOUNDFONT = join(WORK, 'soundfonts', 'GeneralUser-GS.sf2')
const FFMPEG = join(WORK, 'bin', 'ffmpeg.exe')
const GEN_AUDIO_NAMES = ['preview_piano.mp3', 'preview_synth.mp3', 'preview.mp3']

const rendering = new Set()

export function genToolchain() {
  return {
    fluidsynth: { path: FLUIDSYNTH, ok: existsSync(FLUIDSYNTH) },
    soundfont: { path: SOUNDFONT, ok: existsSync(SOUNDFONT) },
    ffmpeg: { path: FFMPEG, ok: existsSync(FFMPEG) },
  }
}

export function genPaths(id) {
  const base = join(GEN_PROJECTS, sanitize(id))
  return {
    base,
    midi: join(base, 'midi'),
    renders: join(base, 'renders'),
    tools: join(base, 'tools'),
    sheet: join(base, 'song-sheet.md'),
    manifest: join(base, 'products.json'),
  }
}

const GEN_KIND_LABEL = { sheet: '总稿', midi: 'MIDI', audio: '钢琴试听', wav: '无损 WAV' }

async function fileInfo(path, base) {
  const info = await stat(path).catch(() => null)
  if (!info || !info.isFile()) return null
  const rel = path.startsWith(base) ? path.slice(base.length + 1).replace(/\\/g, '/') : basename(path)
  return {
    path,
    rel,
    name: basename(path),
    sizeMb: Math.round((info.size / 1024 / 1024) * 10) / 10,
    sizeKb: Math.round((info.size / 1024) * 10) / 10,
    mtime: info.mtime.toISOString(),
  }
}

/** 收集一个生成项目的所有产物：总稿 / MIDI / 试听 / 无损 WAV。 */
export async function collectGenProducts(id) {
  const p = genPaths(id)
  const pid = sanitize(id)
  const products = []

  const sheet = await fileInfo(p.sheet, p.base)
  if (sheet) products.push({ kind: 'sheet', label: GEN_KIND_LABEL.sheet, ...sheet })

  let mids = []
  try {
    const list = await readdir(p.midi, { withFileTypes: true })
    mids = list.filter((f) => f.isFile() && /\.mid$/i.test(f.name)).map((f) => join(p.midi, f.name))
  } catch {
    mids = []
  }
  mids.sort((a, b) => {
    const sa = basename(a) === `${pid}.mid` ? 0 : 1
    const sb = basename(b) === `${pid}.mid` ? 0 : 1
    return sa - sb || a.localeCompare(b)
  })
  for (const m of mids) {
    const info = await fileInfo(m, p.base)
    if (info) products.push({ kind: 'midi', label: GEN_KIND_LABEL.midi, ...info })
  }

  const canonicalAudio = join(p.renders, `${pid}_piano.mp3`)
  const canonicalWav = join(p.renders, `${pid}_piano.wav`)
  const candidates = [
    [canonicalAudio, 'audio'],
    [canonicalWav, 'wav'],
  ]
  // 只有规范文件不存在时，才把老的 preview_* 当作产物展示，避免同一条出现两遍
  if (!existsSync(canonicalAudio)) candidates.push([join(p.midi, 'preview_piano.mp3'), 'audio'])
  if (!existsSync(canonicalWav)) candidates.push([join(p.midi, 'preview_piano.wav'), 'wav'])
  if (!existsSync(canonicalAudio)) {
    candidates.push([join(p.midi, 'preview_synth.mp3'), 'audio'])
    candidates.push([join(p.midi, 'preview.mp3'), 'audio'])
  }
  for (const [file, kind] of candidates) {
    const info = await fileInfo(file, p.base)
    if (info) products.push({ kind, label: GEN_KIND_LABEL[kind], ...info })
  }
  return products
}

async function writeGenManifest(id, products) {
  const p = genPaths(id)
  const body = {
    version: 1,
    updatedAt: new Date().toISOString(),
    products: products.map((item) => ({
      kind: item.kind,
      label: item.label,
      path: item.rel,
      sizeMb: item.sizeMb,
      mtime: item.mtime,
    })),
  }
  await writeFile(p.manifest, JSON.stringify(body, null, 2), 'utf8')
  return body
}

/** 把老布局（脚本和 preview_* 全堆在 midi\）整理成 tools\ + renders\。 */
export async function tidyGenProject(id) {
  const p = genPaths(id)
  if (!existsSync(p.base)) throw new Error(`项目不存在: ${id}`)
  await mkdir(p.renders, { recursive: true })
  await mkdir(p.tools, { recursive: true })
  const pid = sanitize(id)
  const moved = []

  for (const name of ['build_midi.py', 'preview.py']) {
    const from = join(p.midi, name)
    if (!existsSync(from)) continue
    await rename(from, join(p.tools, name))
    moved.push({ from: `midi/${name}`, to: `tools/${name}` })
  }

  const promote = {
    'preview_piano.wav': `${pid}_piano.wav`,
    'preview_piano.mp3': `${pid}_piano.mp3`,
  }
  const legacy = join(p.renders, '_legacy')
  const skipped = []
  for (const name of ['preview_piano_norm.wav', 'preview_piano.wav', 'preview_piano.mp3', 'preview_synth.mp3', 'preview.mp3']) {
    const from = join(p.midi, name)
    if (!existsSync(from)) continue
    const canon = promote[name] ? join(p.renders, promote[name]) : null
    if (canon && !existsSync(canon)) {
      try {
        await rename(from, canon)
        moved.push({ from: `midi/${name}`, to: `renders/${promote[name]}` })
      } catch (err) {
        if (!['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err
        await copyFile(from, canon)
        moved.push({ from: `midi/${name}`, to: `renders/${promote[name]}`, copied: true })
        skipped.push({ from: `midi/${name}`, reason: '文件被占用（可能正在播放），已复制成新名字，原文件稍后可再整理' })
      }
    } else {
      await mkdir(legacy, { recursive: true })
      try {
        await rename(from, join(legacy, name))
        moved.push({ from: `midi/${name}`, to: `renders/_legacy/${name}` })
      } catch (err) {
        if (!['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err
        skipped.push({ from: `midi/${name}`, reason: '文件被占用，等播放结束再整理' })
      }
    }
  }

  const products = await collectGenProducts(id)
  await writeGenManifest(id, products)
  return { id: pid, moved, skipped, products }
}

function genRenderingIds() {
  return [...rendering].map((base) => basename(base))
}

/** 扫描 projects\gen 下同时有 song-sheet.md 或 midi/*.mid 的项目。 */
export async function listGenProjects() {
  let entries = []
  try {
    entries = await readdir(GEN_PROJECTS, { withFileTypes: true })
  } catch {
    return []
  }
  const projects = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const p = genPaths(entry.name)
    const products = await collectGenProducts(entry.name)
    if (!products.length) continue

    const sheet = products.find((x) => x.kind === 'sheet') || null
    const midiList = products.filter((x) => x.kind === 'midi')
    const audio = products.find((x) => x.kind === 'audio') || null
    const wav = products.find((x) => x.kind === 'wav') || null

    let title = entry.name
    if (sheet) {
      try {
        const text = await readFile(p.sheet, 'utf8')
        const head = text.match(/^#\s+(.+)$/m)
        if (head) title = head[1].trim()
      } catch {
        /* 读不到标题就用目录名 */
      }
    }

    // midi 目录里除了产物还剩多少杂物（脚本、旧预览）
    let extras = 0
    try {
      const list = await readdir(p.midi, { withFileTypes: true })
      extras = list.filter((f) => f.isFile() && !/\.mid$/i.test(f.name)).length
    } catch {
      extras = 0
    }

    const stamps = products.map((x) => new Date(x.mtime).getTime()).filter(Number.isFinite)
    const updatedAt = stamps.length ? new Date(Math.max(...stamps)).toISOString() : null

    projects.push({
      id: entry.name,
      title,
      dir: p.base,
      sheet: sheet ? { path: sheet.path, name: sheet.name, sizeKb: sheet.sizeKb, mtime: sheet.mtime } : null,
      midi: midiList.length
        ? { name: midiList[0].name, path: midiList[0].path, sizeKb: midiList[0].sizeKb, mtime: midiList[0].mtime }
        : null,
      midiCount: midiList.length,
      audio: audio ? { name: audio.name, path: audio.path, sizeMb: audio.sizeMb, mtime: audio.mtime } : null,
      wav,
      products,
      extras,
      rendering: rendering.has(p.base),
      updatedAt,
    })
  }
  return projects.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
}

/** 用本机 FluidSynth + 钢琴音源渲染，再归一化响度并转 mp3。 */
export async function renderGenSong(id) {
  const p = genPaths(id)
  if (!existsSync(p.base)) throw new Error(`项目不存在: ${id}`)
  if (rendering.has(p.base)) throw new Error('这个项目正在渲染，稍等')
  if (!existsSync(FLUIDSYNTH)) throw new Error('找不到 FluidSynth，请确认 work\\tools\\fluidsynth 已解压')
  if (!existsSync(SOUNDFONT)) throw new Error('找不到钢琴音源 work\\soundfonts\\GeneralUser-GS.sf2')
  if (!existsSync(FFMPEG)) throw new Error('找不到 ffmpeg: work\\bin\\ffmpeg.exe')

  let files = []
  try {
    files = await readdir(p.midi)
  } catch {
    throw new Error('这个项目还没有 midi 目录')
  }
  const preferred = `${sanitize(id)}.mid`
  const midiName = files.includes(preferred) ? preferred : files.find((name) => /\.mid$/i.test(name))
  if (!midiName) throw new Error('midi 目录里没有 .mid 文件')
  const midiPath = join(p.midi, midiName)

  rendering.add(p.base)
  try {
    await mkdir(p.renders, { recursive: true })
    const pid = sanitize(id)
    const raw = join(p.renders, `_${pid}_raw.wav`)
    const wav = join(p.renders, `${pid}_piano.wav`)
    const mp3 = join(p.renders, `${pid}_piano.mp3`)
    const useFluid = existsSync(FLUIDSYNTH) && existsSync(SOUNDFONT)
    if (useFluid) {
      await runOnce(
        FLUIDSYNTH,
        [
          '-ni', '-F', raw, '-r', '44100', '-g', '0.7',
          '-o', 'synth.reverb.active=1',
          '-o', 'synth.reverb.room-size=0.7',
          '-o', 'synth.reverb.damp=0.4',
          '-o', 'synth.chorus.active=0',
          SOUNDFONT, midiPath,
        ],
        baseEnv(),
      )
    } else {
      // 没有 FluidSynth / 音源时用通用正弦渲染器兜底
      await runOnce(PY, [join(WORK, 'gen_preview.py'), midiPath, '-o', raw], baseEnv())
    }
    await runOnce(
      FFMPEG,
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', wav],
      baseEnv(),
    )
    await runOnce(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-b:a', '192k', mp3], baseEnv())
    await rm(raw, { force: true }).catch(() => {})

    // 渲染完顺手整理一次：把遗留的 preview_* 归档，别继续堆在 midi\
    const legacy = join(p.renders, '_legacy')
    for (const name of ['preview_piano.wav', 'preview_piano.mp3', 'preview_synth.mp3', 'preview.mp3']) {
      const from = join(p.midi, name)
      if (!existsSync(from)) continue
      await mkdir(legacy, { recursive: true })
      await rename(from, join(legacy, name)).catch(() => {})
    }
    const products = await collectGenProducts(id)
    await writeGenManifest(id, products)

    const info = await stat(mp3).catch(() => null)
    return {
      id: pid,
      midi: midiPath,
      wav,
      mp3,
      sizeMb: info ? Math.round((info.size / 1024 / 1024) * 10) / 10 : 0,
      products,
    }
  } finally {
    rendering.delete(p.base)
  }
}

/** 重新生成 MIDI：优先跑 tools\build_midi.py，兼容老的 midi\build_midi.py。 */
export async function buildGenSong(id) {
  const p = genPaths(id)
  const script = [join(p.tools, 'build_midi.py'), join(p.midi, 'build_midi.py')].find((file) => existsSync(file))
  if (!script) throw new Error('这个项目没有 build_midi.py（tools\\ 或 midi\\ 下都找不到），跳过')
  const output = await runOnce(PY, [script], baseEnv())
  const products = await collectGenProducts(id)
  await writeGenManifest(id, products)
  return { id: sanitize(id), script, output: output.trim(), products }
}

export { genRenderingIds }

function voiceEnv(online) {
  const env = baseEnv()
  env.HF_HUB_CACHE = join(WORK, 'seedvc', 'checkpoints', 'hf_cache')
  env.HF_ENDPOINT = env.HF_ENDPOINT || 'https://hf-mirror.com'
  if (!online) {
    // 权重已经在本地缓存；默认离线，免得 huggingface_hub 每次先探一次 hub
    env.HF_HUB_OFFLINE = '1'
    env.TRANSFORMERS_OFFLINE = '1'
  }
  return env
}

/** 每种任务对应的命令行；返回 null 表示参数不足。 */
function buildCommand(kind, params) {
  const p = params || {}
  if (kind === 'separate') {
    const input = safePath(p.input)
    const pid = projectIdFor(input, p.project)
    const outDir = p.out ? safePath(p.out) : projectPaths(pid).audio
    return {
      cmd: PY,
      args: [join(WORK, 'separate.py'), input, '-o', outDir, '--project', pid],
      cwd: WORK,
      env: baseEnv(),
      outDir,
      project: pid,
      title: `分离 ${basename(input)}`,
    }
  }
  if (kind === 'pitch') {
    const vocals = safePath(p.vocals)
    const pid = projectIdFor(vocals, p.project)
    const outDir = p.out ? safePath(p.out) : projectPaths(pid).analysis
    const args = [join(WORK, 'pitch.py'), vocals, '-o', outDir, '--project', pid]
    if (p.instrumental) args.push('-i', safePath(p.instrumental))
    args.push('-k', String(p.semitones ?? 'auto'))
    if (p.targetRange) args.push('--target-range', String(p.targetRange))
    return { cmd: PY, args, cwd: WORK, env: baseEnv(), outDir, project: pid, title: `音高分析 ${basename(vocals)}` }
  }
  if (kind === 'voice') {
    const vocals = safePath(p.vocals)
    const ref = safePath(p.ref)
    const pid = projectIdFor(vocals, p.project)
    const outDir = p.out ? safePath(p.out) : projectPaths(pid).work
    const steps = Math.max(10, Math.min(80, Number(p.steps) || 30))
    const args = [
      join(WORK, 'voice.py'),
      vocals,
      ref,
      '--project',
      pid,
      '--steps',
      String(steps),
    ]
    if (p.semitones) args.push('-p', String(Number(p.semitones) || 0))
    if (p.tune === true) {
      args.push('--tune', '--tune-strength', String(Number(p.tuneStrength) || 0.6))
      args.push('--tune-mode', p.tuneMode === 'semitone' ? 'semitone' : 'scale')
      if (p.tuneKey) args.push('--tune-key', String(p.tuneKey))
    }
    if (p.online === true) args.push('--online')
    return {
      cmd: PY,
      args,
      cwd: WORK,
      env: voiceEnv(p.online === true),
      outDir,
      project: pid,
      title: `换音色 ${basename(vocals)}`,
    }
  }
  if (kind === 'mix') {
    const vocals = safePath(p.vocals)
    const instrumental = safePath(p.instrumental)
    const pid = projectIdFor(instrumental, p.project)
    const out = p.out ? safePath(p.out) : join(projectPaths(pid).work, 'cover.wav')
    const args = [join(WORK, 'mix.py'), vocals, instrumental, '-o', out, '--project', pid]
    if (p.vocalDb) args.push('--vocal-db', String(Number(p.vocalDb) || 0))
    return { cmd: PY, args, cwd: WORK, env: baseEnv(), outDir: dirname(out), project: pid, title: `合成 ${basename(out)}` }
  }
  throw new Error(`未知任务类型: ${kind}`)
}

function pushLine(job, chunk) {
  const text = String(chunk)
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (!line) continue
    job.log.push(line)
    if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES)
  }
}

function snapshot(job) {
  return {
    id: job.id,
    kind: job.kind,
    title: job.title,
    status: job.status,
    project: job.project || null,
    outDir: job.outDir,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    exitCode: job.exitCode,
    error: job.error,
    log: job.log.slice(-120),
    command: job.command,
    params: job.params,
  }
}

export function startJob(kind, params) {
  const spec = buildCommand(kind, params)
  const id = `job-${++jobSeq}`
  const job = {
    id,
    kind,
    title: spec.title,
    status: 'running',
    project: spec.project || null,
    outDir: spec.outDir,
    startedAt: nowIso(),
    endedAt: null,
    exitCode: null,
    error: null,
    log: [],
    command: `${basename(spec.cmd)} ${spec.args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
    params: { ...(params || {}) },
    child: null,
  }
  jobs.set(id, job)
  upsertHistory(job)

  let child
  try {
    child = spawn(spec.cmd, spec.args, { cwd: spec.cwd, env: spec.env, windowsHide: true })
  } catch (error) {
    job.status = 'failed'
    job.error = error.message
    job.endedAt = nowIso()
    upsertHistory(job)
    return snapshot(job)
  }
  job.child = child
  child.stdout.on('data', (chunk) => pushLine(job, chunk))
  child.stderr.on('data', (chunk) => pushLine(job, chunk))
  child.on('error', (error) => {
    job.status = 'failed'
    job.error = error.message
    job.endedAt = nowIso()
    upsertHistory(job)
  })
  child.on('close', (code) => {
    job.exitCode = code
    job.endedAt = nowIso()
    if (job.status !== 'cancelled') job.status = code === 0 ? 'done' : 'failed'
    if (code !== 0 && !job.error) job.error = `进程退出码 ${code}`
    job.child = null
    upsertHistory(job)
  })
  return snapshot(job)
}

export function getJob(id) {
  const job = jobs.get(id)
  if (job) return snapshot(job)
  return history.find((item) => item.id === id) || null
}

export function listJobs() {
  const live = [...jobs.values()].map(snapshot)
  const liveIds = new Set(live.map((item) => item.id))
  const past = history.filter((item) => !liveIds.has(item.id)).map((item) => ({ ...item }))
  return [...live, ...past].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 20)
}

export function cancelJob(id) {
  const job = jobs.get(id)
  if (!job) return getJob(id)
  if (job.child && job.status === 'running') {
    job.status = 'cancelled'
    job.endedAt = nowIso()
    try {
      job.child.kill()
    } catch {
      /* 已经退出 */
    }
    upsertHistory(job)
  }
  return snapshot(job)
}

export function ensureStateDir() {
  return STATE_DIR
}

/** 给 /media 路由用的流式响应，支持 Range，浏览器拖动进度条才正常。 */
export async function streamMedia(req, res, rawPath) {
  const full = safePath(rawPath)
  const info = await stat(full).catch(() => null)
  if (!info || !info.isFile()) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const type = full.toLowerCase().endsWith('.png')
    ? 'image/png'
    : full.toLowerCase().endsWith('.json')
      ? 'application/json; charset=utf-8'
      : full.toLowerCase().endsWith('.mp3')
        ? 'audio/mpeg'
        : 'audio/wav'
  const range = req.headers.range
  res.setHeader('content-type', type)
  res.setHeader('accept-ranges', 'bytes')
  res.setHeader('cache-control', 'no-store')
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const [startText, endText] = range.replace('bytes=', '').split('-')
    const start = startText ? Number(startText) : 0
    const end = endText ? Math.min(Number(endText), info.size - 1) : info.size - 1
    if (start > end || start >= info.size) {
      res.statusCode = 416
      res.setHeader('content-range', `bytes */${info.size}`)
      res.end()
      return
    }
    res.statusCode = 206
    res.setHeader('content-range', `bytes ${start}-${end}/${info.size}`)
    res.setHeader('content-length', String(end - start + 1))
    createReadStream(full, { start, end }).pipe(res)
    return
  }
  res.statusCode = 200
  res.setHeader('content-length', String(info.size))
  createReadStream(full).pipe(res)
}

export function jobSummaryText(job) {
  if (!job) return '没有这个任务'
  const lines = [`任务 ${job.id} · ${job.title}`, `状态: ${job.status}`]
  if (job.error) lines.push(`错误: ${job.error}`)
  if (job.outDir) lines.push(`输出目录: ${job.outDir}`)
  if (job.status === 'done') lines.push('产物: ' + (job.outDir || ''))
  lines.push('--- 日志尾部 ---')
  lines.push(...job.log.slice(-12))
  return lines.join('\n')
}
