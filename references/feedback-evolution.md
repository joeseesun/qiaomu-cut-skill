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

## 提升门槛

- 用户明确要求“以后都这样”或“改进 Skill”：可直接提升到对应 workflow/global。
- 重复两次以上且方向一致：提升为 workflow 默认。
- 单次审美偏好且可能依赖内容：保留 project-only，等待更多证据。
- 可读性、安全、版权、数据保护问题：一次有效证据即可升级，但必须验证没有引入新风险。
