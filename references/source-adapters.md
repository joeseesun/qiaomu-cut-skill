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
- 隐私：不打印 token、cookie、用户 ID 或签名源地址。公共 JSON 输出应使用字段白名单。
- 外部写操作：`pick` / `cut` 会创建远端裁片任务并可能消耗积分，必须先核对时间范围，且仅在明确确认后传 `--yes`。
- 许可：成功下载不等于获得影视作品的公开传播或商业权利。

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
