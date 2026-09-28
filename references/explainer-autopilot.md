# 科普视频 Autopilot

## 触发

当用户只说“制作一个科普视频：介绍 LLM 中的 RL / Token / 蒸馏 / 强化学习”等一句话需求时，直接进入 `explainer-social`，不要把任务退回成一份计划或追问一串规格。

默认值：9:16、1080×1920、24 fps、60–90 秒、向阳乔木 v1.1、HTML/SVG/Manim 概念动画、强字幕、轻量 SFX、品牌片尾。

## 高速执行顺序

1. 运行一次 `qcut doctor --json`；环境已在本轮验证且未变化时不要重复。
2. 运行 `qcut explainer init <project> --topic "主题" --json`。它创建 IR、`production-spec.json`、参数化组件运行时和审核契约，已有作者文件不覆盖。
   `init` 不是成功终点。Agent 必须把 research、claims、分段旁白、scene、字幕和视觉所有者统一写进 production spec，不能让多个文件分别生成后互相漂移。
3. 同时完成只读工作：查一手来源、确认术语含义、精确查找“向阳乔木 v1.1”。缩写在上下文足够时按行业常义展开；例如“LLM 中的 RL”解释为 reinforcement learning，并说明它与 RLHF/RLAIF 的关系，不把三者混为一谈。
4. 一次完成 production spec：旁白覆盖 hook、最小定义、可视机制、现代用法、收益、代价/误区和收束；新项目使用 `contractVersion=5`。先为每幕写 `visualQuestion`，再从真实信息关系选择 `visualForm` 与 `visualRelation {kind,evidenceType,encoding,unit,sourceUrl|claimIndex}`；最后才选择 component。每个 scene 还要指定 `cognitiveTask`、映射到组件真实焦点 ID 的 `primaryFocus`、`visibleChange {kind,from,to}`、`visualMechanism {kind,input,process,output}`、`visualOwner`、`onScreenText`、`captionText` 和 duration 预算。画面必须能在首/中/尾帧读出输入→因果过程→结果；mechanism 必须使用 `state|process` 且 from/to 可见不同。非片尾至少 4 种不同视觉组件、至少 4 个机制/证据型组件、至少 3 种不同语义关系，通用卡片/列表最多 1 个。真实人物、地点、机构、品牌和历史题材必须在 spec 中声明 `visualEvidence.topicKind=real-world|mixed`，提供至少 2 条具体检索词与 3 张已下载、可溯源、权利状态明确的图片；照片 scene 绑定 assetId、来源、署名和许可，并根据构图选择 `photoMotion`。多图项目至少使用两种运动语法：横向建筑可左右揭幕，竖向空间可上下浏览，历史档案可 rack-focus，信息密集照片可 hold。图片元素和外层焦点容器都禁止 scale/push-in，不得用通用 spotlight pulse 间接放大图片。事实与计算图表必须有来源、单位和编码说明，禁止虚构百分比、评分和伪仪表盘。不要引用单篇论文指标作为普遍保证。
   **片尾口播硬规则**：`purpose=outro` 的旁白不得只收认知结论。必须在同一段口播里说出品牌关注引导，至少包含 `向阳乔木`，并同时包含 `关注` 或 `@vista8`/`vista8`。推荐句式：`……结论句。关注向阳乔木，继续拆解大模型关键词。` 画面同期必须有品牌 CTA 卡（向阳乔木 + 关注/@vista8），可用 snap-flash-pop 或独立 `s08_brand` 定帧；禁止只把品牌塞进右下角小字、或只有画面没有口播。spec gate 会以 `outro-spoken-brand-cta` / `outro-visual-brand-cta` 硬阻断。
5. 运行 `qcut explainer check <project> --stage spec --json`。该门只处理 JSON/文本并缓存输入哈希；任何 claims、时长、视觉所有者或字幕复读问题都必须在付费 TTS、生图和动画前解决。
   如果用户明确只要“付费生成前的准备/规格”，这里就是停止点：交付 spec gate、来源、warnings 和下一步，不启动 TTS，也不把未物化项目描述为成片。
6. Spec 锁定后并行执行两条 lane：A）一次 ListenHub MP3 请求；B）`qcut explainer materialize <project> --json`，并继续创作 SVG/HTML/可选图片资产。不要阻塞等待 TTS。失败后不得自动发起第二个付费请求。默认必须使用“向阳乔木 v1.1”；缺少积分授权时停在付费门，禁止静默降级为 macOS `say`、Tingting 或任意其他本地音色。
7. TTS 返回后运行 `qcut explainer timing <project> --audio <project-relative-audio> --apply --json`。命令写入音频 SHA-256、实测时长和 phrase bindings；只有全部边界命中静音证据才标记 `phrase`，否则显式降级为 `duration`。**随后运行 `qcut explainer beats <project> --apply --json`**：它按场景内静音分句点生成 `beats` 写回 spec，让激活/变形/脉冲落在旁白分句处而非时长比例猜测。**同时把 TTS 返回的 `timelineNarration`（engine=file）写入 timeline.json**——preview 的 `narration-wired` 硬门会拦截 engine 仍为 none 的项目。重新 materialize 受影响的字幕和时长后，再把 ListenHub 返回的 provenance-rich `timelineNarration` 写入 timeline。原理场景优先从机制型组件选型：`prediction-field` 展示候选概率竞争与获胜 token，`segmentation-flow` 展示连续输入被切分并编码，`optimization-loop` 展示前向预测→损失→梯度逆流→参数更新，`filter-conveyor` 展示语料去重/过滤/配比，`balance-system` 展示多变量共同收敛，`state-morph` 展示前后状态跃迁，`risk-dashboard` 展示多项代价同时抬升；`definition/comparison/pipeline/benefit-risk` 等通用卡片全片最多 1 个，Manim 只承担必须精确计算的机制。需要更定制的过程动画时使用手写 HTML + `window.__QIAOCUT_SET_TIME__`。spec 场景可选 `beats: [{at: 秒, action: 'activate'|'swap'|'pulse', target?: 步骤序号}]` 把动作节拍对齐旁白重音；缺省自动均铺。需要位图插画时调 ListenHub 生图（走 OAuth；`listenhub auth status` 未登录是 blocker，要明说，不得静默放弃）。
8. 运行 `qcut explainer check <project> --stage author --json`。按结构化 `repairPlan` 只修命中的 scene/caption；`preserves` 中的 TTS、其它场景和付费资产不得重新生成。
9. 运行 `qcut explainer preview <project> --json`。HTML/SVG 场景在一个批次中顺序捕获，只启动一次无界面浏览器；先检查项目内容哈希，再检查跨项目共享缓存，只有 miss 才渲染。帧通过 `image2pipe` 进入 ffmpeg。
10. preview 自动写 `reports/scene-review.json` 和每场景首/中/尾三帧；对声明 `state|process` 的场景自动做首尾帧差检测（YAVG < 2.0 时直接把 `visibleChangeVerified` 判为 false 并给 warning）。逐项检查唯一主焦点、末帧是否传达 `cognitiveTask`、`visibleChange` 是否真实发生、字幕是否争抢；当前是 soft gate，未审项目以 warning 报告。然后查看完整预览和至少 1 张手机尺寸单帧，确认第一条有效信息、声画、字幕、片尾。**片尾抽帧必须同时核对：能听到/看到关注向阳乔木的口播句，画面有品牌 CTA，不能只剩知识收束。** 只有完成这些证据后，才把总 review 的 `content/composition` 标为 true。
11. 运行 `qcut explainer final <project> --json`。输入指纹和 profile 未变化时复用上次已通过的 render report/validation；否则只重做失效节点。final 门含**成片抽听**：声明 file 旁白但成片中段 RMS < −40 dB 会报错。**交付前必须亲自带声音看/听一遍成片**（或至少抽听三段：开头、中段、片尾口播 CTA），自动检查不能代替人的最终确认。只有 review、final/full、字体验证和 `releaseReady=true` 都通过才交付。

## 失败预防

- HTML/SVG 始终顺序捕获，但一个 batch 复用同一无界面浏览器；不要并发启动多个浏览器进程。
- 使用 `image2pipe`，不要把逐帧 PNG 全量落盘。
- 场景输出按源码、声明 dependency 和渲染参数的 SHA-256 判断；相同片头、片尾或基础动画可跨项目恢复。不要只依赖 mtime。
- 校验失败时读取 `repairPlan[].invalidates`，只重做列出的节点；`preserves` 中的远端任务、TTS、其它 scene 和已通过报告必须保留。
- `cognitiveTask/primaryFocus/visibleChange/visualMechanism` 不是文档装饰：参数化组件会把 `primaryFocus` 渲染成真实聚光，并按 scene progress 执行 state/process；机制型组件还会消费各自的概率竞争、切分、梯度、筛选、平衡、跃迁或风险运动语义。手写 HTML/Manim 也必须让首/中/尾证据与声明的输入→过程→输出一致。
- 不得把时长预算、静音估算或全文 ASR 写成 word-level。没有逐词证据时 `timingLevel` 只能是 `duration` 或有完整静音边界证据的 `phrase`。
- 明确字幕坐标以 1080×1920 为作者坐标；preview/standard 自动按 profile 缩放。
- 为每条信息指定一个视觉所有者：图内已经完整呈现一句结论时，不再烧录同一句字幕；字幕完整呈现时，组件改成图形、关系、数字或更短的关键词。不要像“答案叫：知识蒸馏”那样让画面和字幕同期逐字重复。
- author gate 对四个以上汉字的短句、跨 HTML 标签文案和脚本动态注入文案执行时间感知匹配；只拦截与 caption 时间重叠的 scene，避免跨镜头误报。preview 再人工检查换词但语义仍重复的情况。
- AI 生图只用于真实物体、人物、环境或抽象动画无法准确表达的视觉缺口；机制图优先使用矢量和 Manim。
- 旁白音色必须通过时间线来源硬门：`provider=listenhub`、`speakerName` 精确等于 `explainer-plan.json` 声明的音色，且包含 `assetId` / `speakerId` / `narrationTextSha256`。不符合时在 author stage 失败，不进入 preview。
- 黑帧检测命中后必须抽帧。深色背景不是免责理由；场景标签应立即出现，核心标题最迟 0.7 秒出现。
- 每个项目默认生成 `s00_cover` 封面镜头（1–1.5 秒）并置于 timeline 首位：t=0 必须是完整构图的成品封面（悬念问句大标题 + 核心视觉符号 + 品牌与账号），动效只做点缀（光圈、脉冲），禁止从空屏淡入；封面期间不烧字幕，旁白用 `narration.start` 后移，caption events 同步偏移。`explainer materialize` 会从 `spec.cover`（enabled/duration/eyebrow/title/highlight/teaser/brand/handle/cta）确定性生成 `scenes/s00_cover.html`、前置 scene-plan/timeline、偏移字幕与 narration.start；`spec.cover.enabled=false` 可显式关闭。author/scenes 门强制 s00_cover 在首位，final 自动把第 0 帧导出为 `cover.png` 供平台上传，final 门要求 cover.png 存在。preview 必须单独审看第 0 帧是否具备点击欲。

## 命令

```bash
qcut explainer init ./LLM-RL --topic "LLM 中的 RL" --json
qcut explainer check ./LLM-RL --stage spec --json
qcut explainer materialize ./LLM-RL --json
qcut explainer timing ./LLM-RL --audio assets/generated/narration.mp3 --apply --json
qcut explainer materialize ./LLM-RL --json
qcut explainer check ./LLM-RL --stage author --json
qcut explainer preview ./LLM-RL --json
qcut explainer final ./LLM-RL --json
```

上例中的 `qcut` 是 package bin 简写。未安装 bin 时使用 `node <skill-root>/scripts/qcut.js`，不要假定当前 shell 已经存在全局 `qcut`。
