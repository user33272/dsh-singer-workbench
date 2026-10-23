# 音乐工作台（dsh-singer-workbench）

把 `D:\singer` 里已经跑通的脚本做成 Harness Web UI 里的一个页面，分两个子项：

- **翻唱**：分离 → 音高分析 → 换音色 → 合成
- **生成**：song-sheet 总稿 → MIDI → 本机钢琴音源离线渲染试听

## 界面

左侧栏「音乐工作台」→ 顶部两个选项卡「翻唱 / 生成」。

### 翻唱选项卡

1. **选歌**：默认只显示「当前：<文件名>」，点「切换歌曲（N）」才展开歌曲列表（手动路径也在里面）；`D:\singer\source\` 里的音频点一下即切。
   - 「打开 source 文件夹」/「打开 projects 文件夹」直接开资源管理器
   - 项目列表支持 **新建 / 重命名 / 删除 / 打开**：删除会移到 `archive\trash\<时间戳>-<项目>` 留底，可恢复；项目正在跑任务时会拒绝改名或删除
2. **分离人声**：调用 `work\separate.py`（Mel-Band RoFormer），产出 `projects\<项目>\audio\vocals.wav` + `instrumental.wav`。
3. **音高分析**：调用 `work\pitch.py`，结果写进 `projects\<项目>\analysis\`，回填调性、音域与建议变调。
4. **换音色**：调用 `work\voice.py`（Seed-VC 零样本），产物进 `projects\<项目>\work\`。
   - 「音高」默认 **跟随分析**（用第 3 步算出的变调量，如 -8 半音），可切「保持原调」
   - **修音准**（默认关闭）：勾选后先跑 `work\tune.py`（WORLD 声码器，只改 f0、不动音色），把音吸到目标音高，再换音色；可调 **强度** 30/60/90/100% 与 **目标** 调内音 / 十二平均律；修过的中间产物留在 `work\tuned_vocals.wav`
   - 参考音色可来自任意项目（分离人声 / 现成参考 / 换音色结果），也能一键截 20 秒
5. **合成**：调用 `work\mix.py`，默认写 `projects\<项目>\work\cover.wav` + 320k mp3。
   - 「伴奏来源」可选 **原调伴奏** 或第 3 步产出的 **变调伴奏**；换音色用了变调时，这里会自动选变调伴奏

每个任务都有状态、日志尾部和取消按钮；产物区是**可折叠的折叠面板**：一个项目一个可展开条（标题 + 完成步数 `n/4` + 目录），点开显示该项目的三轨（分离人声 / 换音色 / 成品）、文件计数与音高曲线，可以同时展开多个，也能「收起全部」。切歌时自动展开对应项目。选歌区的项目列表同样默认收起，点「项目列表（N）」再展开。
每张步骤卡片右上角有「已有产出 · 时间」/「还没有产出」标记，选歌时按项目实际文件自动判断，并自动把已有的人声/伴奏路径填好。

产物和任务都能直接在资源管理器里打开：

- 每条产物轨道右侧的「文件夹」→ 打开该文件所在的目录（`work\` / `audio\`）
- 项目标题旁的「打开项目目录」→ 打开整个 `projects\<项目>\`
- 任务区的「打开输出目录」→ 打开当前任务的产出目录

路由是 `POST /api/dsh-singer/open`，只接受 `D:\singer` 内的路径，越界直接 400。
不用 `explorer /select`：这台机器上中文路径会被 Explorer 忽略并跳到「文档」，所以统一打开所在文件夹。

### 跨项目参考音色

换音色卡片里「参考来自」是一个下拉，列出**所有项目**的可用参考：

- `<项目> · 分离人声`（audio/vocals.wav）
- `<项目> · 现成参考`（work/ref.wav）
- `<项目> · 换音色结果`（work/vc_*.wav）
- `自定义路径`：下面手动填

选中任意一项后点「把选中的音频截 20 秒存进本项目」，就会从那段音频里自动挑最响的 20 秒、规范化响度，存到**当前项目**的 `work/ref.wav` 并回填路径。这样 A 歌的人声可以直接拿来给 B 歌换音色。

### 生成选项卡

列出 `projects\` 下带有 `song-sheet.md` 或 `midi\*.mid` 的项目，每个项目显示三格状态：**总稿 / MIDI / 试听**（`n/3`）。

- **渲染钢琴**：调用本机 `FluidSynth` + `GeneralUser-GS.sf2`，把 `midi\<项目>.mid` 渲染到 `renders\<项目>_piano.wav`，再经 ffmpeg `loudnorm` 压到 −16 LUFS 并转 192k `renders\<项目>_piano.mp3`；全程离线，约 5–8 秒
- **重建 MIDI**：跑 `tools\build_midi.py`（兼容老的 `midi\build_midi.py`），改完旋律先点这个再渲染
- **整理产物**：把老布局（脚本和 `preview_*` 全堆在 `midi\`）搬进 `tools\` 与 `renders\`，重写 `products.json`；文件被占用时退化为复制并提示稍后再整理
- **试听**：直接走 `/media` 流式播放，可拖动
- **总稿 / 目录**：在资源管理器里打开 `song-sheet.md` 或项目目录
- 卡片顶部显示渲染链自检：FluidSynth / 音源 / ffmpeg 三项是否就绪
- 产物按 **总稿 / MIDI / 钢琴试听 / 无损 WAV** 分行列出，带大小、修改时间和「文件夹」按钮；`midi\` 里若还有杂物，面板会提示「还有 N 个杂物文件」

生成项目的目录约定：

```
projects\<项目>\
    song-sheet.md              词曲、结构、和弦、编曲总稿
    midi\
        <项目>.mid             渲染用的 MIDI（优先取这个文件名）
    renders\
        <项目>_piano.wav       渲染产物（无损，loudnorm 后）
        <项目>_piano.mp3       试听（−16 LUFS）
        _legacy\               旧的 preview_* 归档，可整个删掉
    tools\
        build_midi.py          重建 MIDI 的脚本
        preview.py
    products.json              产物清单（kind / label / path / size / mtime）
```

同一个项目如果只有 `midi\` 没有总稿也能列出来；两边都没有则不会出现在生成选项卡。

## 项目目录（翻唱 / 生成分开）

翻唱和生成的产物分开放，互不影响：

```
projects\
    cover\<项目>\          翻唱
        project.json   title / source / createdAt / steps（每一步的时间戳）
        audio\         source.wav / vocals.wav / instrumental.wav / *.mp3
        analysis\      f0.csv / pitch_curve.png / pitch_report.json / instrumental_shift±N.wav
        work\          ref.wav / vc_*.wav / tuned_vocals.wav / cover.wav / cover.mp3
        baselines\     旧模型与 A/B 片段
    gen\<项目>\            生成
        song-sheet.md
        midi\<项目>.mid
        renders\<项目>_piano.mp3 / .wav
        tools\build_midi.py
        products.json
```

- 两端各自独立扫描：翻唱面板只看 `cover\`，生成面板只看 `gen\`
- 旧版本平铺在 `projects\<项目>\` 的目录用 `work\migrate_split.py` + `work\finish_split.py` 一次性拆开
- 项目 id 默认取源文件名（保留中文），同一个源文件重复分离会复用已有项目；`-p/--project` 可以指定别的项目名


## Agent 工具

同一套逻辑注册成 `cover_workbench` 工具，参数：

- `action`: `status|scan|separate|pitch|voice|mix|job|cancel|gen|gen_render|gen_build`
- `input` / `vocals` / `instrumental` / `ref` / `semitones` / `steps` / `out` / `id`
- `gen` 列生成项目；`gen_render` / `gen_build` 需要 `project`（projects 下的目录名）

长任务（换音色约 10 分钟）立即返回任务 id，用 `action=job` 轮询。

## Host 路由

`/api/dsh-singer/state|run|job|cancel|media|gen/state|gen/render|gen/build`，客户端只通过 HTTP 调用，不接触文件系统。
`/media` 支持 Range，可直接给 `<audio>` 拖动播放；路径必须落在 `D:\singer` 内。

## 离线 / 联网

模型都在本地，四步都能断网跑（2026-10-22 用死代理实测）：

| 步骤 | 耗时（断网） |
|---|---|
| 分离（30 秒素材） | 11.1 s |
| 音高分析（30 秒素材） | 8.9 s |
| 换音色（15 秒素材 / 10 步） | 23.7 s |
| 合成（15 秒素材） | 0.8 s |

需要联网的只有：

- **首次下载模型**（分离 871 MiB、Seed-VC DiT 783 MB + rmvpe 173 MB + campplus/bigvgan/whisper）
- **换用没下载过的模型**（去和声 karaoke、去混响 dereverb 等）
- 界面里的「允许联网」勾选：只有第一次跑换音色、缓存里缺文件时才需要勾上

换音色默认注入 `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1`：不断网时也能省掉每次对 huggingface 的探测，断网时不会因为 hub 探测失败而报错。

## 任务历史持久化

- 文件：`D:\singer\state\history.json`（`version` / `savedAt` / `jobs`）
- 每个任务在**启动时**和**结束时**各写一次，写盘用「临时文件 + rename」，进程被强杀也不会留下半个 JSON
- 最多保留 200 条，每条只留最后 40 行日志，避免文件无限膨胀
- 重启后加载：状态为 `running` 的记录统一改成 `interrupted`（进程已经不在了），任务编号接着历史最大值往后排，不会撞号
- `/state` 与 `cover_workbench` 的 `status` 会合并「运行中的任务」和「历史记录」，各取最近 20 条


## 依赖

插件本身无 npm 依赖；运行依赖工作区里已有的：

- `work\venv`（分离 / 音高 / 合成 / 生成模块的 build_midi.py）
- `work\venv_vc`（换音色）
- `work\tools\fluidsynth\...\bin\fluidsynth.exe`（生成模块，v2.6.1）
- `work\soundfonts\GeneralUser-GS.sf2`（钢琴音源，32 MB）
- `work\bin\ffmpeg.exe`（响度归一化与 mp3 编码）

生成模块缺失任何一项时，界面卡片顶部会标 ✗，点渲染会直接报错说明缺什么。
