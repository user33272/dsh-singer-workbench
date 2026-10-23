window.__ModuleLoader__.load({
  id: '@local/dsh-singer-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const API = '/api/dsh-singer'

    const DICTS = {
      zh: {
        nav: '翻唱工作台',
        title: '翻唱工作台',
        subtitle: '一条龙：分离人声 → 分析音高与调性 → 零样本换音色 → 合成成品。每一步都能单独重跑。',
        songSection: '1. 选歌',
        songHint: '源文件放在 D:\\singer\\source\\，也可以直接在下面填路径。',
        refresh: '刷新',
        noSongs: 'source 目录里还没有音频文件。',
        selected: '当前：',
        stepSeparate: '分离人声',
        stepSeparateDesc: 'Mel-Band RoFormer，4 分钟的歌约 25 秒。',
        stepPitch: '音高分析',
        stepPitchDesc: 'CREPE 提音高曲线，估调性，算出该变几个半音。',
        stepVoice: '换音色',
        stepVoiceDesc: 'Seed-VC 零样本：给 10–30 秒参考人声，不用训练。',
        stepMix: '合成',
        stepMixDesc: '人声 + 伴奏，限峰并转 320k mp3。',
        run: '开始',
        running: '进行中…',
        vocalsPath: '人声',
        instrumentalPath: '伴奏',
        refPath: '参考人声',
        steps: '扩散步数',
        onlineHint: '允许联网（只有首次下载模型时要勾；平时留空即可离线跑）',
        semitones: '变调',
        auto: '自动',
        jobSection: '任务',
        noJob: '还没有任务。',
        cancel: '取消',
        results: '产物',
        noResults: '还没有产物。',
        play: '试听',
        openDir: '目录',
        log: '日志',
        error: '出错了：',
        needSong: '先选一首歌。',
        needVocals: '先选人声文件。',
        needRef: '先选参考人声。',
      },
      en: {
        nav: 'Cover Workbench',
        title: 'Cover Workbench',
        subtitle: 'Separate → analyze pitch → zero-shot voice conversion → mix. Every step can be re-run on its own.',
        songSection: '1. Pick a song',
        songHint: 'Put sources in D:\\singer\\source\\, or type a path below.',
        refresh: 'Refresh',
        noSongs: 'No audio in the source directory yet.',
        selected: 'Selected: ',
        stepSeparate: 'Separate',
        stepSeparateDesc: 'Mel-Band RoFormer, about 25 s for a 4-minute song.',
        stepPitch: 'Pitch analysis',
        stepPitchDesc: 'CREPE pitch curve, key estimate, suggested transpose.',
        stepVoice: 'Voice conversion',
        stepVoiceDesc: 'Seed-VC zero-shot: any 10–30 s reference, no training.',
        stepMix: 'Mix',
        stepMixDesc: 'Vocals + instrumental, limited and encoded to 320k mp3.',
        run: 'Run',
        running: 'Running…',
        vocalsPath: 'Vocals',
        instrumentalPath: 'Instrumental',
        refPath: 'Reference voice',
        steps: 'Diffusion steps',
        onlineHint: 'Allow network (only for the first model download; leave off to run offline)',
        semitones: 'Transpose',
        auto: 'Auto',
        jobSection: 'Jobs',
        noJob: 'No job yet.',
        cancel: 'Cancel',
        results: 'Outputs',
        noResults: 'No outputs yet.',
        play: 'Play',
        openDir: 'Folder',
        log: 'Log',
        error: 'Error: ',
        needSong: 'Pick a song first.',
        needVocals: 'Pick a vocals file first.',
        needRef: 'Pick a reference voice first.',
      },
    }

    let translate = null
    function t(key) {
      if (translate) {
        const value = translate(key)
        if (value && value !== key) return value
      }
      return (DICTS.zh && DICTS.zh[key]) || key
    }

    const CSS = `
.swb-root{display:flex;flex-direction:column;gap:16px;padding:8px 0 32px;max-width:1040px;margin:0 auto;width:100%;height:100%;overflow-y:auto;box-sizing:border-box;color:var(--dsw-alias-label-primary)}
.swb-head h1{margin:0;font-size:19px;font-weight:600}
.swb-head p{margin:6px 0 0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.swb-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.swb-card h2{margin:0;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.swb-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.swb-label{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:56px}
.swb-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer;line-height:1.4}
.swb-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.swb-btn.primary{background:var(--dsw-alias-brand-primary);color:#fff;border-color:transparent}
.swb-btn:disabled{opacity:.45;cursor:not-allowed}
.swb-chip{border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:4px 11px;font-size:12px;cursor:pointer;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.swb-chip.on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.swb-input{flex:1;min-width:200px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 9px;font-size:12px;color:var(--dsw-alias-label-primary)}
.swb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.swb-step{display:flex;flex-direction:column;gap:8px}
.swb-desc{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.swb-status{font-size:12px;border-radius:8px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.swb-badge{font-size:11px;line-height:1;border-radius:999px;padding:4px 9px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.swb-badge.done{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.swb-badge.empty{color:var(--dsw-alias-label-secondary);opacity:.8}
.swb-project{font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;gap:10px;flex-wrap:wrap}
.swb-track{display:flex;align-items:center;gap:8px}
.swb-track audio{flex:1;min-width:220px;height:34px}
.swb-track-label{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:60px}
.swb-track-name{font-size:11px;color:var(--dsw-alias-label-secondary);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.swb-mini{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;line-height:1.4;white-space:nowrap}
.swb-mini:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.swb-tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:6px}
.swb-tab{display:flex;align-items:center;gap:6px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:5px 10px;font-size:13px;cursor:pointer;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.swb-tab:hover{background:var(--dsw-alias-bg-layer-2)}
.swb-tab.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.swb-tab-count{font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);border-radius:999px;padding:1px 6px}
.swb-list{display:flex;flex-direction:column;gap:4px;margin-top:4px}
.swb-list-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-size:12px}
.swb-list-row.on{border-color:var(--dsw-alias-brand-primary)}
.swb-list-name{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.swb-mini.danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.swb-acc{display:flex;flex-direction:column;gap:6px}
.swb-acc-item{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base)}
.swb-acc-item.on{border-color:var(--dsw-alias-border-l2)}
.swb-acc-head{display:flex;align-items:center;gap:8px;padding:6px 8px}
.swb-acc-toggle{flex:1;display:flex;align-items:center;gap:8px;background:transparent;border:0;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;text-align:left;padding:2px 4px;border-radius:6px;min-width:0}
.swb-acc-toggle:hover{background:var(--dsw-alias-bg-layer-2)}
.swb-chevron{width:14px;color:var(--dsw-alias-label-secondary);font-size:11px}
.swb-acc-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.swb-acc-dir{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:44%}
.swb-acc-body{display:flex;flex-direction:column;gap:8px;padding:4px 12px 12px 12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.swb-status.running{color:var(--dsw-alias-state-warn-primary)}
.swb-status.done{color:var(--dsw-alias-state-success-primary)}
.swb-status.failed{color:var(--dsw-alias-state-error-primary)}
.swb-log{margin:0;max-height:200px;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;font-size:11px;line-height:1.5;font-family:ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary)}
.swb-file{display:flex;gap:8px;align-items:center;justify-content:space-between;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;font-size:12px}
.swb-file code{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.swb-shots{display:flex;flex-direction:column;gap:8px}
.swb-shot img{width:100%;border-radius:8px;border:1px solid var(--dsw-alias-border-l1)}
.swb-error{color:var(--dsw-alias-state-error-primary);font-size:12px}
`

    async function call(path, body) {
      const res = await fetch(API + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      let data = null
      try {
        data = await res.json()
      } catch {
        throw new Error(`HTTP ${res.status}`)
      }
      if (!res.ok || !data || data.ok !== true) throw new Error((data && data.error) || `HTTP ${res.status}`)
      return data
    }

    function mediaUrl(path) {
      return `${API}/media?path=${encodeURIComponent(path)}`
    }

    function shortPath(path) {
      if (!path) return '—'
      const text = String(path)
      return text.startsWith('D:\\singer\\') ? text.slice('D:\\singer\\'.length) : text
    }

    function TextInput(props) {
      return h('input', {
        className: 'swb-input',
        value: props.value,
        placeholder: props.placeholder || '',
        spellCheck: false,
        onChange: (event) => props.onChange(event.target.value),
      })
    }

    function StepCard(props) {
      return h(
        'div',
        { className: 'swb-card swb-step' },
        h(
          'div',
          { className: 'swb-row', style: { justifyContent: 'space-between' } },
          h('h2', null, props.title),
          props.badge
            ? h(
                'span',
                { className: `swb-badge ${props.badge.done ? 'done' : 'empty'}`, title: props.badge.hint || '' },
                props.badge.text,
              )
            : null,
        ),
        h('div', { className: 'swb-desc' }, props.desc),
        props.children,
        props.status
          ? h('div', { className: `swb-status ${props.status.status}` }, props.status.text)
          : null,
      )
    }

    function fmtAt(iso) {
      if (!iso) return ''
      const text = String(iso)
      return text.length >= 16 ? text.slice(5, 16).replace('T', ' ') : text
    }

    /** 每个阶段「有没有产出」，依据项目里的实际文件 + project.json 的 steps 时间。 */
    function stageInfo(project, out) {
      const steps = (project && project.steps) || {}
      const at = (key) => (steps[key] && steps[key].at ? fmtAt(steps[key].at) : '')
      const badge = (done, when, extra) => ({
        done,
        text: done ? `已有产出${when ? ' · ' + when : ''}${extra ? ' · ' + extra : ''}` : '还没有产出',
        hint: done ? '项目目录里已有这一步的结果，可以直接复用' : '还没跑过这一步',
      })
      return {
        separate: badge(Boolean(out.vocals && out.instrumental), at('separate')),
        pitch: badge(Boolean(out.report && out.curve), at('pitch')),
        voice: badge(Boolean(out.vc), at('voice')),
        mix: badge(Boolean(out.cover), at('mix')),
      }
    }

    function findOutputs(projects, key) {
      const found = { vocals: '', instrumental: '', cover: '', report: '', curve: '', vc: '', refWav: '', shifted: null, dir: '', project: null }
      const list = projects || []
      const proj = list.find((item) => item.id === key) || list.find((item) => item.dir && item.dir.split('\\').pop() === key)
      if (!proj) return found
      found.project = proj
      found.dir = proj.dir
      const all = [].concat(proj.files.audio || [], proj.files.analysis || [], proj.files.work || [])
      let vcBest = null
      for (const file of all) {
        if (file.name === 'vocals.wav') found.vocals = file.path
        if (file.name === 'instrumental.wav') found.instrumental = file.path
        if (file.name === 'cover.mp3') found.cover = file.path
        if (file.name === 'pitch_report.json') found.report = file.path
        if (file.name === 'pitch_curve.png') found.curve = file.path
        if (file.name === 'ref.wav') found.refWav = file.path
        const shiftMatch = /^instrumental_shift([+-]\d+(?:\.\d+)?)\.wav$/.exec(file.name)
        if (shiftMatch) found.shifted = { path: file.path, semitones: Number(shiftMatch[1]) }
        if (/^vc_.*\.wav$/.test(file.name)) {
          // 一个项目可能有多次换音色，取最新的一版
          if (!vcBest || String(file.mtime || '') >= String(vcBest.mtime || '')) vcBest = file
        }
      }
      if (vcBest) {
        found.vc = vcBest.path
        found.vcName = vcBest.name
        found.vcMtime = vcBest.mtime
      }
      return found
    }

    function track(label, path, onReveal) {
      return h(
        'div',
        { className: 'swb-track' },
        h('span', { className: 'swb-track-label' }, label),
        h('audio', { controls: true, preload: 'none', src: mediaUrl(path), style: { flex: 1, minWidth: '220px' } }),
        h('code', { className: 'swb-track-name' }, String(path).split('\\').pop()),
        onReveal
          ? h(
              'button',
              { className: 'swb-mini', title: '在资源管理器里打开这个文件所在的文件夹', onClick: () => onReveal(path) },
              '文件夹',
            )
          : null,
      )
    }

    function Panel() {
      const [data, setData] = useState(null)
      const [songPath, setSongPath] = useState('')
      const [vocals, setVocals] = useState('')
      const [instrumental, setInstrumental] = useState('')
      const [ref, setRef] = useState('')
      const [semitones, setSemitones] = useState('auto')
      const [steps, setSteps] = useState(30)
      const [online, setOnline] = useState(false)
      const [refSeconds, setRefSeconds] = useState(null)
      const [vocalSource, setVocalSource] = useState('separated')
      const [openProjects, setOpenProjects] = useState([])
      const [showProjectList, setShowProjectList] = useState(false)
      const [showSongList, setShowSongList] = useState(false)
      const [showCurve, setShowCurve] = useState(false)
      const [followShift, setFollowShift] = useState(true)
      const [tune, setTune] = useState(false)
      const [tuneStrength, setTuneStrength] = useState(0.6)
      const [tuneMode, setTuneMode] = useState('scale')
      const [showOutputs, setShowOutputs] = useState(true)
      const [creating, setCreating] = useState(false)
      const [newName, setNewName] = useState('')
      const [renaming, setRenaming] = useState('')
      const [renameDraft, setRenameDraft] = useState('')
      const [job, setJob] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [report, setReport] = useState(null)
      const timer = useRef(null)

      const refresh = useCallback(async () => {
        const next = await call('/state')
        setData(next)
        return next
      }, [])

      useEffect(() => {
        let alive = true
        refresh()
          .then((next) => {
            if (!alive) return
            const first = (next.songs || [])[0]
            if (first && !songPath) {
              setSongPath(first.file)
              const out = findOutputs(next.projects, first.name)
              if (out.vocals) {
                setVocals(out.vocals)
                if (out.instrumental) setInstrumental(out.instrumental)
              }
            }
            if (first && !ref) setRef(first.file)
          })
          .catch((err) => alive && setError(String(err.message || err)))
        return () => {
          alive = false
        }
      }, [refresh])

      // 参考音频时长：整首歌当参考效果会很差，这里提前提示
      useEffect(() => {
        if (!ref) {
          setRefSeconds(null)
          return undefined
        }
        const audio = new Audio(mediaUrl(ref))
        const onMeta = () => setRefSeconds(Math.round(audio.duration || 0))
        const onError = () => setRefSeconds(null)
        audio.addEventListener('loadedmetadata', onMeta)
        audio.addEventListener('error', onError)
        return () => {
          audio.removeEventListener('loadedmetadata', onMeta)
          audio.removeEventListener('error', onError)
          audio.src = ''
        }
      }, [ref])

      // 切换项目/刷新后，如果已经有产物就把路径填上，省得手动复制
      const autoSourceFor = useRef('')
      useEffect(() => {
        if (!data) return
        const name = songPath ? String(songPath).split('\\').pop().replace(/\.[^.]+$/, '') : ''
        const out = findOutputs(data.projects, name)
        if (!vocals && out.vocals) setVocals(out.vocals)
        if (!instrumental && out.instrumental) setInstrumental(out.instrumental)
        if (autoSourceFor.current !== name) {
          autoSourceFor.current = name
          // 有换音色结果就默认用它合成，并把人声路径同步过去，避免"选了换音色结果、路径却还是原始人声"
          if (out.vc) {
            setVocalSource('converted')
            setVocals(out.vc)
          } else {
            setVocalSource('separated')
          }
        }
      }, [data, songPath])

      // 读当前项目的音高报告，供第 4 步"跟随分析变调"用
      useEffect(() => {
        if (!data) return undefined
        const name = songPath ? String(songPath).split('\\').pop().replace(/\.[^.]+$/, '') : ''
        const out = findOutputs(data.projects, name)
        if (!out.report) return undefined
        let alive = true
        fetch(mediaUrl(out.report))
          .then((res) => res.json())
          .then((value) => {
            if (alive) setReport(value)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [data, songPath])
      useEffect(() => {
        if (!data) return
        const list = data.projects || []
        if (!list.length) return
        const name = songPath ? String(songPath).split('\\').pop().replace(/\.[^.]+$/, '') : ''
        const target = (list.find((p) => p.id === name) || list[0]).id
        setOpenProjects((prev) => (prev.includes(target) ? prev : [target, ...prev]))
      }, [data, songPath])

      const toggleProject = (id) =>
        setOpenProjects((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

      useEffect(() => {
        if (!job || job.status !== 'running') {
          if (timer.current) clearInterval(timer.current)
          return undefined
        }
        timer.current = setInterval(async () => {
          try {
            const next = await call(`/job?id=${encodeURIComponent(job.id)}`)
            setJob(next.job)
            if (next.job && next.job.status !== 'running') {
              clearInterval(timer.current)
              await refresh()
            }
          } catch (err) {
            setError(String(err.message || err))
          }
        }, 2000)
        return () => {
          if (timer.current) clearInterval(timer.current)
        }
      }, [job && job.id, job && job.status, refresh])

      const handledJob = useRef('')

      useEffect(() => {
        if (!job || job.status === 'running') {
          setBusy('')
          return
        }
        if (job.status !== 'done') {
          setBusy('')
          return
        }
        if (handledJob.current === job.id) return
        handledJob.current = job.id
        const projKey = job.project || (job.outDir ? String(job.outDir).split('\\').slice(-2, -1)[0] : '')
        const out = findOutputs(data && data.projects, projKey)
        if (job.kind === 'separate' && out.vocals) {
          setVocals(out.vocals)
          if (out.instrumental) setInstrumental(out.instrumental)
        }
        if (job.kind === 'voice') {
          setVocalSource('converted')
          if (out.vc) setVocals(out.vc)
          // 换音色用了分析出的变调时，合成也自动换成对应的变调伴奏
          if (out.shifted) setInstrumental(out.shifted.path)
        }
        if (job.kind === 'pitch') {
          if (out.vocals) setVocals(out.vocals)
          if (out.report) {
            fetch(mediaUrl(out.report))
              .then((res) => res.json())
              .then((value) => setReport(value))
              .catch(() => {})
          }
        }
        if (job.kind === 'mix' && out.vocals) {
          setVocals(out.vocals)
        }
        setBusy('')
      }, [job && job.id, job && job.status, data])

      async function run(kind, params, needed) {
        if (needed) {
          setError(t(needed))
          return
        }
        setError('')
        setReport(kind === 'pitch' ? null : report)
        setBusy(kind)
        try {
          const next = await call('/run', { kind, params })
          setJob(next.job)
        } catch (err) {
          setError(String(err.message || err))
          setBusy('')
        }
      }

      async function cancel() {
        if (!job) return
        try {
          const next = await call('/cancel', { id: job.id })
          setJob(next.job)
        } catch (err) {
          setError(String(err.message || err))
        }
      }

      async function openPath(path) {
        if (!path) return
        try {
          await call('/open', { path })
        } catch (err) {
          setError(String(err.message || err))
        }
      }

      const songs = (data && data.songs) || []
      const projects = (data && data.projects) || []
      const songName = songPath ? String(songPath).split('\\').pop().replace(/\.[^.]+$/, '') : ''
      const songOut = findOutputs(projects, songName)
      const stage = stageInfo(songOut.project, songOut)
      const analysisShift = report && Number.isFinite(Number(report.auto_shift_semitones))
        ? Number(report.auto_shift_semitones)
        : songOut.shifted
          ? songOut.shifted.semitones
          : 0
      const projectSteps = songOut.project && songOut.project.steps ? songOut.project.steps : {}
      const projectDone = ['separate', 'pitch', 'voice', 'mix'].filter((k) => projectSteps[k])
      const running = job && job.status === 'running'

      // 参考音色可以从任意项目挑：分离人声 / 现成参考 / 换音色结果
      const refCandidates = []
      for (const proj of projects) {
        const o = findOutputs(projects, proj.id)
        if (o.vocals) refCandidates.push({ group: proj.title, label: '分离人声', path: o.vocals })
        if (o.refWav) refCandidates.push({ group: proj.title, label: '现成参考', path: o.refWav })
        if (o.vc) refCandidates.push({ group: proj.title, label: '换音色结果', path: o.vc })
      }

      const statusFor = (kind) => {
        if (!job || job.kind !== kind) return null
        const map = {
          running: t('running'),
          done: '完成',
          failed: job.error || '失败',
          cancelled: '已取消',
          interrupted: '上次运行中断',
        }
        return { status: job.status, text: map[job.status] || job.status }
      }

      return h(
        'div',
        { className: 'swb-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'swb-head' },
          h('h1', null, t('title')),
          h('p', null, t('subtitle')),
        ),
        error ? h('div', { className: 'swb-error' }, t('error') + error) : null,

        h(
          'section',
          { className: 'swb-card' },
          h('div', { className: 'swb-row' }, h('h2', null, t('songSection')), h('button', { className: 'swb-btn', onClick: () => refresh().catch((err) => setError(err.message)) }, t('refresh'))),
          h(
            'div',
            { className: 'swb-row' },
            h('span', { className: 'swb-label' }, '当前'),
            h('span', { className: 'swb-acc-title' }, songPath ? String(songPath).split('\\').pop() : '未选择'),
            h(
              'button',
              { className: 'swb-mini', onClick: () => setShowSongList(!showSongList) },
              showSongList ? '收起 ▲' : `切换歌曲（${songs.length}） ▼`,
            ),
          ),
          showSongList
            ? h(
                'div',
                { className: 'swb-list' },
                ...(songs.length
                  ? songs.map((song) =>
                      h(
                        'div',
                        { key: song.file, className: `swb-list-row ${song.file === songPath ? 'on' : ''}` },
                        h('span', { className: 'swb-list-name' }, song.name),
                        h('span', { className: 'swb-desc' }, `${song.sizeMb} MB`),
                        h(
                          'button',
                          {
                            className: 'swb-mini',
                            onClick: () => {
                              setSongPath(song.file)
                              setShowSongList(false)
                              setOpenProjects((prev) => (prev.includes(song.name) ? prev : [song.name, ...prev]))
                              const dir = findOutputs(projects, song.name)
                              if (dir.vocals) {
                                setVocals(dir.vocals)
                                if (dir.instrumental) setInstrumental(dir.instrumental)
                              }
                            },
                          },
                          '切换到这首',
                        ),
                      ),
                    )
                  : [h('div', { className: 'swb-desc' }, t('noSongs'))]),
                h('div', { className: 'swb-row' }, h('span', { className: 'swb-label' }, '手动路径'), h(TextInput, { value: songPath, onChange: setSongPath })),
              )
            : null,
          h(
            'div',
            { className: 'swb-row' },
            h('button', { className: 'swb-btn', onClick: () => openPath((data && data.sourceDir) || 'D:\\singer\\source') }, '打开 source 文件夹'),
            h('button', { className: 'swb-btn', onClick: () => openPath((data && data.projectsDir) || 'D:\\singer\\projects') }, '打开 projects 文件夹'),
            h('button', { className: 'swb-btn', onClick: () => setCreating(!creating) }, creating ? '取消新建' : '新建项目'),
          ),
          creating
            ? h(
                'div',
                { className: 'swb-row' },
                h('span', { className: 'swb-label' }, '新项目名'),
                h(TextInput, { value: newName, onChange: setNewName }),
                h(
                  'button',
                  {
                    className: 'swb-btn primary',
                    disabled: !newName.trim(),
                    onClick: async () => {
                      try {
                        const r = await call('/project/create', { name: newName, source: songPath || null })
                        setCreating(false)
                        setNewName('')
                        await refresh()
                        setOpenProjects((prev) => (prev.includes(r.id) ? prev : [r.id, ...prev]))
                      } catch (err) {
                        setError(String(err.message || err))
                      }
                    },
                  },
                  '创建',
                ),
              )
            : null,
          songOut.project
            ? h(
                'div',
                { className: 'swb-project' },
                h('span', null, `当前项目：${songOut.project.title}`),
                h(
                  'span',
                  null,
                  projectDone.length ? `已完成 ${projectDone.length}/4：${projectDone.join(' · ')}` : '还没跑过任何步骤',
                ),
                songOut.project.updatedAt ? h('span', null, `更新于 ${fmtAt(songOut.project.updatedAt)}`) : null,
              )
            : h('div', { className: 'swb-project' }, '这个源文件还没有项目目录，跑一次分离就会在 projects\\ 下创建。'),
          h(
            'div',
            { className: 'swb-row' },
            h(
              'button',
              { className: 'swb-mini', onClick: () => setShowProjectList(!showProjectList) },
              showProjectList ? '收起项目列表 ▲' : `项目列表（${projects.length}） ▼`,
            ),
          ),
          showProjectList && projects.length
            ? h(
                'div',
                { className: 'swb-list' },
                ...projects.map((item) =>
                  h(
                    'div',
                    { key: item.id, className: `swb-list-row ${openProjects.includes(item.id) ? 'on' : ''}` },
                    renaming === item.id
                      ? [
                          h(TextInput, { key: 'input', value: renameDraft, onChange: setRenameDraft }),
                          h(
                            'button',
                            {
                              key: 'ok',
                              className: 'swb-btn primary',
                              onClick: async () => {
                                try {
                                  await call('/project/rename', { id: item.id, name: renameDraft })
                                  setRenaming('')
                                  await refresh()
                                } catch (err) {
                                  setError(String(err.message || err))
                                }
                              },
                            },
                            '确定',
                          ),
                          h('button', { key: 'cancel', className: 'swb-btn', onClick: () => setRenaming('') }, '取消'),
                        ]
                      : [
                          h('span', { key: 'name', className: 'swb-list-name' }, item.title),
                          h(
                            'span',
                            { key: 'steps', className: 'swb-desc' },
                            `${['separate', 'pitch', 'voice', 'mix'].filter((k) => (item.steps || {})[k]).length}/4`,
                          ),
                          h('button', { key: 'open', className: 'swb-mini', onClick: () => openPath(item.dir) }, '打开'),
                          h(
                            'button',
                            {
                              key: 'rename',
                              className: 'swb-mini',
                              onClick: () => {
                                setRenaming(item.id)
                                setRenameDraft(item.id)
                              },
                            },
                            '重命名',
                          ),
                          h(
                            'button',
                            {
                              key: 'delete',
                              className: 'swb-mini danger',
                              onClick: async () => {
                                if (!window.confirm(`删除项目「${item.title}」？会移到 archive\\trash 留底，可以再捡回来。`)) return
                                try {
                                  await call('/project/delete', { id: item.id })
                                  await refresh()
                                } catch (err) {
                                  setError(String(err.message || err))
                                }
                              },
                            },
                            '删除',
                          ),
                        ],
                  ),
                ),
              )
            : null,
        ),

        h(
          'div',
          { className: 'swb-grid' },
          h(
            StepCard,
            { title: `2. ${t('stepSeparate')}`, desc: t('stepSeparateDesc'), status: statusFor('separate'), badge: stage.separate },
            h(
              'div',
              { className: 'swb-row' },
              h(
                'button',
                {
                  className: 'swb-btn primary',
                  disabled: running || busy === 'separate',
                  onClick: () => run('separate', { input: songPath }, songPath ? '' : 'needSong'),
                },
                t('run'),
              ),
              songOut.vocals
                ? h('button', { className: 'swb-btn', onClick: () => { setVocals(songOut.vocals); setInstrumental(songOut.instrumental) } }, '用已有产物')
                : null,
            ),
            vocals ? h('div', { className: 'swb-row' }, h('span', { className: 'swb-label' }, t('vocalsPath')), h(TextInput, { value: vocals, onChange: setVocals })) : null,
            instrumental ? h('div', { className: 'swb-row' }, h('span', { className: 'swb-label' }, t('instrumentalPath')), h(TextInput, { value: instrumental, onChange: setInstrumental })) : null,
          ),

          h(
            StepCard,
            { title: `3. ${t('stepPitch')}`, desc: t('stepPitchDesc'), status: statusFor('pitch'), badge: stage.pitch },
            h('div', { className: 'swb-row' }, h('span', { className: 'swb-label' }, t('semitones')), h(TextInput, { value: String(semitones), onChange: setSemitones }), h('span', { className: 'swb-desc' }, t('auto') + ' = 按 C3:C5 目标音域算')),
            h(
              'button',
              {
                className: 'swb-btn primary',
                disabled: running || busy === 'pitch',
                onClick: () => run('pitch', { vocals, instrumental, semitones: String(semitones) }, vocals ? '' : 'needVocals'),
              },
              t('run'),
            ),
            report
              ? h(
                  'div',
                  { className: 'swb-desc' },
                  `${report.key}（≈${report.relative_key}）· 中位 ${report.median_pitch} · 音域 ${report.range_p2_p98[0]}–${report.range_p2_p98[1]} · 建议变调 ${report.auto_shift_semitones} 半音`,
                )
              : null,
          ),

          h(
            StepCard,
            { title: `4. ${t('stepVoice')}`, desc: t('stepVoiceDesc'), status: statusFor('voice'), badge: stage.voice },
            h(
              'div',
              { className: 'swb-row' },
              h('span', { className: 'swb-label' }, '参考来自'),
              h(
                'select',
                {
                  className: 'swb-input',
                  value: refCandidates.some((c) => c.path === ref) ? ref : '__custom__',
                  onChange: (event) => {
                    if (event.target.value !== '__custom__') setRef(event.target.value)
                  },
                },
                ...refCandidates.map((c) => h('option', { key: c.path, value: c.path }, `${c.group} · ${c.label}`)),
                h('option', { value: '__custom__' }, '自定义路径（下面填）'),
              ),
            ),
            h('div', { className: 'swb-row' }, h('span', { className: 'swb-label' }, t('refPath')), h(TextInput, { value: ref, onChange: setRef })),
            h(
              'div',
              { className: 'swb-row' },
              h(
                'button',
                {
                  className: 'swb-btn',
                  disabled: !ref || !vocals || running || busy === 'ref',
                  onClick: async () => {
                    setBusy('ref')
                    setError('')
                    try {
                      const r = await call('/ref', {
                        vocals: ref,
                        duration: 20,
                        project: songOut.project ? songOut.project.id : songName,
                      })
                      setRef(r.path)
                    } catch (err) {
                      setError(String(err.message || err))
                    } finally {
                      setBusy('')
                    }
                  },
                },
                busy === 'ref' ? '截取中…' : '把选中的音频截 20 秒存进本项目',
              ),
            ),
            refSeconds
              ? h(
                  'div',
                  {
                    className: 'swb-desc',
                    style: refSeconds > 40 ? { color: 'var(--dsw-alias-state-warn-primary)' } : null,
                  },
                  refSeconds > 40
                    ? `参考音频 ${refSeconds} 秒，偏长：建议截 10–30 秒的干声（可用 makeref.cmd 截）`
                    : `参考时长 ${refSeconds} 秒`,
                )
              : null,
            h(
              'div',
              { className: 'swb-row' },
              h('span', { className: 'swb-label' }, t('steps')),
              ...[30, 50].map((value) =>
                h('button', { key: value, className: `swb-chip ${steps === value ? 'on' : ''}`, onClick: () => setSteps(value) }, String(value)),
              ),
            ),
            h(
              'label',
              { className: 'swb-row', style: { fontSize: '12px', cursor: 'pointer' } },
              h('input', { type: 'checkbox', checked: online, onChange: (event) => setOnline(event.target.checked) }),
              h('span', { className: 'swb-desc' }, t('onlineHint')),
            ),
            h(
              'div',
              { className: 'swb-row' },
              h('span', { className: 'swb-label' }, '音高'),
              h(
                'button',
                {
                  className: `swb-chip ${followShift ? 'on' : ''}`,
                  onClick: () => setFollowShift(true),
                  title: '按第 3 步分析出的建议变调量转换',
                },
                analysisShift ? `跟随分析 ${analysisShift > 0 ? '+' : ''}${analysisShift} 半音` : '跟随分析（还没分析）',
              ),
              h('button', { className: `swb-chip ${!followShift ? 'on' : ''}`, onClick: () => setFollowShift(false) }, '保持原调'),
            ),
            h(
              'label',
              { className: 'swb-row', style: { fontSize: '12px', cursor: 'pointer' } },
              h('input', { type: 'checkbox', checked: tune, onChange: (event) => setTune(event.target.checked) }),
              h('span', { className: 'swb-desc' }, '换音色前先修音准（WORLD，只改音高不改音色）'),
            ),
            tune
              ? h(
                  'div',
                  { className: 'swb-row' },
                  h('span', { className: 'swb-label' }, '修音强度'),
                  ...[0.3, 0.6, 0.9, 1.0].map((value) =>
                    h(
                      'button',
                      {
                        key: value,
                        className: `swb-chip ${tuneStrength === value ? 'on' : ''}`,
                        onClick: () => setTuneStrength(value),
                      },
                      `${Math.round(value * 100)}%`,
                    ),
                  ),
                  h('span', { className: 'swb-label' }, '目标'),
                  h(
                    'button',
                    { className: `swb-chip ${tuneMode === 'scale' ? 'on' : ''}`, onClick: () => setTuneMode('scale') },
                    report && report.key ? `调内（${report.key}）` : '调内',
                  ),
                  h('button', { className: `swb-chip ${tuneMode === 'semitone' ? 'on' : ''}`, onClick: () => setTuneMode('semitone') }, '十二平均律'),
                )
              : null,
            h(
              'button',
              {
                className: 'swb-btn primary',
                disabled: running || busy === 'voice',
                onClick: () =>
                  run(
                    'voice',
                    { vocals, ref, steps, online, semitones: followShift ? analysisShift : 0, tune, tuneStrength, tuneMode, tuneKey: report && report.key ? report.key : null },
                    vocals ? (ref ? '' : 'needRef') : 'needVocals',
                  ),
              },
              t('run'),
            ),
            h('div', { className: 'swb-desc' }, '大约 10 分钟 / 4 分钟的歌，跑的时候可以继续用别的面板。'),
          ),

          h(
            StepCard,
            { title: `5. ${t('stepMix')}`, desc: t('stepMixDesc'), status: statusFor('mix'), badge: stage.mix },
            h(
              'div',
              { className: 'swb-row' },
              h('span', { className: 'swb-label' }, '人声来源'),
              ...[
                { key: 'converted', label: '换音色结果', path: songOut.vc, enabled: Boolean(songOut.vc) },
                { key: 'separated', label: '分离人声', path: songOut.vocals, enabled: Boolean(songOut.vocals) },
                { key: 'custom', label: '手动填', path: vocals, enabled: true },
              ].map((opt) =>
                h(
                  'button',
                  {
                    key: opt.key,
                    className: `swb-chip ${vocalSource === opt.key ? 'on' : ''}`,
                    disabled: !opt.enabled,
                    onClick: () => {
                      setVocalSource(opt.key)
                      if (opt.key !== 'custom' && opt.path) setVocals(opt.path)
                    },
                  },
                  opt.label,
                ),
              ),
            ),
            h('div', { className: 'swb-row' }, h('span', { className: 'swb-label' }, t('vocalsPath')), h(TextInput, { value: vocals, onChange: (v) => { setVocals(v); setVocalSource('custom') } })),
            h(
              'div',
              { className: 'swb-row' },
              h('span', { className: 'swb-label' }, '伴奏来源'),
              h(
                'button',
                {
                  className: `swb-chip ${instrumental === songOut.instrumental && songOut.instrumental ? 'on' : ''}`,
                  onClick: () => songOut.instrumental && setInstrumental(songOut.instrumental),
                },
                '原调伴奏',
              ),
              h(
                'button',
                {
                  className: `swb-chip ${songOut.shifted && instrumental === songOut.shifted.path ? 'on' : ''}`,
                  disabled: !songOut.shifted,
                  title: songOut.shifted ? '' : '第 3 步还没产出变调伴奏',
                  onClick: () => songOut.shifted && setInstrumental(songOut.shifted.path),
                },
                songOut.shifted ? `变调伴奏 ${songOut.shifted.semitones > 0 ? '+' : ''}${songOut.shifted.semitones} 半音` : '变调伴奏（无）',
              ),
            ),
            h('div', { className: 'swb-row' }, h('span', { className: 'swb-label' }, t('instrumentalPath')), h(TextInput, { value: instrumental, onChange: setInstrumental })),
            !songOut.vc && songOut.vocals
              ? h('div', { className: 'swb-desc' }, '还没有换音色产物，合成会用分离出来的原始人声（听起来接近原曲）。')
              : null,
            h(
              'button',
              {
                className: 'swb-btn primary',
                disabled: running || busy === 'mix',
                onClick: () =>
                  run(
                    'mix',
                    { vocals: vocalSource === 'converted' && songOut.vc ? songOut.vc : vocals, instrumental },
                    vocals && instrumental ? '' : instrumental ? 'needVocals' : 'needVocals',
                  ),
              },
              t('run'),
            ),
          ),
        ),

        h(
          'section',
          { className: 'swb-card' },
          h('div', { className: 'swb-row' }, h('h2', null, t('jobSection')), job ? h('span', { className: `swb-status ${job.status}` }, `${job.id} · ${job.status}`) : null, job && job.persisted ? h('span', { className: 'swb-desc' }, '历史记录') : null, job && job.outDir ? h('button', { className: 'swb-mini', onClick: () => openPath(job.outDir) }, '打开输出目录') : null, running ? h('button', { className: 'swb-btn', onClick: cancel }, t('cancel')) : null),
          job
            ? h(
                'div',
                null,
                h('div', { className: 'swb-desc' }, `${job.title} → ${shortPath(job.outDir)}`),
                h('pre', { className: 'swb-log' }, (job.log || []).slice(-40).join('\n')),
              )
            : h('div', { className: 'swb-desc' }, t('noJob')),
        ),

        h(
          'section',
          { className: 'swb-card' },
          h('div', { className: 'swb-row' }, h('h2', null, t('results')),
            projects.length ? h('span', { className: 'swb-desc' }, `${projects.length} 个项目 · ${openProjects.length} 个展开`) : null,
            h('button', { className: 'swb-mini', onClick: () => setShowOutputs(!showOutputs) }, showOutputs ? '收起全部' : '展开')),
          showOutputs
            ? projects.length
              ? h(
                  'div',
                  { className: 'swb-acc' },
                  ...projects.map((item) => {
                    const open = openProjects.includes(item.id)
                    const out = findOutputs(projects, item.id)
                    const steps = item.steps || {}
                    const done = ['separate', 'pitch', 'voice', 'mix'].filter((k) => steps[k])
                    return h(
                      'div',
                      { key: item.id, className: `swb-acc-item ${open ? 'on' : ''}` },
                      h(
                        'div',
                        { className: 'swb-acc-head' },
                        h(
                          'button',
                          { className: 'swb-acc-toggle', onClick: () => toggleProject(item.id) },
                          h('span', { className: 'swb-chevron' }, open ? '▾' : '▸'),
                          h('span', { className: 'swb-acc-title' }, item.title),
                          h('span', { className: 'swb-tab-count' }, `${done.length}/4`),
                          h('code', { className: 'swb-acc-dir' }, shortPath(item.dir)),
                        ),
                        h('button', { className: 'swb-mini', onClick: () => openPath(item.dir) }, '打开'),
                      ),
                      open
                        ? h(
                            'div',
                            { className: 'swb-acc-body' },
                            out.vocals ? track('分离人声', out.vocals, openPath) : null,
                            out.vc ? track('换音色', out.vc, openPath) : null,
                            out.cover ? track('成品', out.cover, openPath) : null,
                            !out.vocals && !out.vc && !out.cover
                              ? h('div', { className: 'swb-desc' }, '这个项目还没有可试听的产物。')
                              : null,
                            h(
                              'div',
                              { className: 'swb-row' },
                              h(
                                'span',
                                { className: 'swb-desc' },
                                `文件：audio ${(item.files.audio || []).length} · analysis ${(item.files.analysis || []).length} · work ${(item.files.work || []).length}`,
                              ),
                              out.curve
                                ? h(
                                    'button',
                                    { className: 'swb-mini', onClick: () => setShowCurve(!showCurve) },
                                    showCurve ? '隐藏音高曲线' : '查看音高曲线',
                                  )
                                : null,
                            ),
                            out.curve && showCurve
                              ? h('div', { className: 'swb-shot' }, h('img', { src: mediaUrl(out.curve), alt: 'pitch curve' }))
                              : null,
                          )
                        : null,
                    )
                  }),
                )
              : h('div', { className: 'swb-desc' }, t('noResults'))
            : null,
        ),
      )
    }

    function Icon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M9 18V6l10-2v12', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('circle', { cx: 6.5, cy: 18, r: 2.6, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('circle', { cx: 16.5, cy: 16, r: 2.6, stroke: 'currentColor', strokeWidth: 1.6 }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        translate = ctx.locale.bind('singerWorkbench')
        ctx.effect(() => ctx.locale.register('singerWorkbench', 'zh', DICTS.zh))
        ctx.effect(() => ctx.locale.register('singerWorkbench', 'en', DICTS.en))
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'singer-workbench', order: 30, label: () => t('nav') }, Icon),
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'singer-workbench' }, Panel))
      },
    }
  },
})
