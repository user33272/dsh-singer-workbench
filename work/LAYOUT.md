# 工具布局与复用规则

一句话：**能复用的放 `work\`，只属于某首歌的放 `projects\<cover|gen>\<歌>\`。**

## work\ 里放什么

| 位置 | 内容 | 说明 |
|---|---|---|
| `work\*.py` / `*.cmd` | 主流程五个脚本 + 两个辅助 | `separate` / `pitch` / `tune` / `voice` / `mix`，`makeref`（截参考）、`gen_preview`（通用试听渲染） |
| `work\projectlib.py` | **唯一的路径与常量来源** | `ROOT` / `COVER` / `GEN` / `FFMPEG` / `VENV*_PY` / `SEEDVC`，以及项目 id 推断、目录创建、`project.json` 读写 |
| `work\sep.py` | audio-separator 的底层调用 | 被 `separate.py` 调，不直接给用户用 |
| `work\bench\` | 一次性实验脚本 | `compare.py`、`spec_cmp*.py`、`fetch_ref.py`，只在做 A/B 时用 |
| `work\migrations\` | 一次性迁移脚本 | 把旧的平铺产物搬到 `projects\`、拆成 `cover\`/`gen\` |
| `work\venv` / `venv_vc` | 两个 Python 环境 | 主环境跑分离/音高/修音准/合成，`venv_vc` 跑 Seed-VC |
| `work\bin\ffmpeg.exe` | ffmpeg | 所有脚本从 `projectlib.FFMPEG` 取路径 |
| `work\models\` | 分离模型、CREPE 权重 | 不进仓库 |
| `work\seedvc\` | Seed-VC 源码与权重 | 不进仓库 |
| `work\tools\`、`work\soundfonts\` | FluidSynth、钢琴音源 | 不进仓库（体积大、许可独立） |

## projects\ 里放什么

| 位置 | 内容 |
|---|---|
| `projects\cover\<歌>\audio\` | `source.wav`、`vocals.wav`、`instrumental.wav`、mp3 |
| `projects\cover\<歌>\analysis\` | `f0.csv`、`pitch_curve.png`、`pitch_report.json`、`instrumental_shift±N.wav` |
| `projects\cover\<歌>\work\` | `ref.wav`、`tuned_vocals.wav`、`vc_*.wav`、`cover.wav/mp3` |
| `projects\cover\<歌>\project.json` | 标题、源文件、每一步时间戳 |
| `projects\gen\<歌>\song-sheet.md` | 词曲总稿 |
| `projects\gen\<歌>\midi\<歌>.mid` | MIDI 结果 |
| `projects\gen\<歌>\renders\` | 试听 mp3、无损 wav、`_legacy\` 旧文件 |
| `projects\gen\<歌>\tools\build_midi.py` | **这首歌专属**的 MIDI 生成脚本（和弦/旋律写死） |
| `projects\gen\<歌>\products.json` | 产物清单 |

## 不放进项目的东西

- 通用渲染器、合成器、分析器 → `work\`
- 模型、音源、ffmpeg → `work\models`、`work\soundfonts`、`work\bin`
- 其它歌的参考音色 → 需要时从对方项目里挑，或复制到 `source\`

## 已知的重复（评估后保留）

| 重复 | 体积 | 结论 |
|---|---|---|
| `work\venv` 与 `work\venv_vc` 各装一份 torch | 约 8 GB | 两边依赖版本冲突（numpy 1.x vs 2.x），暂不合并；真要省空间可把 `venv_vc` 的 `torch*` 目录改成指向 `venv` 的 junction，但要接受升级时容易断 |
| 每个翻唱项目一份 `work\ref.wav` | 1.7–2.1 MB / 项目 | 保留：换音色的参考属于该项目状态，跨项目借用通过插件下拉选择 |
| `pipeline.js` 与 `projectlib.py` 各有一套项目 id 规则 | 代码 | 跨语言镜像，两边注释里互相指向；改动时需同步 |

## 命令速查

```cmd
:: 翻唱
work\separate.cmd "source\某歌.mp3"
work\pitch.cmd projects\cover\某歌\audio\vocals.wav -i projects\cover\某歌\audio\instrumental.wav -k auto
work\tune.cmd  projects\cover\某歌\audio\vocals.wav -s 0.6 -m scale -k "G# major"
work\voice.cmd projects\cover\某歌\audio\vocals.wav projects\cover\某歌\work\ref.wav -s 30
work\mix.cmd   projects\cover\某歌\work\vc_*.wav projects\cover\某歌\audio\instrumental.wav

:: 生成
work\gen_preview.cmd "projects\gen\某歌\midi\某歌.mid" -o out.wav --mp3
```
