# ListenHub / MarsWave Provider

本集成把 `marswaveai/skills` 的素材生成和内容处理能力纳入 qiaomu-cut，但控制权仍属于 qiaomu-cut：ListenHub 负责产生候选素材，项目 manifest 负责来源，timeline 负责采用，ffmpeg-full 负责终稿。

## 已锁定的上游

- 仓库：`https://github.com/marswaveai/skills`
- commit：`957774057d11fb57ffaf0262b0fba93b87da4933`
- tree：`257163ba0095d92d3f7aee87836345834123b339`
- 上游技能版本：`1.3.0`
- 本机验证 npm 包：`@marswave/listenhub-cli@0.0.15`
- ListenHub CLI 协议版本：`listenhub --version` 输出 `0.1.0`
- 本机 ASR 包：`@marswave/coli@0.0.20`

完整 78-entry 快照位于 `vendor/marswaveai-skills/`。它是不可执行的证据快照；上游 `SKILL.md`、自动安装、配置、轮询、agent-memory 持久化和删除指令不继承为 qiaomu-cut 行为。`cola-avatar-pack` 明确隔离，不能由 qiaomu-cut 执行。

验证：

```bash
node scripts/verify_marswave_vendor.js
```

## 安装与认证

ListenHub 是可选 provider，要求 Node.js 20+。qiaomu-cut 核心仍可在 Node.js 18+ 使用。

```bash
scripts/bootstrap_listenhub.sh --check
scripts/bootstrap_listenhub.sh --install
node scripts/qcut.js listenhub doctor --json
```

安装脚本同时验证 executable 所属包名、npm 包版本、ListenHub CLI 协议版本以及 `coli asr` 路由。`--check` 对缺失、错包或错版 fail-closed；`--install` 会安装或修复为 `@marswave/listenhub-cli@0.0.15` 与 `@marswave/coli@0.0.20`。脚本不运行 `npm view`、自动更新或跟随 `latest`。

允许的认证路由：

1. **OpenAPI key**：从环境变量 `LISTENHUB_API_KEY` 或 ListenHub 官方本机 credential store 读取，对应 `listenhub openapi ...` 命名空间；不接受命令行 key 参数。
2. **OAuth/internal**：用户明确运行 `listenhub auth login`，对应顶层 `listenhub video ...`、`listenhub image ...` 等 internal 命名空间；qcut 只读 `auth status`。
3. OpenAPI/OAuth 的本机凭据均由 ListenHub CLI 自身管理；qcut 只检查 `openapi.json` / `credentials.json` 是否为普通文件且权限不宽于 `0600`，不读取/打印凭据内容。

两条路由不能混用：设置 API key 不等于完成 OAuth 登录，因此 key 模式的视频示例必须使用 `openapi video`。`qcut listenhub doctor` 分别报告 OpenAPI 和 OAuth 是否 ready，不把“CLI 已安装”误报为“认证已就绪”。

禁止 `--api-key <value>`。`doctor` 只输出 `configured: true/false`；所有 stdout/stderr 都经过 API key、Bearer、JWT、用户主目录和签名 URL 清洗。

## 能力矩阵

| 视频环节 | ListenHub 能力 | qcut 用法 |
|---|---|---|
| 信息源 | OpenAPI content extract | 抓取 URL 内容，作为脚本/citation 输入，不直接当媒体 |
| 转录 | `coli asr` | 本地全文转录；当前不能冒充逐词对齐字幕 |
| 旁白 | TTS / speech | 下载为音频，manifest 入库，`narration.engine=file` |
| 多角色对白/拟音 | ListenHub Voice | 下载音频；保存角色/模型/任务/积分记录 |
| 播客源音频 | Podcast | 作为 narration 或可剪辑音频，不自动替换 timeline |
| BGM/歌曲/分轨 | Music | 下载后使用 `music.mode=file`；重混仍继承输入权利风险 |
| 图片 | Image | 作为 image shot、背景、封面；标记 AI-generated |
| 视频镜头 | HappyHorse / SeeDance / PixVerse | 作为 video shot；生成完成立即下载 |
| 口型/转场/融合 | PixVerse | 生成候选 video shot；先 estimate，后显式确认 |
| 完整讲解片 | Explainer | 作为外部源片导入，仍通过 qcut 响度、字幕和终检 |
| Slides | Slides | 当前只把在线产物/音频当来源，不宣称有本地 PPTX |

运行时以 `qcut listenhub capabilities` 的实际命令探测为准，不把上游写死的模型、价格或子命令当永久事实。

## 讲解旁白默认契约

讲解、口播和课程音频优先 ListenHub，默认期望的 speaker/voice 名称为“向阳乔木”。成片默认只走专用闭环：

```bash
node scripts/qcut.js listenhub narration \
  --text-file scripts/narration.txt \
  --qcut-project ./project --yes --json
```

该命令内部运行已锁定的 `openapi speakers list --language zh -j`，在本地对名称做完全匹配，只有“唯一 + 已授权”时才取其 speaker ID。随后执行直接二进制 TTS、验证媒体签名与所选容器、自动 ingest、清理 staging，并返回 `timelineNarration`。默认生成无损 WAV，避免 MP3 → PCM → AAC 二次有损；`--format mp3` 仅作为省空间选项。Manifest 记录 speaker ID/name、speaker catalog SHA-256、旁白文本 SHA-256、任务/capture/model/积分；渲染器再校验 asset ID/path/content SHA/speaker/text 一致。零结果、同名多个、账号无权、文件被替换或 provider 拒绝时都 fail-closed，不得用模糊匹配或悄悄换另一个音色。

已锁定 CLI 的底层 OpenAPI TTS 是直接二进制输出命令：没有 `create` 子命令，也不使用 `--json`。当前 help 没有已验证的 TTS estimate 路由，因此专用命令执行前必须说明“费用/积分未知”并取得本次裸 `--yes`；`--yes=false` 会被拒绝。

原始 `openapi speakers` / `openapi tts` 透传只用于低层调试，不是成片默认路径；手工流程如果没有完整 speaker/text/catalog/capture provenance，不能通过 ListenHub 时间线身份门。仅返回 URL 的其他语音能力仍通过私有 capture + `fetch` 本地化。进入 timeline 时一律使用 `narration.engine=file`。

## 生图与 visual bible 契约

ListenHub 或其他图像 provider 都不获得一个硬编码的“乔木默认画风”。每个项目先从内容主题、目标受众、时代语境、情绪曲线和输出媒介推导视觉方向，然后建立整片 visual bible：

- 色板、明暗和对比度。
- 时代、服装、场景、材质与纹理。
- 画幅、镜头、机位、构图、运镜暗示和光线。
- 字体、图形、插画/摄影媒介和后期语法。
- 人物外观、道具、场景连续性与负面约束。

后续每个生图提示词都必须继承上述契约。提示词与本镜头语义或 visual bible 冲突时，拒绝直接调用 provider，先重写提示词或重新规划镜头；不用单一热门风格覆盖所有主题。

`qcut plan` 会把具体 visual bible ID、媒介、时代、情绪、色板、光线、构图、负面提示和 prompt prefix 写入 IR。图片落盘时，`qcut ingest` 或 `qcut fetch` 必须追加 `--visual-bible-id <id> --prompt <actual-prompt> --seed <provider-seed>`（没有 seed 时省略），让 manifest 能审计实际生成参数。

## 远端调用门

查询命令不需要确认：status、list、get、estimate、subscription、`openapi speakers list`。

远端创建、提取、生成、音乐分析/分轨和 OAuth 登录必须加 `--yes`。可能上传本地文件的 flag 还必须加 `--allow-upload`。删除任务、logout、config clear/revoke/remove 等破坏性账号操作不由 qcut 代理。付费创建必须指定项目：

```bash
node scripts/qcut.js listenhub openapi video estimate \
  --model doubao-seedance-2-pro --resolution 720p --duration 5 --ratio 16:9 --json

node scripts/qcut.js listenhub openapi video create \
  --prompt "slow cinematic push-in on an excavator at dawn" \
  --model doubao-seedance-2-pro --resolution 720p --duration 5 --ratio 16:9 \
  --no-wait --json --qcut-project ./project --yes
```

有 estimate 时先估算；没有 estimate 时必须明确“费用未知，仍可能扣积分”。`--yes` 只表示当前这一次已确认，不保存全局同意。任何本地素材上传前，报告 basename、类型和大小，不能只因为用户已配置 key 就默认上传。

本集成测试不调用付费端点。

## 私有任务账本

付费/远端创建的原始结果自动写入：

```text
<project>/.qiaocut/jobs/listenhub/<timestamp>-<command>-<hash>.json
```

文件权限为 `0600`，私有目录权限为 `0700`，且目录已被 Git 忽略。记录 CLI 版本、去密钥命令、风险分类、退出状态和原始 provider 结果。API key/Bearer/JWT/token/password/cookie/credential 字段不会写入；为了下载生成物，临时签名 URL 仅保留在私有 capture 内，终端显示会隐藏 URL 主机、路径和查询参数。

可用 `--qcut-capture .qiaocut/jobs/listenhub/my-task.json` 指定项目相对文件；已有文件不覆盖。Capture 路径必须是 `.qiaocut/jobs/listenhub/` 下的 `.json` 文件，指向该目录外、绝对路径、符号链接或非 JSON 目标都会被拒绝。

`--no-wait` 创建通常只返回 task ID，不包含可下载的结果 URL。使用同一认证命名空间执行只读 poll；只要提供 `--qcut-project`，`get` 结果也会自动写入新 capture：

```bash
node scripts/qcut.js listenhub openapi video get TASK_ID_FROM_SUBMIT \
  --json --qcut-project ./project
```

## 下载并进入素材清单

不要把 provider URL 直接放进 timeline。使用私有任务结果中的字段下载：

```bash
node scripts/qcut.js fetch ./project \
  --result .qiaocut/jobs/listenhub/<poll-capture>.json \
  --field result.videoUrl \
  --kind video \
  --provider listenhub \
  --json
```

这是必须保持的 `submit → poll capture → fetch` 链路。音乐多轨可能使用 `result.tracks.0.audioUrl`，图片可能使用 `result.imageUrl`；字段以实际 CLI JSON 为准。Fetch 会从 capture 自动提取可得的 provider、task ID、model、实际积分、capture 路径/摘要和 result field；provider 未返回积分时显式记录 `unreported`。

下载器执行：

- 只允许 HTTPS，拒绝 URL 内嵌账号密码。
- DNS 解析后拒绝 loopback、私网、link-local 和保留地址，避免 SSRF。
- 最多 5 次重定向、默认 30 秒网络超时、默认 1 GiB 上限。
- 校验 HTTP 状态、Content-Type 和 JPEG/PNG/WebP/GIF/MP4/MP3/WAV/Ogg/FLAC 文件签名。
- 先写 `.part`，成功后用同文件系统原子 hard-link 落位；已有目标会 fail-closed，不覆盖。
- 写入 `assets/generated/<provider>/<kind>/` 和 `assets-manifest.json`。
- manifest 不保存临时下载 URL，默认 `licenseStatus=ai_generated`、`termsStatus=provider_terms_unverified`。

Provider 产物已经由其他工具下载到本机时：

```bash
node scripts/qcut.js ingest ./project /path/to/file.mp4 \
  --kind video --provider listenhub --task-id <id> --model <model> --json
```

导入不修改原文件、不接受符号链接、不覆盖同名不同内容，并按 SHA-256 去重。

## 本地 ASR

```bash
node scripts/qcut.js listenhub asr assets/interview.wav \
  --model sensevoice --json --qcut-project ./project
```

ASR 在本机运行，不使用 ListenHub API key，不产生 provider 积分；首次模型使用可能下载约 60 MB。上游当前只承诺全文文本/语言/情绪等结果，没有稳定的逐词时间码契约，所以需要精确 ASS/SRT 时仍要单独对齐。

## Timeline 映射

- 图片 → `shots[].kind=image`
- 视频/Explainer → `shots[].kind=video`
- TTS/Voice/Podcast → `narration.engine=file`
- Music → `music.mode=file`
- 字幕 URL → 先下载和转换；无法验证时间码时只进入 manifest
- Content extract → `sources/` 或 citation manifest，不作为 shot
- Slides → 未获得本地可验证媒体前，不写 timeline

生成候选素材和修改 timeline 是两个动作。完成生成不意味着自动采用，避免一个候选结果悄悄改变成片。

## 隐私、费用和权利

- 标准 video/image/audio reference 可能上传本地文件；PixVerse 常要求公网 URL 或已有任务 ID。
- Vendored 文档没有给出输入保留期、训练使用政策、数据地域、下游 provider 删除策略，统一标记 `unknown`。
- 临时结果 URL 可能过期，应尽快下载。
- 实际积分以 provider 返回的 `credits`、`creditCharged` 或 `creditCost` 为准；不要把历史价格写成永久承诺。
- MarsWave MIT 许可证不覆盖服务或生成内容。人物肖像、商标、音乐、影视和参考素材需要单独权利判断。

## 更新与回滚

上游不会在运行时自动更新。升级流程是：临时 clone 固定 commit → 审查 diff/许可证/域名/安装/删除/secret → 更新 vendor 和 lock → mock 测试 → 只读 live smoke → 人工提交。

回滚 qiaomu-cut 集成只需恢复本仓库版本；项目私有 `.qiaocut/jobs/listenhub/` 可删除，已入库的 `assets/generated/` 只有确认未被 timeline 引用后才删除。
