# Source Adapters

qiaomu-cut 的素材源必须走统一 adapter contract，避免把“搜索、下载、许可、归因、缓存”混在剪辑逻辑里。

## Adapter Contract

```ts
type AssetCandidate = {
  id: string
  source: string
  provider: string
  mediaType: "video" | "photo" | "illustration" | "audio" | "html" | "svg" | "generated-image"
  title?: string
  sourcePage?: string
  thumbnail?: string
  downloadMode: "direct" | "provider_source_page" | "manual" | "generated"
  licenseStatus: "verified" | "verify_at_provider" | "user_provided" | "ai_generated" | "unknown"
  attribution: string
  raw?: unknown
}
```

## 当前已实现

### ClipSeek

- CLI：`node scripts/qcut.js clipseek "挖掘机" --type video --json`
- 角色：免费素材发现入口。
- 支持：视频、照片、插画。
- 返回：标题、缩略图、原始素材页。
- 边界：不直接证明许可，不直接下载原始文件。

### Local

- CLI：`node scripts/qcut.js local /path/to/assets --recursive --json`
- 角色：扫描用户提供的本地素材。
- 边界：不删除、不覆盖原文件；许可默认为 `user_provided`。

### 33tc

- CLI：`node scripts/qcut.js doctor --json` 会检测 33tc 本机状态。
- 搜索：`node scripts/qcut.js 33tc search "台词" --json`。
- 角色：影视台词/片段工作流。
- 公开包边界：`qiaomu-cut` 只委托 `QIAOMU_33TC_CLI` 或 `PATH` 中独立安装、获得授权的 `33tc` 适配器；不再分发 App 私有协议、签名或解密实现。
- 隐私：qcut wrapper 清洗结构化 token/cookie/password 字段和 URL；独立 adapter 仍必须避免输出无字段标签的裸凭据。公共 JSON 输出应使用字段白名单。
- 外部写操作：`pick` / `cut` 会创建远端裁片任务并可能消耗积分，必须先核对时间范围，且仅在明确确认后传 `--yes`。
- 许可：成功下载不等于获得影视作品的公开传播或商业权利。

### ListenHub / MarsWave

- CLI：`node scripts/qcut.js listenhub doctor --json`。
- 能力：AI 图片、视频镜头、TTS、ListenHub Voice、多角色播客、音乐、解说片、Slides 在线产物、URL 内容解析，以及 `coli` 本地 ASR。
- 运行：委托单独安装的 `@marswave/listenhub-cli`；本地 ASR 委托 `@marswave/coli`。完整上游快照只作为锁定参考，不直接执行嵌套 `SKILL.md`。
- 认证：只读取 `LISTENHUB_API_KEY` 或 ListenHub CLI 自身凭据；公共输出只显示配置状态。
- 付费门：远端创建必须同时提供 `--yes` 与 `--qcut-project`。上传本地文件还必须提供 `--allow-upload`。
- 结果：原始任务 JSON 以 `0600` 写入项目私有 `.qiaocut/jobs/listenhub/`；终端输出会清除密钥、Bearer 和签名 URL。
- 入库：用 `qcut fetch` 从私有任务结果下载，完成 HTTPS/DNS/体积/MIME/文件签名检查后，写入 `assets/generated/` 与 `assets-manifest.json`。已有本地文件用 `qcut ingest`。
- 默认旁白：新中文讲解音频优先使用 `qcut listenhub narration`；它只读查询 Chinese speakers、唯一精确匹配“向阳乔木”、执行 TTS、自动 ingest 并返回带 speaker/text/catalog/capture provenance 的时间线对象。缺失或歧义时不得静默换音色。
- 默认生图：先按主题、受众、年代、情绪、平台与媒介锁定 visual bible，再选 agent imagegen 或 ListenHub image。Provider 选择不能替代内容一致性审查。
- 许可：生成物标记 `ai_generated` 和 `provider_terms_unverified`；上游 MIT 许可证不等于生成内容可商用。

完整命令与边界见 `references/listenhub-provider.md`。

## 计划/推荐扩展

### Provider Download Adapters

ClipSeek 返回原站页面后，应通过原站 adapter 完成下载和许可记录。

- `pexels`：下载视频/照片，记录 Pexels source page/license。
- `pixabay`：下载视频/图片/矢量，记录 Pixabay source page/license。
- `unsplash`：照片，记录 Unsplash page 和 attribution。
- `wikimedia`：开放授权图片/视频，记录 author/license。
- `nasa`：NASA Image and Video Library，记录 public domain/status。
- `internet-archive`：公共领域或开放素材，逐项记录 rights。
- `openverse`：开放授权聚合搜索，记录源站。

### Generated Sources

- `imagegen`：AI 生成封面、插图、背景、缺口 B-roll。
- `listenhub`：生成图片、短视频镜头、旁白、对白、音乐与完整解说源片；所有临时 URL 必须先本地化。
- `svggen`：图标、流程图、HUD、字幕装饰。
- `htmlgen`：网页卡片、排行榜、人物档案、产品界面。
- `chartgen`：数据图表、地图、趋势动画。

### Information Sources

用于人物、公司、事件、论文和历史视频：

- 官方网站
- Wikipedia / Wikidata
- 新闻源
- 论文/PDF
- 本地笔记或用户资料

规则：事实型视频必须保留 citation manifest。

### Capture Sources

- browser screenshot / screen recording
- app demo recording
- slides export
- terminal recording

规则：需要用户授权的账号界面不得自动公开，除非用户明确要求。

## 选择策略

1. 用户素材优先：本地文件最可控。
2. 开放许可素材第二：Pexels/Pixabay/Wikimedia/NASA 等，但必须记录原站。
3. AI 生成补缺口：用于抽象、封面、背景，不冒充真实事件。
4. 影视片段只用于用户授权/合理使用边界内的学习、评论、研究或用户私有项目；公开视频需谨慎。
