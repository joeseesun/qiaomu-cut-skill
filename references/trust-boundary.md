# Trust Boundary

qiaomu-cut 是 Governed 级 skill，因为它可能联网、读取本地账号状态、安装依赖、下载素材、生成公开内容并未来发布到 GitHub。

## 允许

- 读取用户明确提供的本地素材。
- 检测 33台词 App/CLI 是否存在和是否已登录。
- 用户明确调用 `qcut 33tc` 时，由独立安装的 33tc adapter 读取本机登录状态并访问 33台词服务。
- 搜索公开素材库和公开网页。
- 在用户项目目录生成输出、报告和工程文件。
- 安装缺失依赖，前提是命令可解释、目标明确、不会删除用户数据。

## 禁止

- 打印 token、cookie、session、私密账号配置。
- 在公开 skill 中捆绑、宣称或再分发未经确认授权的 33台词私有协议实现。
- 删除或覆盖用户原始素材。
- 把 AI 生成图冒充真实照片或新闻证据。
- 未验证原站许可就声称可商用。
- 自动发布公开视频或推送 GitHub，除非用户明确授权当前动作。
- 把用户本机绝对私有路径写进公开 README。

## Rollback Boundary

- 生成文件应落在项目输出目录，可整体删除。
- 安装依赖应使用系统包管理器，报告安装动作。
- 对 GitHub 发布，先 dry-run/验证，再 publish。
- 所有生成目标默认 no-clobber；只有用户/agent 核对目标后才能用 `--force` 覆盖既有生成物。

## missing evidence

当前第一版缺少以下证据，发布或宣传时必须如实说明：

- 不是所有工作流都有端到端视频 fixture。
- ClipSeek adapter 已实现搜索，但 Pexels/Pixabay 直接下载 adapter 仍需补。
- 未找到 33台词公开 API 文档；公开包依赖外部、获授权的 33tc adapter，零额外安装仍是 `missing evidence`。
- HTML/Motion/Manim 渲染器当前是设计好的接口和工作流，不等于已完整实现所有视觉模板。
- 需要真实项目继续沉淀最佳参数和风格模板。
