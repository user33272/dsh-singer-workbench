# 翻唱链路（分离 + 音高/变调）

**默认分离模型：`vocals_mel_band_roformer.ckpt`（Mel-Band RoFormer）**，2026-10-22 用 `朧月` 与原 `kara2.onnx`（UVR MDX-NET Karaoke 2）做过 A/B，确认新模型更好。

## 项目目录（翻唱 / 生成分开）

翻唱与生成的产物分目录管理，互不干扰：

```
projects\cover\<项目>\     翻唱
    project.json     标题、源文件、每一步的时间戳
    audio\           source.wav / vocals.wav / instrumental.wav（+ mp3 预览）
    analysis\        f0.csv / pitch_curve.png / pitch_report.json / instrumental_shift±N.wav
    work\            ref.wav / vc_*.wav / tuned_vocals.wav / cover.wav / cover.mp3
    baselines\       旧模型与 A/B 片段的对照产物

projects\gen\<项目>\       生成（词曲总稿 → MIDI → 钢琴试听）
    song-sheet.md
    midi\<项目>.mid
    renders\<项目>_piano.mp3 / .wav
    tools\build_midi.py
    products.json
```

- 项目 id 默认取源文件名；同一个源文件再跑分离会复用已有项目（按 `project.json` 里的 `source` 匹配）
- 想指定项目：`-p "项目名"`（separate / pitch / mix），voice 用 `--project`
- 旧版本平铺在 `projects\<项目>\` 的目录已用 `work\migrations\migrate_split.py`、`work\migrations\finish_split.py` 拆开
- 更早的平铺产物归档在 `archive\old-out-20261023\`，`out/` 目录已取消

## 一键跑
```cmd
D:\singer\work\separate.cmd "D:\singer\source\朧月.mp3"
```
默认输出到 `projects\cover\朧月\audio\`：`source.wav`、`vocals.wav`、`instrumental.wav`（另附 320k mp3）。
可选参数：`-o 输出目录`、`-p 项目名`、`-m 模型文件名`。

## 位置
- venv：`D:\singer\work\venv`（Python 3.13，torch 2.11.0+cu128，torchvision 0.26.0，torchaudio 2.11.0，audio-separator 0.47.1）
- ffmpeg：`D:\singer\work\bin\ffmpeg.exe`（来自 imageio_ffmpeg，必须放进 PATH）
- 模型目录：`D:\singer\work\models`
  - `vocals_mel_band_roformer.ckpt` —— 主力，人声分离
  - `UVR_MDXNET_KARA_2.onnx` —— 旧 karaoke 基线（就是原来的 kara2.onnx 同一模型）

## 跑一次分离

推荐用封装好的 `separate.py`（会自己转 44.1k wav、跑模型、规整成 `vocals.wav`/`instrumental.wav` 并转 mp3）：

```powershell
& D:\singer\work\separate.cmd "D:\singer\source\朧月.mp3"        # 默认进 projects\cover\朧月\audio
& D:\singer\work\separate.cmd "D:\singer\source\朧月.mp3" -p 我的版本
```

底层的 `sep.py` 直接用也可以（模型名 / 输入 wav / 输出目录）：

```powershell
$env:PATH='D:\singer\work\bin;'+$env:PATH
D:\singer\work\venv\Scripts\python.exe D:\singer\work\sep.py `
  vocals_mel_band_roformer.ckpt `
  projects\cover\朧月\audio\source.wav `
  projects\cover\朧月\audio
```

## 常用模型（audio-separator 0.47.1 内置列表）| 模型文件 | 用途 |
|---|---|
| `vocals_mel_band_roformer.ckpt` | 人声/伴奏，当前首选 |
| `mel_band_roformer_kim_ft3_unwa.ckpt` | 人声，微调版 |
| `mel_band_roformer_karaoke_gabox_v2.ckpt` | 去和声/伴唱的 karaoke |
| `dereverb-echo_mel_band_roformer_sdr_13.4843_v2.ckpt` | 人声去混响/去回声 |
| `UVR_MDXNET_KARA_2.onnx` | 旧 MDX 基线 |

## 已知坑
- 沙箱下 pip 会因临时目录写入被拒，`pip install` 需要 danger-full-access 放行。
- audio-separator 的 base 依赖里没有 `onnxruntime` 和 `audioread`，是手工装进 venv 的；重装环境要补上。
- 默认 `model_file_dir` 是 `/tmp/...`，Windows 下必须显式传 `D:\singer\work\models`。
- 装完 audio-separator 会顺手把 torch 换成 CPU 版，装完要重装 `torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu128`。

## 耗时（RTX 4070 Laptop 8G）
- Mel-Band RoFormer：4 分 15 秒的歌，模型加载后约 23 秒
- MDX karaoke（onnxruntime CPU）：约 99 秒
- CREPE full 提取 4 分钟人声音高：约 20 秒

## 音高曲线 / 调性 / 变调
```cmd
D:\singer\work\pitch.cmd vocals.wav -i instrumental.wav -k auto
D:\singer\work\pitch.cmd vocals.wav -i instrumental.wav -k 2
D:\singer\work\pitch.cmd vocals.wav --shift-vocals -k -3
```
- `-k auto`：按 `--target-range`（默认 `C3:C5`）自动算变调量，让 2%~98% 的音域落进去
- `-k N`：固定变多少半音
- `--shift-vocals`：人声也一起变（默认只变伴奏，人声留给后续 RVC 自己转调）

输出：`f0.csv`（时间/频率/MIDI/平滑 MIDI/置信度）、`pitch_curve.png`（全曲 + 15 秒放大）、
`pitch_report.json`（中位音高、音域、调性、变调量）、`instrumental_shift±N.wav`。

实现：torchcrepe `full` 模型（16k，hop=160，即 10ms 一帧），置信度 <0.3 或超出 50–1100 Hz 的帧置空；
统计用 0.06 秒中值滤波后的曲线（原始值保留在 csv 里）。调性用 Krumhansl-Kessler 模板对伴奏做 chroma 相关。
变调用 ffmpeg rubberband（`pitch=` 是倍率不是半音数，代码里已换算）。

## 人声转换（Seed-VC 零样本）

RVC 在 Python 3.13 上装不了（fairseq 0.12.2 依赖 distutils/numpy<2），所以这条路走 Seed-VC：
现成模型 + 一段 10–30 秒参考人声即可转换，不需要训练。

- 源码：`work\seedvc`（Plachtaa/seed-vc，GPL-3.0）
- 独立 venv：`work\venv_vc`（torch 2.11.0+cu128 + transformers 4.57.1 + dac）
- 模型权重：`work\seedvc\checkpoints`（DiT base-f0-44k 783 MB、rmvpe.pt、campplus、bigvgan）

```powershell
$env:HF_HOME='D:\singer\work\seedvc\checkpoints\hf_home'
$env:HF_HUB_CACHE='D:\singer\work\seedvc\checkpoints\hf_cache'
D:\singer\work\venv_vc\Scripts\python.exe D:\singer\work\seedvc\run_svc.py `
  --source <源人声.wav> --target <参考.wav> --output projects\cover\朧月\work `
  --diffusion-steps 30 --f0-condition True --fp16 True
```

`--f0-condition True` 是唱歌必需（跟随源音高），`--semi-tone-shift` 调音高，`--auto-f0-adjust` 慎用。

踩过的坑（本地已修）：
- `run_svc.py`：屏蔽 hf_hub 的 symlink 探测（沙箱会在新建临时目录里建文件失败）。
- 必须把 `HF_HOME`/`HF_HUB_CACHE` 指到工作区，否则去写 `C:\Users\...\.cache`。
- torchaudio 2.11 的 `save` 要 torchcodec，`inference.py` 里已改成用 soundfile 写。
- 缺 `dac`（descript-audio-codec）会报 `No module named 'dac'`。
- resemblyzer 的 `webrtcvad` 在 3.13 上编译不过，且 SVC v1 不需要它。

成品合成：`mix.cmd vocals.wav instrumental.wav`（默认写 `projects\<项目>\work\cover.wav`，自动限峰 + loudnorm 到 -14 LUFS 出 mp3）。

## 换音色

核心只有一件事：**给一段 10–30 秒、干净的单人人声当参考**，源人声不变，只换音色。

```cmd
:: 1) 从任意音频剪一段参考（单声道 44.1k，响度统一 -18 LUFS）
makeref.cmd "projects\cover\朧月\audio\vocals.wav" 100 20 -o "source\my_voice.wav"

:: 2) 换成这个音色（默认写 projects\cover\朧月\work）
voice.cmd "projects\cover\朧月\audio\vocals.wav" "source\my_voice.wav" -s 30
```

- `voice.cmd` 默认离线（`HF_HUB_OFFLINE=1`），只有第一次下载模型才加 `--online`
- `-s` 扩散步数：30 够用，50 更细但更慢
- `-p` 半音偏移：参考音域和源差太多时用，例如男声唱女调 `-p -12`
- 产物名：`vc_<源>_<参考>_<length>_<steps>_<cfg>.wav`

界面上是同一条链路：翻唱工作台 → 第 4 步「换音色」→ 参考人声填路径 → 运行。
Agent 用 `cover_workbench`，`action=voice`，参数 `vocals` / `ref` / `steps`。

参考素材的三条要求：
1. 单一人声、无伴奏（有 BGM 会让模型把伴奏也学进去）
2. 尽量干声、少混响（混响重的话先跑 `dereverb-echo_mel_band_roformer` 再截）
3. 10–30 秒，覆盖音域宽一点更好（别只截一句平铺直叙的）


## 插件：翻唱工作台（@local/dsh-singer-workbench）

上面四步已经做成 Harness 插件，左侧栏「翻唱工作台」（人格学习下面）打开就是可视化流水线。

- 源码：`D:\singer\plugins\dsh-singer-workbench`（linked 安装，改完文件刷新页面即生效；改客户端代码后没生效就重启 Harness）
- Host：`/api/dsh-singer/state|run|job|cancel|media`，任务用子进程跑上面的 python 脚本，日志与状态留在内存里，最多保留 20 条任务
- Agent 工具：`cover_workbench`，`action=status|scan|separate|pitch|voice|mix|job|cancel`
- 界面能力：选歌、四步按钮、任务日志与取消、产物试听、音高曲线图
- 任务历史：落在 `state\history.json`，启动/结束时各写一次，重启后 `running` 会变成 `interrupted`，最多 200 条
- 离线：模型全在本地，四步断网实测可用；换音色默认 `HF_HUB_OFFLINE=1`，只有首次下载模型或换新模型时才需要联网
- 安全：`/media` 与所有路径参数都要求落在 `D:\singer` 内

重新安装（改了 package.json 或新增文件后）：

```powershell
# 在 Harness 里让 Agent 执行
plugin_manager action=install_bundle target=D:\singer\plugins\dsh-singer-workbench
```


