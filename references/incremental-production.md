# 科普视频增量生产契约

## 核心原则

把昂贵生成放在统一规格和便宜预检之后。修改一个节点时，只失效真实依赖它的产物；不把校验失败解释成“整条重新生成”。

## 生产图

```text
brief + primary sources
→ production-spec.json
→ cached spec gate
→ ┬ ListenHub narration
  ├ parameterized HTML/SVG materialization
  └ optional image assets
→ qiaocut.narration-timing.v1 (audio SHA + measured duration + evidenced phrase/duration level)
→ author gate + repairPlan
→ content-addressed scene cache / one-browser batch
→ per-scene start/end cognitive review + full preview review
→ cached final/full validation
```

Spec 锁定后，TTS 与本地组件/资产创作必须并行。这里只并行互不依赖的生成；Chrome 逐帧捕获仍在一个浏览器内顺序执行。

## Production spec

`production-spec.json` 是 claims、旁白段落、scene component、画面文案、字幕和时长的唯一作者源。`qcut explainer materialize` 确定性派生 narration、research、storyboard、captions、scene plan、timeline 和组件 HTML。派生文件不再分别交给模型自由创作。

`output.targetDuration` 表示用户要求的总成片时长，`output.duration` 表示不含默认封面的正文/旁白预算；scene 总和 + cover 必须等于 targetDuration。这样 `--duration 30` 的默认成片仍是 30 秒，而不是额外叠加 1.5 秒封面。

新项目通过 `contractVersion=3` 对每个 scene 强制四项解释契约：`cognitiveTask`、可映射到真实组件节点的 `primaryFocus`、`visibleChange {kind,from,to}`、`visualMechanism {kind,input,process,output}`。`mechanism` 不允许 `kind=none`；首/中/尾帧必须能读出输入→因果过程→结果。旧 spec 保持可用，但 gate 输出升级 warning。

只有 `contentLocked=true` 且 `qcut explainer check --stage spec` 通过后，才能提交 TTS、生图或视频生成任务。相同 spec hash 的检查直接读取 `.qiaocut/gates/`。

## 精确失效

- claim/source 变化：失效 production spec 和受影响文案；事实结论未变时不失效媒体。
- 单段旁白变化：只失效对应 TTS segment、caption timing 和关联 scene duration。
- narration audio SHA 或实测时长变化：失效 `narration-timing.json`、字幕时码、关联 scene duration、SFX/关键词重音；不失效视觉内容与已付费图片/视频。
- scene 文案或布局变化：只失效该 scene source/render。
- caption 变化：只失效 caption ASS/picture master；不失效 TTS 或无关 scene。
- 音乐/SFX 变化：只失效 audio mix/normalization/mux。
- 输入指纹未变：复用 preview/final report 和已通过 validation。

校验器必须返回 `repairPlan`，每项包含 `invalidates` 与 `preserves`。执行修复前先确认不会重新提交任何 `preserves` 中的付费或远端资产。

## 共享场景缓存

默认共享目录为 `~/.cache/qiaomu-cut/scenes-v1`。缓存键包含 scene 源码、声明依赖内容、引擎、尺寸、帧率、时长、scene class 和缓存版本。相同内容可以跨项目复用片头、片尾和基础动画；路径相同、mtime 相同或文件名相同都不构成命中依据。

使用 `QIAOMU_CUT_SHARED_CACHE=/path` 改目录；设为 `off` 禁用。共享缓存恢复时复制到项目，项目仍保持自包含。

## 参数化组件

机制型组件：`prediction-field`、`segmentation-flow`、`optimization-loop`、`filter-conveyor`、`balance-system`、`state-morph`、`risk-dashboard`；通用组件：`definition`、`teacher-student-transfer`、`reward-loop`、`comparison`、`pipeline`、`benefit-risk`、`outro`。新项目非片尾至少使用 4 种不同视觉组件、至少 4 个机制型组件，通用卡片/列表最多 1 个。只有组件无法表达的精确数学或自定义视觉才编写 Manim/HTML。

所有组件继续遵守：无左侧彩色竖线、一个信息一个视觉所有者、字幕安全区、0.7 秒内出现有效信息。

参数化组件运行时必须消费解释契约：标记 `primaryFocus` 对应 DOM 节点，让 `state|process` 场景在时间线上产生可见变化，并用组件自身的运动语义实现 `visualMechanism`。preview 为每个 scene 输出首/中/尾帧到 `reports/scene-review/`，人工/Agent 软审查新增 `explanationVisible`；重复 preview 仅在 scene 内容或契约变化时清空已有判断。
