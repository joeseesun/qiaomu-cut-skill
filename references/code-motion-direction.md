# 代码动态图形导演法（motion-design）

来源：2026-09-22 至 25 日公开的 54 个 Opus 5.5 代码生成视频案例与作者公开的提示词（汇总见 `reports/prior-art-research.md`）。这里只保留能跨题材复用的机制，不收录单个作品的具体画面。

## 0. 先认清媒介

模型不直接输出视频，而是**写代码画出每一帧**（HTML/Canvas、SVG、p5.js、Three.js、Manim、Python 线稿），无头浏览器逐帧截图，再用 ffmpeg 合成。

- 擅长：动态图形、UI 动效、动态排版、线稿/水彩/像素手绘、科普机制、数据图、产品片、歌词 MV、程序化 3D。
- 不擅长：写实真人和实景。需要时走 `hybrid`：视频模型（ListenHub/Seedance/Runway）出底片，代码负责编排、重绘、字幕和剪辑。
- 质量上限主要取决于导演信息（结构、参考、禁用项），其次才是模型强度；一句话能出片，但结构化 brief 更稳。

## 1. 导演信写法：inputs → direction → structure → build → gotchas → start

`qcut motion init` 生成的 `motion-brief.json` 就是这六段结构的机器可读版本。

| 段落 | 回答什么 | 写法要点 |
| --- | --- | --- |
| inputs | 开工前必须向用户要什么 | 真实素材优先（产品截图/自有视频片段/品牌色/授权音乐）；缺了就问，不要用占位卡片冒充 |
| direction | 看起来像什么 | 一句话定调 + 参考图/视频 + 调色板 + 一种字体 + 镜头语言 + **Banned 列表** |
| structure | 每一拍发生什么 | 按节拍网格写：BPM、小节数、每小节一个动作；“每一拍都有事情发生” |
| build | 用什么工程保证可复现 | seek(t) 纯函数、弹簧闭式解、子帧动态模糊、按实测峰值放音效、渲染前抽帧 |
| gotchas | 已知坑 | 见第 5 节 |
| start | 第一步做什么 | “先问 inputs，再给出节拍网格上的分镜，确认后再写代码” |

### Direction：参考胜过形容词

- 给参考图或参考视频，比堆“高级、酷炫、电影感”有效得多。没有参考时显式写 `{kind:"none", why}`，并在 direction 里写出可检验的具体规则（留白、一种强调色、紧字距）。
- 用镜头语言而非形容词：dramatic cuts、match cut、whip pan、masked type reveal、push cut、orbiting camera、rack focus、kinetic typography。
- 一个镜头只讲一个想法；屏幕文字越少越好。

### Banned：专门压掉“AI 模板味”

每个项目至少 3 条，`qcut motion check` 硬门。常用基线：

- 通用：弹跳/弹性缓动、粒子爆炸、镜头光晕、霓虹辉光、摄像机抖动、RGB 分离、冲击波环、网格地板、闪烁背景、无事发生的死时间、像模板的一切。
- UI 片：UI 外框渐变、图标描边粗细不一致。
- 科普/历史：通用信息图观感、策略游戏视角、素材库剪贴画。
- 像素：亚像素位置、抗锯齿、渐变与 shadowBlur、调色板外颜色。

## 2. 先分镜，后代码（硬门）

几乎所有高质量案例都先交分镜。规则：

1. 分镜写在 `motion-brief.json.storyboard[]`：`start/end/idea/onScreenText/camera/transitionIn/events[]`。
2. 有音乐时先跑 `qcut audio beats`，**所有切点落在拍点上，最好在强拍（downbeat）**；UI 命中落在拍点；高潮对准 `drop`。`check` 会阻断离网切点。
3. 超过 2 小节（无音乐时 4 秒）的镜头必须写 `events[]`，否则判死时间风险。
4. `approval.mode=ask`：把节拍网格上的分镜给用户看，确认后再写 `storyboardApproved=true`；final 渲染在确认前被阻断。一句话请求用 `autopilot`，但仍必须通过 check 和 probe。
5. 有了分镜，后续修改可以只针对某一个镜头，不必重做整片。

## 3. 确定性渲染：每一帧都是 t 的纯函数

- 所有样式在 `seek(t)` 内由 t 计算；禁止 CSS transition/animation、setTimeout/setInterval、Date.now/performance.now、requestAnimationFrame 状态、Math.random、跨帧累积变量。
- 需要随机性用 `QiaoCutMotion.random(index, seed)`（无状态哈希）。
- 弹簧用闭式阶跃响应；目标值多次改变时，结果是“每次改变一个弹簧”的叠加（`springTrack`），线性系统叠加是精确解，所以仍是纯函数。
- 拖拽是直接操控：按住时值由指针位置计算，松手后从当时的位置和速度弹回（`dragRelease`）。
- 真实视频素材：ffmpeg 抽成 30fps JPEG 序列，每帧换 img.src，seek 等待 `img.decode()`（`imageSequence`，渲染器会 await seek 返回的 Promise）。
- 证明而非相信：`qcut motion probe` 用正序、倒序和冷启动页面三种方式截同一时刻，字节必须一致；静态 lint 看不到的隐藏状态会在这里暴露。

## 4. 画面质量工程

- **子帧动态模糊**：final 每帧在快门区间内居中采 3 个子帧（`motionBlurSubframes`，默认快门 0.5 帧），ffmpeg `tmix` 混合。快速甩镜、大位移形变时 3 个子帧会出现分层残影，改为 5–8（渲染时间线性增加）。草稿关闭模糊、半分辨率，速度快数倍。
- **缓动**：overshoot 只来自弹簧（阻尼 0.8–0.9，最多一点点过冲）；补间用 outCubic/outExpo/inOutCubic；不要 bounce/elastic。
- **内容切换**：形变容器里的文字换内容时，用短模糊交叉（`swap`，约 180 ms），并且有独立的进出时间，否则会重叠。
- **匹配剪辑**：运行时测量元素位置（`getBoundingClientRect`/`offsetWidth`），让下一镜头从同一位置接住。
- **循环片**：最后一帧必须等于第一帧，包括光标位置和速度；probe 用 PSNR 检查接缝。
- **渲染前抽查**：`probe` 在每个切点、镜头中点和 events 处截图生成 contact sheet；逐张看拥挤、重叠、离网、难读，修完再整片渲染。

## 5. Gotchas（跨案例反复出现）

- `will-change` 不要放在会被摄像机缩放的元素上，否则文字发糊。
- `preserve-3d` 元素上不要设 opacity 或 filter，会被压平导致两面都显示；淡入淡出放在外层 wrapper。
- 形变容器内文字切换需要自己的进出时序。
- 高 DPI 与缩放：草稿用 `--scale 0.5`，不要改 viewport（会改变布局）。
- 字体：只用本地已安装或项目内文件；捕获时网络被阻断，远程字体会静默回退。

## 6. 声音

- 音乐：`qcut audio beats` 得到 BPM、强拍、每小节能量和 drop；把 `audio.music.inPoint` 设到让视频 t=0 落在强拍上。
- 音效：放置时让**实测峰值**而不是文件起点落在事件帧（motion 的 `audio.sfx[]` 默认 `alignPeak`，timeline 的 `soundEffects[].alignPeak:true`）。音效要安静地压在音乐下面（默认 gain 0.5）。
- 母带：先混音、测积分响度、增益到目标（默认 −14 LUFS）、真峰值限制器，迭代到 ±0.7 LU 内。
- 只用许可允许目标用途（尤其商用）的音乐和音效；`audio.music.license` 为空会警告。
- 科普旁白仍走 explainer 管线与 ListenHub“向阳乔木 v1.1”，motion 成片可作为 timeline 的一个 shot 进入。

## 7. 技术路线选择

| 需求 | 首选 | 说明 |
| --- | --- | --- |
| UI 动效、产品卡点片、动态排版、Showreel | 单 HTML + DOM/SVG + motion kit | `qcut motion` 全流程 |
| 线稿/水彩/手绘 | Canvas 2D 或 p5.js（+ 笔刷库，需本地文件） | 笔画按 t 逐步显现；随机笔触用 seed |
| 像素动画 | Canvas 2D 低逻辑分辨率 + 整数倍放大 | 所有坐标取整，固定调色板 |
| 程序化 3D、历史场景 | Three.js（本地文件引入） | 相机、粒子、水体都从 t 推导；禁止物理引擎内部累积状态，除非预烘焙 |
| 数学/公式 | Manim | `scene render --engine manim` |
| 口播改线稿讲解 | talking-head 原片 + 线稿 B-roll + 圆形画中画 | 保留原声/字幕/时长；按字幕切镜头，说到哪个概念画哪个概念 |
| 需要真人/实景 | hybrid：视频模型底片 + 代码重绘/排版 | 生成动作走付费门；底片抽 JPEG 序列后按 t 重绘（转描/rotoscope 风格） |
| 可在 AE/Blender 继续编辑 | 外部专业软件 | 超出本 skill 内置范围，只做编排与交付说明 |

## 8. 成本与迭代预期

- 一句话短片：几分钟、几美元；几分钟的 MV/历史片：一次会话可能上百美元或数个百分点周额度。
- 所谓“一次成型”多数跑了两轮以上；模板和分镜往往在第一轮后才补齐。按“草稿 → probe → 单镜头修改 → final”预算。
- 一次只提一条修改意见（慢一点、更有活力、加一个价格镜头），改分镜对应镜头，再 probe。
