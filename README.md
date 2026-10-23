# singer —— 本地翻唱工作台

在 Windows 上用一套脚本 + 一个 Harness 插件，把「一首歌 → 成品翻唱」的流程固定下来：
分离人声 → 音高与调性分析 → 换音色（零样本）→ 合成。

## 目录

```
work\                脚本与环境（venv/模型/缓存不进仓库）
  separate.py        分离（audio-separator + Mel-Band RoFormer）
  pitch.py           音高曲线、调性、变调（CREPE + rubberband）
  tune.py            修音准（WORLD 声码器，只改 f0）
  voice.py           Seed-VC 零样本换音色（可跨项目借参考音色）
  mix.py             合成（限峰 + loudnorm）
  projectlib.py      唯一的路径/常量来源（ROOT、FFMPEG、VENV、SEEDVC…）
  gen_preview.py     通用 MIDI 试听渲染器（FluidSynth 不可用时兜底）
  bench\             一次性实验脚本（A/B 对比、频谱对照）
  migrations\        一次性迁移脚本（平铺 → projects\，拆 cover\/gen\）
  LAYOUT.md          工具该放哪、哪些重复是保留的
  SEPARATION.md      环境搭建、踩坑、命令速查
plugins\
  dsh-singer-workbench\   Harness 插件（Host 路由 + 客户端面板）
projects\cover\<项目>\  翻唱：audio / analysis / work / baselines
  audio\             source.wav · vocals.wav · instrumental.wav
  analysis\          f0.csv · pitch_curve.png · pitch_report.json · instrumental_shift±N.wav
  work\              ref.wav · tuned_vocals.wav · vc_*.wav · cover.wav/mp3
projects\gen\<项目>\    生成：song-sheet.md · midi\ · renders\ · tools\build_midi.py · products.json
```

## 环境

- Python 3.13（`work\venv`：torch 2.11.0+cu128、audio-separator、torchcrepe、pyworld）
- `work\venv_vc`：Seed-VC 独立环境（transformers + dac）
- ffmpeg 放在 `work\bin\ffmpeg.exe`，脚本会自己加进 PATH

详细安装步骤与坑见 [work/SEPARATION.md](work/SEPARATION.md)。

## 常用命令

```cmd
work\separate.cmd "source\朧月.mp3"                 :: 分离 → projects\cover\朧月\audio
work\pitch.cmd projects\cover\朧月\audio\vocals.wav -i projects\cover\朧月\audio\instrumental.wav -k auto
work\tune.cmd projects\cover\朧月\audio\vocals.wav -s 0.6 -m scale -k "G# major"
work\voice.cmd projects\cover\朧月\audio\vocals.wav projects\cover\朧月\work\ref.wav -s 30
work\mix.cmd projects\cover\朧月\work\vc_*.wav projects\cover\朧月\audio\instrumental.wav
```

## 插件

`plugins\dsh-singer-workbench` 是 Harness 插件：左侧栏「翻唱工作台」，把上面四步做成可视化流程
（选歌、分离、音高、换音色、合成），产物按项目折叠展示，任务历史落 `state\history.json`。

安装：`plugin_manager install_bundle target=plugins\dsh-singer-workbench`。

## 使用限制

本仓库面向**本机个人使用**。使用前请确认以下几点：

1. **仅供个人学习与研究**：只处理你自己拥有权利、或已取得授权的音频。
2. **不得用于冒充他人**：把作品伪装成某位真人歌手演唱，或用于诈骗、伪造证据，可能承担民事甚至刑事责任。
3. **公开发布前先解决授权**：翻唱涉及词曲著作权（复制、表演、改编）；用原曲分离出的伴奏还涉及原录音的邻接权。平台「翻唱政策」不等于版权授权。
4. **真人音色需单独授权**：声音受《民法典》第 1023 条参照肖像权保护；未取得本人许可就克隆其声音并发布，民事侵权风险明确。
5. **虚拟歌手受角色许可约束**：例如初音未来，商用与再分发按 Crypton 的 Piapro Character License 执行。
6. **不要用本工具绕过版权保护措施**（去水印、破解加密等）。
7. 本仓库**不包含**模型权重与 ffmpeg，使用者自行获取时需遵守它们各自的许可。

## 第三方组件与许可

本仓库只包含自写代码，以下组件均由使用者在本机安装或获取：

| 组件 | 版本 | 许可 | 用途 / 说明 |
|---|---|---|---|
| audio-separator | 0.47.1 | MIT | 分离推理框架 |
| torch / torchaudio / torchvision | 2.11.0+cu128 | BSD-3-Clause | 推理后端 |
| torchcrepe | 0.0.24 | MIT | 音高提取 |
| librosa | 1.0.0 | ISC | 音频分析 |
| soundfile | 0.14.0 | BSD-3-Clause | 音频读写 |
| pyworld | 0.3.5 | MIT | 修音准（WORLD 声码器） |
| Seed-VC（Plachtaa/seed-vc） | — | GPL-3.0 | 换音色。本仓库仅以**子进程**调用，未包含其代码；若打包分发 Seed-VC 本身，需遵守 GPL-3.0 |
| ffmpeg（gyan.dev essentials 7.1） | 7.1 | GPLv3（`--enable-gpl --enable-version3`） | 本机工具，未纳入仓库；打包分发需承担 GPL 义务 |
| Mel-Band RoFormer 权重 | — | 未明确 | 来自 UVR 社区模型库，多数模型标注仅限个人使用，商用前须核实 |

## 说明

- 模型、虚拟环境、音频素材都不在仓库里
- 四步都已验证断网可用（模型在本地时）
- 换音色是零样本变声（Seed-VC），不是 TTS；参考音频建议 10–30 秒干声
- 本文档不构成法律意见；涉及公开发布或商业使用，请自行咨询专业人士

