# Feedback Evolution

目标：把用户明确反馈转成可追溯、可执行、可验证的 Skill 改进，同时避免一次性要求污染所有项目。

## 处理流程

1. 保存用户原话、日期、项目和可见证据。
2. 先修当前项目并用 preview、抽帧或报告确认结果。
3. 将反馈分类为 `project`、`workflow` 或 `global`。
4. 搜索现有规则，判断是新增、强化、替换还是冲突。
5. 能编码时修改参数、模板或测试；否则更新规则和验收清单。
6. 运行 Skill 校验、相关 smoke test 和真实任务回归。
7. 记录旧值、新值、证据及状态；冲突规则标记 `superseded`，不要删除历史语义。

## 偏好记录格式

```yaml
- id: stable-kebab-id
  date: YYYY-MM-DD
  userWords: 用户原话
  scope: project | workflow | global
  abstraction: 可复用偏好
  implementation: 参数、模板、脚本或验收项
  before: 旧行为
  after: 新行为
  evidence: 预览、抽帧、测试或报告路径
  status: active | superseded | project-only
```

## 当前偏好

```yaml
- id: english-mix-mobile-subtitles-readable
  date: 2026-07-19
  userWords: 屏幕顶部的字体太小了，下面的中文字体也小
  scope: workflow
  abstraction: 竖屏英语学习视频的顶部注释、来源和中文译文必须在手机尺寸直接可读，不能按桌面画布或 contact sheet 缩略图误判。
  implementation: 1080×1920 默认 English 76、Chinese 58 bold、Note 50 bold、Source 40；preview 后查看手机尺寸单帧。
  before: Chinese 46、Note 34、Source 25
  after: Chinese 58、Note 50、Source 40
  evidence: project-relative reports/subtitle-size-check.jpg plus typography smoke test
  status: active
- id: social-video-safe-zone-compliance
  date: 2026-07-19
  userWords: 搜索研究 TikTok 和抖音的安全区概念，我们的字幕显示位置和大小要遵循
  scope: workflow
  abstraction: 面向 TikTok/抖音的竖屏字幕必须避开顶部状态区、右侧操作栏和底部文案/CTA 区；安全区随设备、文案和组件变化时使用更保守交集并做平台预览。
  implementation: 1080×1920 共享安全矩形 x=120–900、y=240–1260；默认四层字幕基线 y=280/360/1120/1230；smoke test 锁定字号、边距与基线。
  before: 只验证字体可读性，没有平台 UI 几何约束；顶部 y=92/168，底部字幕基线约 y=1365/1482。
  after: 字幕全部进入共享安全矩形，并要求手机尺寸与平台 UI 预览。
  evidence: TikTok official In-Feed Standard LTR template plus Douyin/Jianying subtitle safe-area preview guidance
  status: active
- id: english-mix-larger-safe-type
  date: 2026-07-19
  userWords: 按这些规则重新生成视频，还有字号也要变大
  scope: workflow
  abstraction: 在不突破 TikTok/抖音共享安全区的前提下，英语学习视频优先使用更大的四层字幕，手机尺寸下应无需费力辨认。
  implementation: 1080×1920 默认 English 84、Chinese 66 bold、Note 56 bold、Source 46；保留 x=120–900、y=240–1260 安全矩形，并用 8 帧安全框 contact sheet 验证长短句。
  before: English 76、Chinese 58、Note 50、Source 40
  after: English 84、Chinese 66、Note 56、Source 46
  evidence: project-relative reports/safe-zone-large-text-contact.jpg plus typography smoke test
  status: active
- id: captions-outside-footage-no-source-label
  date: 2026-07-19
  userWords: 安全区只是参考，现在字幕都压在视频上了不好，顶部标题和下面的字幕都靠近视频区域，不要显示电影片段来源名
  scope: workflow
  abstraction: 安全区是平台 UI 风险参考；影视英语混剪应优先保持电影画面纯净，把标题和字幕放在画面上下相邻留白中，并默认隐藏片名来源。
  implementation: Note y≈560、English y≈1420、Chinese y≈1560；source 只进入 manifest/license report，字幕 JSON 仅在 showSource=true 时烧录。
  before: 为满足保守安全矩形，英文和中文压在电影画面内，来源名常驻显示。
  after: 三层文字与电影画面分离，来源默认隐藏，同时保留平台 UI 风险预览。
  evidence: project-relative reports/text-outside-footage-contact.jpg plus typography smoke test
  status: active
- id: branded-outro-template-diversity-complete-sentence-type
  date: 2026-07-19
  userWords: |
    1. 为什么都没有片尾，片尾也要加上类似片头的品牌，引导用户关注
    2. 开通和片尾的版式和动效太单一了，应该更加丰富，20个模版样式让用户选择，不选的时候用你觉得最合适的
    3. 视频截取的片段，经常没有实现完整的一句话就卡断了
    4. 顶部的标题字还是太小了
    5. 中文字体不够丰富好看
    优化skill
  scope: global
  abstraction: 品牌短视频必须有片尾关注 CTA，片头片尾需有可选择的多样模板；影视裁切必须保留完整句；移动端标题和中文排版应更醒目且有语义化字体主题。
  implementation: 20 套 brand template registry 与自动选型；强制 branded outro；previous/current/next 完整句裁切门；1080×1920 默认 English 88、Chinese 72、Title 76；分层字体主题与授权回退。
  before: 无强制片尾；片头样式单一；固定时间留白可能截断句子；English 84、Chinese 66、Title 56；单一字体。
  after: 片头+片尾成对生成且含品牌/账号/CTA；20 套可选模板；不完整句拒绝导出；English 88、Chinese 72、Title 76；标题/中英文字体可分层选择。
  evidence: scripts/brand_templates_smoke.js, scripts/sentence_boundary_smoke.js, scripts/bilingual_typography_smoke.js
  status: active
```

```yaml
- id: hide-template-metadata-snap-outro
  date: 2026-07-19
  userWords: 片尾不要用：“STYLE 06• 水墨留白”，不要把内部的风格信息暴露给外部，类似的逻辑都不要出现，还有片尾转场不要用缩放，更干脆直接有趣
  scope: global
  abstraction: 成片只呈现观众需要的品牌内容，制作模板和调试元数据不得外显；片尾节奏应短促有趣，避免缩放推拉。
  implementation: publicText 白名单测试；模板元数据仅留工程；片尾默认 snap-flash-pop 三段硬切且 motion=none。
  before: 片尾显示 STYLE 编号和中文风格名，并使用 pullBack/pushIn 等缩放运镜。
  after: 片尾只显示品牌、账号和 CTA；闪色 120 ms、品牌跳切 180 ms、CTA 定帧 2.3 s，全程无缩放。
  evidence: scripts/brand_templates_smoke.js and project outro frame review
  status: active
```

```yaml
- id: quality-over-count-no-duplicate-padding
  date: 2026-07-19
  userWords: 不要硬拼重复使用素材，如果不够10条就不够
  scope: global
  abstraction: 镜头目标数是上限，素材独立性和质量优先；不允许为凑数复用同一或近重复场景。
  implementation: 下载前多键去重、下载后 SHA-256/抽帧去重；报告 selected/target 与 padded:false；不足目标数正常成功。
  before: 选择器以达到 clipsPerVideo 为完成目标，不同 videoId 的相同下载文件可能漏过去重。
  after: 同源素材只保留最佳版本，不足 10 段按实际数量构建且不报失败。
  evidence: project reports/dedupe-report.json and source selection gate
  status: active
```

```yaml
- id: executable-explainer-social-pipeline
  date: 2026-07-21
  userWords: |
    explainer 负责 SVG、HTML、Manim 概念动画。
    social-short 负责 9:16 构图、强字幕、音效和短视频节奏。
    这两个是我的乔木cut skill中内置的功能吗？
    那优化到我们的skill中
  scope: global
  abstraction: Skill 对外声明的工作流应有可执行链路和真实测试证据；竖屏知识点视频应把概念动画与社交短视频包装合成一个工作流。
  implementation: 新增 explainer-social 路由；qcut scene render 支持断网 HTML/SVG 逐帧捕获和 Manim 导出归一化；ASS 增加 word-follow/karaoke/typewriter/pop/slide-up；timeline 增加 transition 与 soundEffects[]；渲染报告记录转场与 SFX cues。
  before: explainer/social-short 主要是工作流标签和设计目标；HTML 只生成静态模板，Manim 只做存在性检查，timeline 只直接拼接图片/视频且无独立 SFX 轨。
  after: 可从 HTML/SVG/Manim 源文件生成可审查 MP4 中间资产，再用动态字幕、镜头转场、独立音效和 9:16 时间线完成可复现成片。
  evidence: scripts/kinetic_caption_smoke.js, scripts/timeline_features_smoke.js, scripts/scene_renderer_smoke.js, npm run release-check
  status: active
```

```yaml
- id: one-shot-explainer-autopilot-no-left-accent-blocks
  date: 2026-07-21
  userWords: |
    整个制作过程总结成一个自动化高速执行工作流内置到qiaomu-cut skill中，减少执行过程中的耗时和失败。未来我只需要说：制作一个科普视频：介绍LLM中的“RL”就能生成视频。
    还有组件生成时，不要用左侧颜色竖线的block块，这样显得很不专业，你优化下，以后避免，也写入我的审美偏好。
  scope: global
  abstraction: 一句话科普请求应自动进入内容核验、精确旁白、语义分镜、HTML/Manim 场景、预览审查和 final/full 的闭环；组件层级不得依赖左侧彩色竖线。
  implementation: 新增 qcut explainer init/check/render-scenes/preview/final；HTML/SVG 用 image2pipe 流式编码、按依赖增量顺序渲染；字幕坐标随 profile 缩放；默认向阳乔木 v1.1 MP3；author gate 检查一手来源、时长、字幕重复和左色条禁用模式；新增无左色条基础模板与审美偏好文档。
  before: Agent 手工创建目录、逐个运行 scene render，浏览器帧先写 PNG 导致高磁盘占用；默认 WAV 可能遇到封装不一致；preview 显式字幕坐标可能出界；卡片可使用左侧彩色竖线强调。
  after: 一句话进入 explainer-social autopilot；已有场景增量渲染，PNG 中间帧为零，付费旁白不自动重试，字幕跨 profile 保持位置，左侧彩色竖线在生成规则和 lint 中同时禁止。
  evidence: scripts/explainer_pipeline_smoke.js, scripts/scene_renderer_smoke.js, scripts/kinetic_caption_smoke.js, npm run release-check
  status: active
```

```yaml
- id: no-simultaneous-scene-caption-echo
  date: 2026-07-21
  userWords: 避免这种情况，画面显示和字幕完全一样，同时出现
  scope: global
  abstraction: 同一时间、同一信息只能有一个视觉所有者；画面组件与字幕不得逐字复读，否则信息层级混乱并浪费画布。
  implementation: explainer author gate 改为时间感知硬阻断；短中文阈值降为四个汉字，覆盖跨 HTML 标签和脚本动态注入文案，只比较与字幕时间重叠的 scene；preview 继续人工检查语义近似重复。
  before: 仅长度十个字符以上的静态整句会被发现，像“答案叫：知识蒸馏”这样的短句会漏检，而且不同镜头出现同句可能误报。
  after: 截图中的短句复读在 author 阶段直接失败；跨镜头同句不误报，字幕增加解释而画面只保留关键词时可以通过。
  evidence: scripts/explainer_pipeline_smoke.js short-split-copy-block, dynamic-copy-block, time-aware-copy-check
  status: active
```

```yaml
- id: incremental-generation-no-whole-video-regeneration
  date: 2026-07-21
  userWords: |
    我觉得合成速度不是瓶颈，而是前面的生成和复杂的校验检查重新生成。
    对，你优化下skill，还有上面的“场景使用内容哈希缓存跨项目复用片头、片尾、基础动画”，“多个 HTML/SVG 场景复用一个 Chrome 进程避免每个场景重复启动浏览器”，“TTS 等待期间并行创作 SVG/HTML 场景隐藏远端生成等待时间”这些也都优化考虑。
  scope: global
  abstraction: 视频提速的核心是让昂贵生成晚发生、互不依赖的生成并行发生、修改后只失效真实依赖节点，并复用已通过的复杂校验；不能把注意力只放在最终编码。
  implementation: 新增统一 production spec、缓存 spec gate、确定性参数化组件物化、结构化 repairPlan、单 Chrome HTML/SVG batch、跨项目 SHA-256 scene cache、preview/final 输入指纹与 validation 复用；Spec 锁定后并行 TTS 与本地组件/资产创作。
  before: narration/research/storyboard/captions/scenes 分别生成；author gate 在场景写完后才运行；场景按 mtime 判断且每个启动 Chrome；未变化 final 仍重新执行复杂校验。
  after: 慢生成前先锁定一份规格；相同规格和相同场景内容直接复用；五个 HTML 场景只启动一个 Chrome；校验失败只重做 invalidates 节点并保留 preserves 资产。
  evidence: scripts/explainer_pipeline_smoke.js and scripts/explainer_e2e_smoke.js
  status: active
```

```yaml
- id: mechanism-scenes-need-process-animation
  date: 2026-07-23
  userWords: 为什么画面里没有动画，更容易让人懂的设计？
  scope: workflow
  abstraction: explainer 的 mechanism/过程类场景（算法步骤、合并循环、切分过程）必须用随时间真实演化的过程动画，而不是静态卡片罗列步骤；陈述类场景（定义、对比、边界）才使用静态参数化组件。
  implementation: references/explainer-autopilot.md 第 7 步新增默认规则：mechanism 场景默认手写 HTML + window.__QIAOCUT_SET_TIME__ 逐帧动画（聚拢、合并、编号、状态转移），静态组件只承担陈述类场景。
  before: Tokenizer/BPE 项目 mechanism 场景用 reward-loop 静态卡片列出 4 个步骤，预览帧全程无变化，机制不可见。
  after: s02 字母聚拢成 token 再变编号、s03 BPE 四轮合并循环动画、s06 字母→碎片→编号→r 计数疑问的过程动画。
  evidence: Tokenizer-分词-讲解视频 scenes/s02_definition.html, scenes/s03_mechanism.html, scenes/s06_limits.html 与 preview 抽帧
  status: active
```

```yaml
- id: explainer-cover-first-frame-click-worthy
  date: 2026-07-23
  userWords: 为什么没有好看的首帧封面？让用户看封面好奇内容点击播放，这个优化沉淀到skill中；我觉得默认应该有封面
  scope: workflow
  abstraction: explainer 成片第 0 帧就是平台封面，必须默认是专门设计的封面镜头：悬念问句 + 核心视觉符号 + 品牌账号，一眼产生点击欲；不能把 hook 场景的空屏起始帧当封面。
  implementation: 代码级默认（v0.7+）：defaultProductionSpec 带 spec.cover（enabled 默认 true，duration 1.5，title/highlight/teaser/brand/handle/cta 可配，enabled=false 可关闭）；materialize 确定性生成 scenes/s00_cover.html（t=0 完整构图、动效仅点缀）、前置 scene-plan/timeline、偏移 captions 与 narration.start；author/scenes 门强制封面在首位，final 自动导出 cover.png 且 final 门强制其存在。references/explainer-autopilot.md 同步该契约。
  before: Tokenizer/BPE 项目首帧是 hook 场景 t=0 的近乎空屏帧，无标题、无视觉、无点击欲；封面只作为文档约定存在。
  after: 封面镜头含「strawberry 里有几个 r？」悬念大标题、str/aw/berry 切分视觉与编号、红圈圈出 rr、品牌与「一分钟看懂 BPE」，第 0 帧即为完整封面；脚手架对所有 explainer 项目默认生成封面。
  evidence: Tokenizer-分词-讲解视频 scenes/s00_cover.html, cover.png；scripts/explainer_pipeline_smoke.js default-cover-shot；scripts/explainer_e2e_smoke.js coverPngExported
  status: active
```

```yaml
- id: explainer-cognitive-contract-and-evidence
  date: 2026-07-24
  userWords: |
    你读取这个文档，看如何优化我们的 qiaomu cut skill。
    可以，执行吧。
  scope: workflow
  abstraction: explainer 的质量瓶颈不是继续增加框架，而是让每个 scene 只有一个认知任务、一个真实主焦点和一个可验证的状态变化；真实旁白只承诺有证据的 duration/phrase timing，preview 用首尾帧提前发现“元素在动但概念没讲清”的问题。
  implementation: production spec 保持 v1 兼容，通过 contractVersion=2 启用 cognitiveTask/primaryFocus/visibleChange；组件运行时消费焦点与 state/process 变化；mechanism 无变化硬阻断；preview 生成 reports/scene-review.json 与每场景首尾两帧软审查；新增 qcut explainer timing --audio ... --apply，记录音频 SHA-256、ffprobe 实测时长和 silencedetect 边界，证据不足时降级为 duration-level。
  before: scene 只有 purpose/component/文案/时长，mechanism 是否真的解释过程主要靠文字约定；preview 的代表帧偏全片后置；TTS 时长通过人工 ffprobe/silencedetect 修补且没有统一证据文件。
  after: 新项目在慢生成前锁定认知契约，运行时与 scene plan 都消费它；每个 scene 有可点击的首尾证据和四项 review；旁白时间有项目内哈希契约且不会把估算写成逐词对齐。
  evidence: scripts/explainer_pipeline_smoke.js, scripts/explainer_cognitive_timing_smoke.js, scripts/explainer_e2e_smoke.js
  status: active
```

```yaml
- id: english-mix-resilient-fast-path
  date: 2026-07-24
  userWords: 沉淀这次运行的经验教训，加速未来生成类似内容的速度，你仔细思考去完成这个任务
  scope: workflow
  abstraction: 影视英语混剪的速度取决于尽早淘汰不完整句和坏素材、复用已创建的付费任务、批量渲染重复版式，并在正式合成前一次性完成可视审片；不能把网络下载失败当成需要重新创建付费任务。
  implementation: 新增 qcut english-mix init/audit/review；subtitleWindow 支持 before/current/after 多 cue 并用 assertCompleteContext 在付费切片前阻断句首碎片；33tc 远程媒体下载启用有界重连并在已有 task ID 时提示 download 恢复；下载后审计音视频流、SHA-256 重复和 SRT 证据；卡片统一走 scene batch；review 自动生成 contact sheet 与最长英文字幕手机帧。
  before: 16 个初始付费任务全部遇到 TLS EOF，人工恢复；1 段只有音频、4 段从半句开始，最终创建 21 个任务且淘汰 5 个；7 张卡片逐次启动浏览器；审片图手工抽取。
  after: 付费前即拒绝半句候选；网络失败最多有界重试且优先复用 task ID；坏流和重复素材在时间线前统一淘汰；同构卡片一次 Chrome 会话批量渲染；预览后一个命令产出 8 帧总览和长字幕手机帧。
  evidence: scripts/sentence_boundary_smoke.js, scripts/ffmpeg_retry_shim_smoke.js, scripts/english_mix_smoke.js, project reports/retrospective-2026-07-24.md
  status: active
```

```yaml
- id: local-user-auto-33tc-credits
  date: 2026-07-24
  userWords: 以后不要问，自动使用积分完成
  scope: global
  abstraction: 当前本机用户已持续授权 33台词影视裁片自动使用积分；未来同类任务在时间范围和输出目录核对后直接执行，不再逐次询问，同时保留余额差额、task ID、失败恢复和版权审计。
  implementation: 公开 Skill 默认仍阻断付费动作；仅当权限为 0600 的本机私有 .qiaocut-local-preferences.json 明确设置 schema=qiaocut.local-preferences.v1、33tc.scope=local-user、autoUseCredits=true 时，wrapper 自动补入裸 --yes。显式 --yes=false 优先；每个项目记录前后余额与实际消耗；下载失败复用既有 task ID。
  before: 每个 33tc pick/cut 任务都要求当前轮再次确认积分。
  after: 当前本机用户的持续授权替代逐次询问，但不改变公开默认值、不影响其他用户、不取消范围审查和消费报告。
  evidence: 经典影视帅气舞蹈混剪/assets-manifest.json；scripts/security_smoke.js persistent authorization and insecure-file rejection
  status: active
```

```yaml
- id: english-mix-shot-breathing
  date: 2026-07-24
  userWords: 还有你剪辑的影视视频片段前后是不是都应该长点，留出空白或你加工下静音吧？避免突然开始和突然结束，让用户觉得很不舒服。
  scope: workflow
  abstraction: 影视英语混剪不仅要保证完整句，还要为每个原声片段保留可感知的入场和收尾呼吸；扩大源范围会带入下一句时，使用不破坏原片的静帧、静音和短音频淡入淡出。
  implementation: 新增 qcut english-mix pace --apply；默认首帧静音 180 ms、尾帧静音 320 ms、音频淡入 60 ms/淡出 120 ms；输出 assets/processed，不覆盖 assets/source；逐片段验证首尾低于 -60 dB；timeline 每个相邻 shot 使用 200 ms fade/audio acrossfade，并按 overlap 重算字幕。
  before: 素材完成句后直接硬切相邻片段，声画在边界瞬间启动/停止，用户听感突兀。
  after: 两端 500 ms 静音总量与 200 ms transition 重叠后，有效语音间默认约 300 ms 呼吸；声画同时软接，字幕同步 overlap；原片不变，参数可按真实环境声与语速调整。
  evidence: scripts/english_mix_smoke.js；四句地道英语影视混剪/reports/english-mix-pacing.json 与 transition-audit.json；render report transitions=22；final/full releaseReady=true
  status: superseded
- id: english-mix-fast-open-long-tail
  date: 2026-07-24
  userWords: |-
    你自己觉得处理的好吗？如果真的切断突兀，是不是应该让最后一帧多停留一点？
    还有开头半天没声音，是不是0帧封面就是封面，不应该停留这么久？
  scope: workflow
  abstraction: 英语影视混剪采用不对称节奏：第 0 帧已是完整封面，入口只留防爆音所需的极短静音，出口给观众明确的尾帧确认；转场不能吞掉大部分尾帧。任何首尾半句先按字幕 cue 裁掉，不能靠静帧或淡化掩饰。
  implementation: `english-mix pace` 支持 `trimStartMs/trimEndMs`；默认 60 ms 入场、500 ms 尾帧、40/160 ms 音频淡入淡出与 200 ms fade/acrossfade，完整尾帧约保留 300 ms。片头最长 700 ms、分组卡最长 600 ms、第一句原声最晚 1.2 秒，并要求第 0 帧完整可读。
  before: 上一版虽有 180/320 ms 首尾静帧和 200 ms 转场，但 intro 2.8 秒加分组卡 1.8 秒导致约 4.4 秒才出声；尾部 320 ms 又被转场吃掉 200 ms，完整尾帧只剩约 120 ms，仍显仓促；部分源片还带首尾残句。
  after: 当前成片第一句原声 0.968 秒出现；7 个开头残句和 5 个结尾残句已裁掉；60/500 ms 首尾、160 ms 淡出和 200 ms 转场使完整尾帧约 300 ms、有效语音间隔约 360 ms。
  evidence: 四句地道英语影视混剪/reports/english-mix-pacing.json；四句地道英语影视混剪/reports/transition-audit.json；四句地道英语影视混剪/reports/manual-review.md；scripts/english_mix_smoke.js
  status: superseded
- id: english-mix-cover-vs-intro-timing
  date: 2026-07-24
  userWords: 封面停留可以短，但介绍停留还是要稍微长点吧
  scope: workflow
  abstraction: 封面负责快速抓住注意力，短语介绍卡负责阅读与理解，两者不能绑定同一短时长；开场提速不应以牺牲表达和释义的可读时间为代价。
  implementation: 保持第 0 帧完整封面和 700 ms 片头；短语介绍卡默认改为 1200 ms、上限 1400 ms；第一句原声验收上限放宽到 1800 ms，并分别记录 cover/group-card/first-audio 三项时间。
  before: v0.9.2 将片头和分组介绍卡一起压到 700/600 ms，第一句原声 0.968 秒出现，但介绍卡阅读过快。
  after: 当前成片封面 700 ms、短语介绍卡 1200 ms，第一句原声实测 1.570 秒；介绍可读，同时仍远快于最初约 4.4 秒的无声开场。
  evidence: 四句地道英语影视混剪/reports/transition-audit.json；四句地道英语影视混剪/reports/review/opening-timing-v2.jpg；四句地道英语影视混剪/reports/render-report.json；scripts/english_mix_smoke.js
  status: superseded
- id: english-mix-two-second-intro-card
  date: 2026-07-24
  userWords: 介绍卡继续延长到2s？
  scope: workflow
  abstraction: 教学短语介绍卡需要完整的识别、阅读和理解时间；连续反馈表明 1.2 秒仍偏快，默认应以 2 秒为基准，同时继续保持封面短促。
  implementation: `english-mix init` 默认写入 700 ms 封面、2000 ms 短语介绍卡、2200 ms 介绍卡上限和 2600 ms 首句原声上限；预览必须用 `silencedetect` 实测首句时间。
  before: 介绍卡 1200 ms，第一句原声 1570 ms，仍略显仓促。
  after: 当前成片介绍卡 2000 ms，第一句原声实测 2370 ms；封面仍为 700 ms，未回到最初 4.4 秒的拖沓开场。
  evidence: 四句地道英语影视混剪/reports/transition-audit.json；四句地道英语影视混剪/reports/review/opening-timing-v3.jpg；四句地道英语影视混剪/reports/render-report.json；scripts/english_mix_smoke.js
  status: active
```

```yaml
- id: benefit-risk-two-column-grid-fix
  date: 2026-07-23
  userWords: （preview 人工审帧发现的组件缺陷，随「更容易让人懂的设计」反馈一并修复）
  scope: global
  abstraction: benefit-risk 组件只渲染左右两张卡，模板 grid 却声明三列（1fr auto 1fr），右卡落入 auto 中列把左卡挤成竖排单字；两卡组件必须列数与卡片数一致。
  implementation: 模板 base.css 拆分为两条规则：.component-comparison/.component-teacher-student-transfer 保持 1fr auto 1fr（三列，含中间 VS/箭头），.component-benefit-risk 独立为 1fr 1fr（两列两卡）；曾误把三者合并选择器整体改成 1fr 1fr，导致 comparison 的 VS 挤到第二列、右卡掉到第二行，已在 16:9 迁移审帧时发现并回正。
  before: RLHF s06 左卡「把人类偏好变成分数」一字一行竖排；Tokenizer s06 曾靠加长文案偶然规避。
  after: benefit-risk 两卡等宽横排；comparison 三列横排 VS 居中。
  evidence: RLHF-讲解视频 _preview_frames/f_74.png（修复前）与 g_74.png（修复后）
  status: active
```

```yaml
- id: every-scene-needs-living-visual
  date: 2026-07-25
  userWords: 动画示意很少啊，可以调用生图，调用更多svg生图，让讲讲更生动
  scope: workflow
  abstraction: explainer 每个场景默认要有“活的”视觉：机制/过程用手写 HTML/SVG 逐帧动画，证据用动态图表（柱状图、仪表盘、排序），概念用示意动画；生图插画作补充（注意 ListenHub 生图走 OAuth，TTS 的 openapi key 不通）。纯文字卡片场景全片最多 1 个（hook 或 outro 除外需有品牌视觉）。
  implementation: references/explainer-autopilot.md 第 7 步规则升级为：mechanism 必须过程动画；definition/benefits/limits 默认配一个动态示意图（选择、漏斗、仪表盘、膨胀、盖章等），comparison 默认动态图表（柱状/奖牌/翻转）；生图需 listenhub OAuth 登录，未登录视为 blocker 不得静默跳过不说。
  before: RLHF 初版 7 个场景只有 s03 有动画，其余为静态文字卡。
  after: s01 聊天打分、s02 写不出公式→人选答案、s04 柱状图奖牌移动、s05 漏斗+仪表盘、s06 气泡膨胀+质疑章全部动画化。
  evidence: RLHF-讲解视频 scenes/s01_hook.html、s02_definition.html、s04_modern_practice.html、s05_benefits.html、s06_limits.html 与 _preview_frames/v_*.png、w_*.png
  status: active
```

```yaml
- id: explainer-outro-spoken-brand-cta
  date: 2026-07-25
  userWords: |
    结尾为什么没有引导关注向阳乔木
    优化skill，避免忘掉口播的片尾
  scope: global
  abstraction: explainer/品牌科普片尾必须同时具备口播关注引导和画面品牌 CTA；不能只剩知识收束，也不能只在角落放小字。
  implementation: |
    production-spec gate 硬规则：
    - outro-spoken-brand-cta：outro 旁白必须含「向阳乔木」且含「关注」或「@vista8」
    - outro-visual-brand-cta：outro 画面必须同期出现品牌 CTA
    文档：SKILL.md 一句话科普/质量门、references/explainer-autopilot.md 第 4/10 步、brand-card-templates.md。
    推荐口播句式：「……结论。关注向阳乔木，继续拆解大模型关键词。」
    画面可用 snap-flash-pop 或独立 s08_brand 定帧。
  before: 片尾规范偏重视觉品牌卡；Agent 常把 outro 写成纯认知收束，口播不提关注，画面只有角落小字。
  after: 付费 TTS 前 spec 门阻断无口播/无画面 CTA 的 outro；preview 必须抽听抽看最后几秒。
  evidence: scripts/explainer_spec.js gates + scripts/explainer_pipeline_smoke.js negative/positive cases + Pretraining 16x9 brand frames
  status: active
```

```yaml
- id: explainer-mechanism-native-visual-diversity
  date: 2026-07-30
  userWords: 为什么我们生成出来的动态画面介绍，模式总是很单一，也没有有趣的能解释原理的动效，如何优化skill解决，你重新生成
  scope: workflow
  abstraction: explainer 的动态不能只是同一套卡片在淡入、缩放和点亮；每个原理应使用与其因果结构匹配的视觉语法，并在首/中/尾帧中明确呈现输入、过程和结果。
  implementation: 新项目升级为 contractVersion=3；scene 强制 visualMechanism {kind,input,process,output}；新增 prediction-field、segmentation-flow、optimization-loop、filter-conveyor、balance-system、state-morph、risk-dashboard 七类机制组件；spec gate 强制非片尾至少 4 种不同组件、至少 4 个机制型组件、通用卡片最多 1 个；scene review 新增 explanationVisible。
  before: 既有规则虽然写着“mechanism 需要过程动画”和“每场景需要活的视觉”，但默认组件仍只有 definition/reward-loop/pipeline/comparison 等卡片结构，门控只验证帧差和状态变化，导致“卡片在动但原理没解释”。
  after: 概率竞争、Token 切分、前向/损失/梯度回流、数据去重过滤、参数×数据×算力平衡、能力跃迁和风险边界各用不同运动语义；单一模板在付费生成前即被阻断。
  evidence: scripts/component_motion_smoke.js, scripts/explainer_pipeline_smoke.js, scripts/explainer_cognitive_timing_smoke.js, 大模型预训练-机制动画版/reports/scene-review.json, 大模型预训练-机制动画版/reports/render-report.json
  status: active
```

```yaml
- id: chinese-video-default-exact-qiaomu-voice
  date: 2026-08-10
  userWords: 优化skill，默认用向阳乔木v1.1音色，你怎么记不住，写入永久记忆，视频也重新生成
  scope: global
  abstraction: 中文讲解视频默认旁白必须是 ListenHub 精确音色“向阳乔木 v1.1”；这是成品契约，不是可在缺少积分授权时静默降级的建议。
  implementation: explainer-plan 保留 provider=listenhub、voiceName=向阳乔木 v1.1、exactMatchRequired=true；author gate 在 timing 锁定后校验 timeline narration 的 provider、精确 speakerName、assetId、speakerId 和 narrationTextSha256；不符合时阻断 preview 并要求重新生成。文档同步禁止使用 macOS say/Tingting 静默替代。
  before: 北京大学介绍视频因本机没有 ListenHub 持续积分授权，Agent 自行使用 macOS Tingting 音色交付，虽然 Skill 文字已声明默认音色，却没有防降级硬门。
  after: 缺少授权时任务停在付费门请求授权；只有精确的向阳乔木 v1.1 及完整 ListenHub 来源能通过 author gate。
  evidence: scripts/explainer_cognitive_timing_smoke.js default-voice-contract-gate；北京大学介绍 ListenHub 旁白重生成、preview 和 final/full 报告
  status: active
```

```yaml
- id: real-world-image-evidence-and-relation-driven-visuals
  date: 2026-08-10
  userWords: 为什么没有检索相关图片放进去，而且动态图表都那么单调，你研究乔木chart report skill 吸收学习
  scope: workflow
  abstraction: 真实人物、地点、机构、品牌和历史题材不能被当成纯抽象科普；必须先建立图片证据账本，再从每幕要回答的问题与真实信息关系选择照片、时间线、比较、构成、分布、流程、层级、网络或地理。视觉趣味来自语义匹配和证据，不来自重复卡片、装饰性百分比或伪仪表盘。
  implementation: 新项目升级为 contractVersion=4；新增 visualEvidence 图片检索与权利门、scene.visualQuestion/visualForm/visualRelation 语义契约，真实题材至少 2 条检索词、3 张已下载且来源/署名/许可明确的图片、2 个照片/混合场景和 3 种语义关系；新增 evidence-photo、timeline-story、relationship-map 组件；事实/计算图表强制来源、单位、编码，真实题材的无来源 prediction-field/balance-system/risk-dashboard 在 spec 门阻断。规则吸收自 qiaomu-chart-report 的“读者问题→证据账本→关系→视觉语法”流程。
  before: 北京大学介绍被自动套成纯 motion graphic；没有检索校景、校门和历史建筑照片，学科与风险场景使用无来源的 82/86/78 等装饰性数值，组件名虽然不同，信息关系和运动语法仍然单一。
  after: 当前视频使用可溯源的北大西门、未名湖/博雅塔和红楼图片，历史用时间线、学科与校园实践用关系网络，删除全部无来源百分比；未来同类真实题材在付费 TTS 前即被图片证据与视觉关系门阻断。
  evidence: scripts/explainer_spec.js contractVersion=4 gates；assets/explainer-social/component-runtime.js；scripts/explainer_pipeline_smoke.js；北京大学介绍 visualEvidence 与 final/full 报告
  status: active
```

```yaml
- id: composition-driven-photo-motion
  date: 2026-08-10
  userWords: |-
    为什么图片永远是缩放动效？
    不要给图片加这种sb缩放
  scope: global
  abstraction: 所有静态图片镜头禁止缩放，包括图片元素本身以及承载图片的外层焦点脉冲。图片运动只能来自定帧、遮罩揭幕、object-position 平移或焦点变化；没有理由移动时直接定帧。
  implementation: 新项目 contractVersion=5 的 scene.evidence-photo 强制声明 photoMotion，仅允许 hold、reveal-left、reveal-right、pan-up、pan-down、rack-focus；push-in 触发 photo-scale-forbidden 硬门。运行时删除图片 scale 分支，并让 focus-photo 跳过通用 spotlight/pulse scale。
  before: 第一轮只去掉图片元素默认缩放，却仍保留可选 push-in，且通用焦点强调继续把 focus-photo 外层容器放大约 3%，视觉上仍像图片缩放。
  after: 北京大学介绍使用西门从左揭幕、红楼由虚到实、未名湖沿纵向浏览；图片元素和外层容器均无 scale，Skill 也不再提供 push-in 选项。
  evidence: assets/explainer-social/component-runtime.js；scripts/explainer_spec.js contractVersion=5 gates；scripts/component_motion_smoke.js；北京大学介绍 final/full 报告
  status: active
```

## 提升门槛

- 用户明确要求“以后都这样”或“改进 Skill”：可直接提升到对应 workflow/global。
- 重复两次以上且方向一致：提升为 workflow 默认。
- 单次审美偏好且可能依赖内容：保留 project-only，等待更多证据。
- 可读性、安全、版权、数据保护问题：一次有效证据即可升级，但必须验证没有引入新风险。
