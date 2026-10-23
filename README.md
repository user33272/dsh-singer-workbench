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
  projectlib.py      项目目录规则
  migrate_projects.py 旧平铺产物迁移到 projects\ 的一次性脚本
  SEPARATION.md      环境搭建、踩坑、命令速查
plugins\
  dsh-singer-workbench\   Harness 插件（Host 路由 + 客户端面板）
projects\<项目>\      产物：audio / analysis / work / baselines
  audio\             source.wav · vocals.wav · instrumental.wav
  analysis\          f0.csv · pitch_curve.png · pitch_report.json · instrumental_shift±N.wav
  work\              ref.wav · tuned_vocals.wav · vc_*.wav · cover.wav/mp3
```

## 环境

- Python 3.13（`work\venv`：torch 2.11.0+cu128、audio-separator、torchcrepe、pyworld）
- `work\venv_vc`：Seed-VC 独立环境（transformers + dac）
- ffmpeg 放在 `work\bin\ffmpeg.exe`，脚本会自己加进 PATH

详细安装步骤与坑见 [work/SEPARATION.md](work/SEPARATION.md)。

## 常用命令

```cmd
work\separate.cmd "source\朧月.mp3"                 :: 分离 → projects\朧月\audio
work\pitch.cmd projects\朧月\audio\vocals.wav -i projects\朧月\audio\instrumental.wav -k auto
work\tune.cmd projects\朧月\audio\vocals.wav -s 0.6 -m scale -k "G# major"
work\voice.cmd projects\朧月\audio\vocals.wav projects\朧月\work\ref.wav -s 30
work\mix.cmd projects\朧月\work\vc_*.wav projects\朧月\audio\instrumental.wav
```

## 插件

`plugins\dsh-singer-workbench` 是 Harness 插件：左侧栏「翻唱工作台」，把上面四步做成可视化流程
（选歌、分离、音高、换音色、合成），产物按项目折叠展示，任务历史落 `state\history.json`。

安装：`plugin_manager install_bundle target=plugins\dsh-singer-workbench`。

## 说明

- 模型、虚拟环境、音频素材都不在仓库里
- 四步都已验证断网可用（模型在本地时）
- 换音色是零样本变声（Seed-VC），不是 TTS；参考音频建议 10–30 秒干声
