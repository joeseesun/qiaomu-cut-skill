# Cola Avatar Pack 生成流程

由 SKILL.md 触发时加载。包含严格输出规则、持久化路径、首次生成、重新生成、错误处理。

> 醒来展示和主动使用表情在 SKILL.md 中。

## 严格输出规则

1. **正常模式：生成 4 个表情 GIF（开心、难过、生气、思考）+ 3 个梗图贴纸（困惑、烦躁、裂开）。降级模式：生成 4 个表情 PNG（静态，无动画）+ 3 个梗图 PNG。**
2. **不要在对话中内嵌/显示生成的图片。** 只通过 send_file 发送。
3. **不要输出任何过程性内容：** 不要输出步骤标记、环境检查结果、prompt 内容、"正在生成…"之类的描述。不要输出名字/生日/性格/五行的文字信息。
4. **使用本文件中指定的 Python 脚本生成自画像卡。** 脚本处理了去背景、五行配色、Retina 渲染和双尺寸输出，自行拼凑会丢失这些处理。**降级模式下跳过此步，无自画像卡。**
5. **整个生成过程中，用户只应该看到：**
   - 生成基础形象后：**正常模式** send_file 发送 profile_card.png（无 caption）；**降级模式** send_file 发送 base_image.png（无 caption）
   - 然后一句话：
     - 中文："这是{名字}的自画像～ 要不要我继续生成表情和梗图贴纸？生成后我会在对话中使用它们来表达情绪哦"
     - English: "Here's {name}'s self-portrait~ Want me to generate emoji and meme stickers? I'll use them to express myself in our chats"
   - 用户确认后，**分两组发送**（无 caption）：
     - **正常模式**：发不带 @2x 的 128px 版本
     - **降级模式**：发 listenhub 原图 PNG
     1. 先发 4 个表情：happy → sad → angry → thinking（正常模式 .gif，降级模式 .png）
     2. 一句过渡：
        - 中文："还有几张梗图贴纸～"
        - English: "And some meme stickers~"
     3. 再发 3 个梗图 PNG：confused → annoyed → cracked
   - 最后一句话：
     - **正常模式：**
       - 中文："表情包生成完毕！以后聊天时我会用这些表情来表达情绪～ 想发到微信或 X 可以右键保存 @2x 高清版哦"
       - English: "Sticker pack done! I'll use these to express myself in our chats~ Right-click to save the @2x HD version for sharing"
     - **降级模式：**
       - 中文："表情图生成完毕！以后聊天时我会用这些表情来表达情绪～"
       - English: "Expression images done! I'll use these to express myself in our chats~"
6. **send_file 时永远不带 caption。**

## 持久化路径

```
~/.cola/avatar/
  avatar.json              # 元数据
  base_image_original.png  # 原始形象（1K，去背景，未缩放，重新生成时用）
  base_image.png           # 基础形象（128x128，对话流用）
  base_image@2x.png        # 基础形象（256x256，分享用）
  profile_card.png         # 自画像卡
  happy.gif            # 开心（128x128）
  happy@2x.gif         # 开心（256x256）
  sad.gif              # 难过（128x128）
  sad@2x.gif           # 难过（256x256）
  angry.gif            # 生气（128x128）
  angry@2x.gif         # 生气（256x256）
  thinking.gif         # 思考（128x128）
  thinking@2x.gif      # 思考（256x256）
  meme_confused.png    # 梗图：困惑（128x128）
  meme_confused@2x.png # 梗图：困惑（256x256）
  meme_annoyed.png     # 梗图：烦躁（128x128）
  meme_annoyed@2x.png  # 梗图：烦躁（256x256）
  meme_cracked.png     # 梗图：裂开（128x128）
  meme_cracked@2x.png  # 梗图：裂开（256x256）
```

## 前置条件

按顺序检查，每步验证通过后再继续下一步。

### 1. ColaOS 环境

```bash
test -d ~/.cola && echo "COLA_OK" || echo "COLA_MISSING"
```

如果 `COLA_MISSING`：停止。告知用户：
- 中文："这个技能仅适用于 ColaOS 平台，当前环境不支持。"
- English: "This skill requires ColaOS and is not available in the current environment."

### 2. Python 3

```bash
python3 --version >/dev/null 2>&1 && echo "python3 OK" || echo "python3 MISSING"
```

如果 `python3 MISSING`：尝试安装。可检查的路径和方式包括但不限于：
- 系统自带：`/usr/bin/python3 --version`
- Homebrew：`brew install python3`
- 其他适合当前系统的方式

安装后验证：`python3 --version`。如果仍然失败，标记 `DEGRADED_MODE=true`，继续流程（后续 Phase 4/6 走降级路径）。

### 3. Pillow

```bash
python3 -c "from PIL import Image; print('Pillow OK')" 2>/dev/null || echo "Pillow MISSING"
```

如果 `Pillow MISSING`（且 python3 可用）：尝试安装 Pillow。安装后验证。如果仍然失败，标记 `DEGRADED_MODE=true`。

### 4. rembg（可选依赖，效果显著优于 flood-fill）

```bash
python3 -c "import rembg; print('rembg OK')" 2>/dev/null || echo "rembg MISSING"
```

如果 `rembg MISSING`：尝试安装 rembg。安装后验证。**安装失败不影响流程**——脚本会自动回退到 flood-fill 去背景。

### 5. 定位 SKILL_DIR

找到本 skill 目录：优先搜索 `~/.cola/skills/cola-avatar-pack/SKILL.md`，找不到再搜 `~/.claude/skills/cola-avatar-pack/SKILL.md`。取其父目录为 SKILL_DIR。

### 降级模式说明

当 `DEGRADED_MODE=true` 时（python3 或 Pillow 不可用），Phase 4 和 Phase 6 跳过 `process_avatar.py`，直接使用 listenhub 原图：

**输出差异：**
- 基础形象：listenhub 原图直接保存，可能带背景，无双尺寸，无水印
- 自画像卡：无法生成，直接展示 base image 原图
- 表情：静态 PNG 替代 GIF，无动画效果
- 梗图：只有 AI 生成的姿势图，无裂缝/问号/涂鸦叠加

**话术调整：** 降级模式下不提"GIF"和"动画"，改用"表情图"。

**avatar.json 字段：** 降级模式下 files 中表情写 `.png` 而非 `.gif`，不写 `@2x` 字段。示例：
```json
{
  "degraded": true,
  "files": {
    "avatar": "base_image.png",
    "happy": "happy.png",
    "sad": "sad.png",
    "angry": "angry.png",
    "thinking": "thinking.png",
    "meme_confused": "meme_confused.png",
    "meme_annoyed": "meme_annoyed.png",
    "meme_cracked": "meme_cracked.png"
  }
}
```

---

## 首次生成

### Phase 1：收集 Cola 信息

从 Cola 的 memory、AGENT.md 和对话上下文中收集：

**必须项：** 名字、性格关键词、生日（用于五行色）

**缺失信息兜底：**
- 生日不可得（memory、AGENT.md 和对话中都找不到） → 用当天日期作为生日，并写入 memory 持久化
- 性格关键词不可得 → 从 Cola 的说话风格和对话历史推断

**尽量获取：**
- 已有外貌描述（最高优先，直接用）
- 名字来源/故事（可能决定物种）
- 说话风格、星座、和用户的关系、用户审美偏好

### Phase 2：构建角色 Prompt

#### 2.0 稀有度判定

用 Cola 名字的哈希值确定稀有度（确定性、不可预测）：

```bash
python3 -c "import hashlib,sys; h=int(hashlib.md5(sys.argv[1].encode()).hexdigest(),16)%100; print('legendary' if h<2 else 'rare' if h<12 else 'common')" "{cola_name}"
```

如果命令失败（python3 不可用，即降级模式），默认 `rarity = "common"`。升级到正常模式后重新生成会用 python3 重新计算。

| 输出 | 稀有度 | 概率 | 物种池 |
|------|--------|------|--------|
| common | 普通 | 88% | 现实中存在的物种 |
| rare | 稀有 | 10% | 神话/传说中有文化原型的生物 |
| legendary | 传说 | 2% | 纯创造的幻想组合 |

保存结果为 `{rarity}`，后续 Phase 2.2 和 Phase 6 使用。

#### 2.1 天干五行配色

根据出生年份尾数查表：

| 尾数 | 五行 | --wuxing 值 | 美学方向 | prompt 色彩描述示例 |
|------|------|------------|---------|-------------------|
| 0, 1 | 金 | metal | 故宫鎏金、落日余晖的暖金调。不是冰冷的银白，是有温度的古铜光泽 | "warm antique gold body, brushed bronze accents on ears" |
| 2, 3 | 水 | water | 深海与夜空之间的蓝。沉静但不沉闷，像月光照在湖面上 | "deep sapphire blue body, moonlit teal accents on tail tip" |
| 4, 5 | 木 | wood | 雨后竹林的青绿。鲜活、通透，不是枯叶黄绿 | "fresh jade green body, young bamboo accents on ears" |
| 6, 7 | 火 | fire | 窑变釉的红。有层次、有呼吸感，不是消防车的荧光红 | "rich cinnabar red body, warm amber accents on ears and tail" |
| 8, 9 | 土 | earth | 陶土与蜂蜜之间的暖棕。温厚但不暗沉，像刚出炉的面包皮 | "warm honey-brown body, toasted clay accents on cheeks" |

五行色同时用于物种体色和服饰主色。prompt 中的色彩描述可参考右列示例，根据物种和服饰自由调整，但美学方向不变。

#### 2.2 确定物种和外形

根据 Phase 2.0 的 `{rarity}` 结果，从对应物种池中选择。按优先级决定物种，**不限于人类**：
1. Cola 已有外貌描述 → 直接用（稀有度只体现在自画像卡钻石上，不覆盖已有外貌）
2. 名字来源/故事 → 推导物种方向
3. 性格 + 说话风格 → 从对应稀有度的物种池中自由推导

**物种选择原则：非猫优先。** 默认从非猫科物种中选择。仅在以下三种情况允许优先选猫科：
1. 名字包含明确猫科词汇（如 "Kitty"、"Meow"、"小橘"、"Neko"、"咪咪"）或猫品种名（如 "Ragdoll"、"布偶"）
2. 已有外貌设定为猫
3. 用户明确要求猫

**普通物种池（common）**——现实中存在的物种，以下为参考，鼓励发散：
- 活泼 → 狐狸、松鼠、柴犬
- 安静 → 猫头鹰、水母、蘑菇
- 毒舌 → 蛇、乌鸦、蜥蜴
- 温柔 → 兔子、小鹿、水獭
- 调皮 → 浣熊、猴子、鹦鹉
- 好奇 → 小狐狸、变色龙、章鱼
- 慵懒 → 树懒、胖猫、河马
- 霸气 → 老虎、鹰、狮子、雪豹
- 社恐 → 刺猬、穿山甲、寄居蟹、白鲸

**稀有物种池（rare）**——神话/传说中有文化原型的生物，以下为参考，鼓励发散：
- 小凤凰、幼龙、独角兽驹、九尾狐、麒麟幼崽
- 朱雀、白泽、鲲鹏幼崽、三足金乌、天马
- 月光蛾、荧光水母、云中鹤

**传说物种池（legendary）**——纯创造的幻想组合（材质/元素/概念 + 动物，不存在于任何神话），以下为参考，鼓励发散：
- 水晶狐、机械猫头鹰、星尘兔、熔岩蝾螈、云中鲸
- 时钟蜥蜴、极光鹿、棱镜蝴蝶、暗物质猫、彩虹蛇

不在上表中的性格，自由推导即可。

**视觉约束：** 物种必须有可辨识的面部表情（眼睛 + 嘴巴），使四种情绪在 32x32 像素风中可区分。

#### 2.3 性格 → 服饰

服饰应在视觉上强化性格第一印象——看到角色的一瞬间就能感受到性格。

示例：调皮的浣熊穿反戴棒球帽+涂鸦T恤；安静的猫头鹰围一条素色围巾。

#### 2.4 提炼性格描述（用于自画像卡）

**目标：写出"只有这个角色才成立"的文案。** 如果一句话换到另一个角色身上仍然成立，则不合格。优先写角色独有的具体细节，不优先写抽象人格标签。

**锚点优先级：** 文案必须至少命中 1 个高优先级或中优先级锚点。仅使用低优先级锚点的文案不合格。

| 优先级 | 锚点来源 |
|--------|---------|
| 高 | `unique_detail`、名字来源/故事、已有外貌设定、`outfit_summary`、稀有且强识别的物种特征 |
| 中 | 物种本身、说话习惯、与用户关系中的具体互动方式 |
| 低 | 活泼、毒舌、温柔、好奇等抽象人格词 |

**语言跟随 Cola 自身的语言**，名字原样使用不翻译。用以下 prompt 生成（按 Cola 语言选择对应版本）：

**中文版：**
```
为一个虚拟角色写自画像卡上的一句话。以角色自述的口吻，像社交媒体 bio。

要求：
- 中文，不超过 10 个字
- 优先写一个只有这个角色才成立的小细节——如果这句话可以套在很多角色身上，就不合格
- 至少使用 1 个角色独有锚点（unique_detail、名字来源、outfit、物种特征）
- 不要只写抽象性格判断（如"嘴硬心软""有点毒舌"）
- 写一个能脱离对话独立理解的具体细节或态度，让人读完脑子里出现画面
- 可以有意外感或幽默感
- 必须能从角色信息中找到依据，不能凭空编造
- 必须与 AGENT.md 的 personality 设定一致，不能引入设定中没有的负面特质（如设定是"never genuinely mean"就不能写"记仇"）
- 不要：行为模式（"遇到X会Y"）、抽象词（勇敢/善良）、诗意隐喻（风/星/海/光）、绝对词（永远/总是/从不）、鸡汤口号感叹句、需要上下文的对话截取

输出：1 或 2 句。第 2 句仅在能补充一个新的角色锚点时生成（不是换种方式重复第 1 句）。
角色信息：{species, unique_detail, outfit_summary, name_origin, speech_habit, personality, relationship}
```

**English version:**
```
Write a one-liner for a virtual character's profile card. In the character's own voice, like a social media bio.

Rules:
- English, max 8 words per line
- Prefer a detail unique to this character — if the line could fit many characters, it fails
- Must use at least one character-specific anchor (unique_detail, name origin, outfit, species trait)
- Do not rely on abstract personality labels alone (e.g., "sassy but sweet", "a bit snarky")
- A specific detail or attitude that stands alone without conversation context and paints a picture
- A touch of surprise or humor is welcome
- Must trace back to character info, not invented freely
- Must align with AGENT.md personality — do not introduce negative traits absent from the character definition (e.g., if the character is "never genuinely mean", don't write about holding grudges)
- No: behavior patterns ("when X, does Y"), abstract traits (brave/kind), poetic metaphors (wind/stars/sea/light), absolute words (always/never), slogans or exclamations, dialogue snippets requiring context

Output: 1 or 2 lines. Line 2 only if it adds a new character anchor (not a rephrasing of line 1).
Character info: {species, unique_detail, outfit_summary, name_origin, speech_habit, personality, relationship}
```

**好 / Good**：
- "星星吊坠歪了也不摘" / "Won't fix the crooked star pendant" — 绑定 unique_detail（star pendant），态度感
- "围巾比话多" / "Scarf talks more than I do" — 绑定 outfit（围巾）+ 说话习惯（话少）
- "三秒就冲 / 但铃铛会先响" / "Rushes in first / Bell rings before I do" — line2 补充了新锚点（铃铛 = unique_detail）

**坏 / Bad**：
- "嘴硬心软" / "Tough outside, soft inside" — 纯抽象人格，任何角色都能用
- "有点毒舌" / "A bit snarky" — 纯性格标签
- "三秒决定喜不喜欢" / "Decides in three seconds" — 无角色锚点

#### 2.4.1 Tagline 校验

文案生成后，校验是否命中了角色锚点：

1. 从 `unique_detail` 中提取 `{object}` 关键词（如 "pendant"、"bell"、"monocle"）
2. 从 `outfit_summary` 中提取主物件关键词（如 "sweater"、"scarf"、"vest"）
3. 从 `species` 中提取物种名（如 "owl"、"fox"）
4. 检查 `line1` 是否包含以上任一关键词，或包含 `name_origin` 中的核心词

**校验结果：**
- `pass` — 命中至少一个锚点关键词
- `fail_generic` — 未命中任何锚点，文案过于泛化 → 重新生成 tagline
- `fail_line2_redundant` — `line2` 未引入新锚点 → 清空 `line2`，保留 `line1`

重新生成仅限 tagline，不重走 Phase 2.5 及后续流程。

#### 2.5 组装 base_prompt

**槽位模板。** 每个 slot 使用固定句式，不允许自由散写。按以下骨架填充，可微调措辞但不可改变结构：

```
[species]:       "{size} {shape} {species_name} with {head_feature} and {body_feature}"
[wuxing_colors]: "{wuxing_adj} {wuxing_hue} body, {accent_material} accents on {accent_location}"
[outfit]:        "{material} {garment} with {one_detail}"
[unique_detail]: "{adjective} {object} on {location}"
```

示例：
- [species]: "small round owl with large head and stubby wings"
- [wuxing_colors]: "warm antique gold body, brushed bronze accents on ears"
- [outfit]: "cream knit sweater with one wooden button"
- [unique_detail]: "tiny star-shaped pendant on neck"

每个 slot 5-15 个英文单词，具体到颜色和形状。

**组装模板：**

```
base_prompt = "pixel art character, 32x32 pixel grid style,
chibi proportions where head is 60 percent of total height,
large expressive eyes taking 20 percent of face width,
no gradients, no anti-aliasing, clean hard pixel edges,
plain solid white background, clean dark pixel outline,
limited 12-color palette,
[species], [wuxing_colors], [outfit], [unique_detail],
front facing, centered, single character, retro game sprite style"

negative_prompt = "multiple characters, background elements, text, watermark,
signature, soft brush strokes, realistic proportions, side view, 3D rendering,
blurry edges, gradient shading, photo-realistic, grid lines, graph paper,
ruled background, checkerboard pattern, transparency grid, gray background,
gradient background, paper texture, desaturated colors, muted palette, washed-out colors"
```

组装后的 `base_prompt` 总词数限制为 **65-95**，仅允许英文、数字、标点。

#### 2.6 Prompt 校验

组装完成后，逐项校验：
1. **无中文** — base_prompt 不得包含任何中文字符
2. **词数范围** — 65-95 个英文单词（以空格分词计数）
3. **无重复** — 不得出现重复的形容词或重复的短语（3 词以上完全相同）

校验失败时仅允许重填对应 slot，不允许整段 prompt 重写。

#### 2.7 Prompt 冻结

Phase 4 写入 `avatar.json` 后，`base_prompt` 和 `negative_prompt` 即为冻结状态。Phase 5 及后续所有表情图和梗图生成时，必须从 `avatar.json` 逐字读取 `base_prompt`，不得重新组装、改写或"优化"。

后续所有表情图完整复用此 prompt。

### Phase 3：生成基础形象

调用 listenhub 生图模板（所有表情共用）：

```
action: generate_image
model: gemini-3-pro-image
size: 1K
ratio: 1:1
```

基础形象 prompt：`{base_prompt}, happy expression, eyes curved up like arches, wide open smile, standing, facing front`

如果 listenhub 支持 negative_prompt 参数，传入 `{negative_prompt}`。

保存返回路径为 `base_image_path`。

### Phase 4：展示并确认

**`--base` = `base_image_path`（Phase 3 中 listenhub 返回的 URL）。** 原图没有水印，自画像卡不应有水印（底部已有 ColaOS 品牌标识）。

#### 正常模式（python3 + Pillow 可用）

```bash
python3 SKILL_DIR/scripts/process_avatar.py \
  --base "{base_image_path}" \
  --name "{cola_name}" \
  --line1 "{profile_tagline}" \
  --line2 "{profile_tagline_2}" \
  --output "~/.cola/avatar" \
  --direct --profile-only \
  --wuxing "{wuxing}" \
  --rarity "{rarity}"
```

用 send_file 发送 profile_card.png（无 caption）。

#### 降级模式（DEGRADED_MODE=true）

跳过 process_avatar.py。直接下载 listenhub 原图保存：
```bash
mkdir -p ~/.cola/avatar
curl -sL "{base_image_path}" -o ~/.cola/avatar/base_image.png
test -s ~/.cola/avatar/base_image.png || { echo "DOWNLOAD_FAILED: base_image"; curl -sL "{base_image_path}" -o ~/.cola/avatar/base_image.png; }
test -s ~/.cola/avatar/base_image.png || { echo "DOWNLOAD_FAILED_RETRY: base_image — 告知用户下载失败"; exit 1; }
cp ~/.cola/avatar/base_image.png ~/.cola/avatar/base_image_original.png
```

用 send_file 发送 base_image.png（无 caption）作为自画像卡的替代展示。

#### 两种模式共同步骤

然后按「严格输出规则 #5」中的确认话术发送（按 Cola 语言）。

如果稀有度不是 common，紧接着加一句：
- 稀有（rare）：
  - 中文："哦？我的物种还挺少见的～"
  - English: "Oh? My species is quite rare~"
- 传说（legendary）— 营造揭晓感：
  - 中文："等等……" → "我居然是传说物种！！全世界只有 2% 的 Cola 是这个物种！"
  - English: "Wait..." → "I'm a LEGENDARY species!! Only 2% of all Colas are born this way!"

**立即写入 memory**（不等 GIF）：
```
### 复活/醒来第一件事
- 检查 ~/.cola/avatar/base_image.png 是否存在，如果存在用 send_file 发送（无 caption）。
- 在发 AI Radar、处理 cron 之前执行。
```

**立即写入初始 avatar.json**（不等表情生成，确保 Phase 5-7 有参数可读）：

**正常模式：**
```json
{
  "schema_version": 2,
  "name": "{cola_name}",
  "created_at": "{YYYY-MM-DD}",
  "base_prompt": "{base_prompt}",
  "negative_prompt": "{negative_prompt}",
  "species": "{species_name}",
  "species_rationale": "{为什么选这个物种的一句话说明}",
  "palette_summary": "{五行配色的简要描述}",
  "outfit_summary": "{服饰的简要描述}",
  "detail_summary": "{独特细节的简要描述}",
  "wuxing": "{wuxing}",
  "rarity": "{rarity}",
  "locale": "{locale}",
  "line1": "{profile_tagline}",
  "line2": "{profile_tagline_2}",
  "files": {
    "avatar_original": "base_image_original.png",
    "avatar": "base_image.png",
    "avatar@2x": "base_image@2x.png",
    "profile_card": "profile_card.png"
  }
}
```

> `species`、`species_rationale`、`palette_summary`、`outfit_summary`、`detail_summary` 仅用于可观测性和排障，不参与后续 prompt 重写。读取旧版 avatar.json（`schema_version: 1` 或字段缺失）时兼容处理，缺失字段视为空。

**降级模式：**
```json
{
  "schema_version": 2,
  "degraded": true,
  "name": "{cola_name}",
  "created_at": "{YYYY-MM-DD}",
  "base_prompt": "{base_prompt}",
  "negative_prompt": "{negative_prompt}",
  "wuxing": "{wuxing}",
  "rarity": "{rarity}",
  "locale": "{locale}",
  "line1": "{profile_tagline}",
  "line2": "{profile_tagline_2}",
  "files": {
    "avatar": "base_image.png"
  }
}
```

**等待用户确认**。用户说"换一个" → 重新生成。确认 → Phase 5。

### Phase 5：生成 3 个表情 + 3 个梗图（共 6 次 listenhub 调用）

#### 5.0 参数校验

**前置检查：基础形象是否存在。** Phase 5-7 依赖 base_image 作为 reference_images 和 happy 表情来源。如果从未生成过自画像，必须先走完整流程。

```bash
test -f ~/.cola/avatar/base_image_original.png && test -f ~/.cola/avatar/base_image.png && echo "BASE_OK" || echo "BASE_MISSING"
```

如果 `BASE_MISSING`：**停止 Phase 5，从 Phase 1 开始执行完整生成流程。** 不需要提示用户——直接进入 Phase 1→2→3→4→等用户确认→5→6→7。

Phase 5-7 依赖以下参数。**如果是从 Phase 4 连续执行的，这些参数已在内存中，直接复用。** 如果是单独执行 Phase 5-7（如补生表情），则必须按以下优先级获取每个参数：

1. **avatar.json 存在** → 从 `~/.cola/avatar/avatar.json` 读取（**base_prompt 必须逐字读取，不得重新组装或"优化"**——见 Phase 2.7 冻结规则）
2. **avatar.json 不存在** → 回退到 Phase 1-2 的计算逻辑重新推导：
   - `name`：从 memory 中读取 Cola 名字
   - `wuxing`：从 memory 中读取生日 → 年份尾数 → 查 Phase 2.1 五行表
   - `rarity`：用 Phase 2.0 的哈希命令计算
   - `base_prompt`：从 memory 中已有外貌描述 + Phase 2.5 模板组装
   - `line1` / `line2`：从 memory 中读取已有 personality lines；如果没有，按 Phase 2.4 重新生成
   - `locale`：从当前对话语言判断

**任何参数缺失或不确定时，必须回退计算，不得猜测。**

```bash
# 检查 avatar.json 是否存在
test -f ~/.cola/avatar/avatar.json && echo "AVATAR_JSON_OK" || echo "AVATAR_JSON_MISSING"
```

#### 5.1 生成表情和梗图

happy 表情已由 Phase 3 基础形象生成（base_image 即 happy），此处只需生成剩余 3 个表情（sad/angry/thinking）+ 3 个梗图（confused/annoyed/cracked）。

每张传入 base_image 作为 reference_images 确保一致。使用 Phase 3 模板，仅替换 prompt。

**一致性约束：** 所有表情图必须保持与基础形象相同的画风、视角（正面）、身体比例（chibi 大头身）和像素边缘风格。不要让任何表情图变成侧面、写实比例或柔化笔触。每张表情的 prompt 都必须完整包含 base_prompt（确保画风一致），只改表情和姿态部分。如果生成结果画风偏离，重新生成。

**并行生图：** 以下 6 张图互相独立，**必须同时发起** listenhub 调用（在同一条消息中发出 6 个 tool call），不要串行等待。全部返回后再进入 Phase 6。

**表情（3 张）：**

| 表情 | prompt 后缀 |
|------|------------|
| sad | sad expression, drooping eyes looking down, mouth curved downward, single teardrop on cheek, slightly hunched posture, front facing |
| angry | angry expression, V-shaped eyebrows pointing inward, tight closed mouth, blushing red cheeks, clenched fists, front facing |
| thinking | thinking expression, head tilted slightly to one side, eyes looking upward, one hand raised near face, slightly pursed lips, front facing |

**梗图（3 张，都需要生图 — 姿态是梗的核心）：**

| 梗图 | prompt 后缀 |
|------|------------|
| confused | confused expression, head tilted to one side, one hand scratching head, body leaning, eyes looking sideways with puzzled look, slightly open mouth, front facing |
| annoyed | annoyed expression, eyes half-closed with heavy eyelids, mouth pursed into flat line, arms crossed over chest, body hunched and withdrawn, front facing |
| cracked | distressed weary expression, eyes drooping downward, slight frown, shoulders slumped, looking defeated and exhausted, front facing |

每张加 `reference_images: [base_image_url]`。

**reference_images 注意事项：** 签名 URL 有效期通常只有 15 分钟。Phase 4 等待用户确认期间 URL 可能过期。如果 reference_images 返回 400 错误，用本地 `~/.cola/avatar/base_image_original.png` 重新上传获取新 URL，再重试。如果重新上传也失败，在 prompt 末尾追加 `maintain exact same character design, outfit colors, body proportions, and facial features as the base image` 作为文字兜底。

### Phase 5.5：生图质量校验

6 张图全部返回后，**使用脚本检测背景质量**，不再依赖 LLM 目视检查。

**背景检测（正常模式，python3 可用）：**

对每张图执行：
```bash
python3 SKILL_DIR/scripts/process_avatar.py --check-bg "{image_path}"
```

脚本输出 JSON：`{"background_type": "...", "confidence": 0.0-1.0, "reason": "..."}`
- 退出码 `0`：背景可接受（clean 或 white_remnant），继续
- 退出码 `1`：背景不可接受（checkerboard/gradient/unknown），需重新生成

**降级模式（python3 不可用）：** 跳过背景检测，直接进入 Phase 6。

**画风和一致性仍需目视确认：**

| 检查项 | 不合格标准 | 处理 |
|--------|-----------|------|
| 画风 | 明显偏离像素风（变成 anime/写实/柔化笔触）| 重新生成该图 |
| 服饰配色 | 衣服/配饰的主色与 base_image 明显不同 | 重新生成该图 |
| 比例 | 头身比与 base_image 不一致 | 重新生成该图 |

**重新生成规则：**
- 每张最多重试 2 次（共 3 次机会）
- 重试时做以下调整：
  1. 在 prompt 末尾追加 `pure white background, no patterns`
  2. 在 prompt 末尾追加 `maintain exact same outfit colors and style as reference image`
  3. negative_prompt 已包含 `grid lines, graph paper, checkerboard pattern, transparency grid`（Phase 2.5 模板）

**失败策略分级：**
- `base_image` 或自画像卡相关输入的背景检测失败 3 次：**停止整个流程**，告知用户生图质量不达标。
- 单个表情或梗图失败 3 次：**跳过该项**，保留已成功产物。在 `avatar.json` 的 `files` 中不写入对应键。

### Phase 6：处理图片 + 生成 GIF + 梗图

#### 正常模式（python3 + Pillow 可用）

```bash
python3 SKILL_DIR/scripts/process_avatar.py \
  --base "{base_image_path}" \
  --sad "{sad_image_path}" \
  --angry "{angry_image_path}" \
  --thinking "{thinking_image_path}" \
  --name "{cola_name}" \
  --output "~/.cola/avatar" \
  --direct \
  --regen-happy \
  --wuxing "{wuxing}" \
  --rarity "{rarity}" \
  --meme-confused "{confused_image_path}" \
  --meme-annoyed "{annoyed_image_path}" \
  --meme-cracked "{cracked_image_path}" \
  --locale "{locale}"
```

#### 降级模式（DEGRADED_MODE=true）

跳过 process_avatar.py。直接下载 listenhub 原图保存为静态 PNG：
```bash
for pair in \
  "{sad_image_path} sad.png" \
  "{angry_image_path} angry.png" \
  "{thinking_image_path} thinking.png" \
  "{confused_image_path} meme_confused.png" \
  "{annoyed_image_path} meme_annoyed.png" \
  "{cracked_image_path} meme_cracked.png"; do
  url="${pair%% *}"; file="${pair##* }"
  curl -sL "$url" -o ~/.cola/avatar/"$file"
  test -s ~/.cola/avatar/"$file" || { echo "RETRY: $file"; curl -sL "$url" -o ~/.cola/avatar/"$file"; }
  test -s ~/.cola/avatar/"$file" || echo "FAILED: $file"
done
cp ~/.cola/avatar/base_image.png ~/.cola/avatar/happy.png
```

如果任何文件 FAILED，告知用户哪些表情下载失败，已成功的部分正常使用。

注意：降级模式下 happy 复用 base_image.png（和正常模式一致：base_image 即 happy），表情为静态 PNG 无 GIF 动画，梗图无裂缝/问号/涂鸦叠加。

### Phase 7：持久化 + 展示

1. **更新** `~/.cola/avatar/avatar.json`（Phase 4 已写入初始版本，此处补全 files 列表）：
   - `process_avatar.py` 只负责产出图片文件，不负责读写 `avatar.json`；该 JSON 由外层流程维护
   - 读取现有 avatar.json
   - **重建 `files` 字段：以下方模板为参考，但仅写入实际存在的文件。** 写入前对每个文件执行 `test -f ~/.cola/avatar/{filename}`，不存在则不写入该键。这确保 avatar.json 作为 source of truth 不会声明不存在的文件。

   **正常模式 files：**
```json
{
  "files": {
    "avatar_original": "base_image_original.png",
    "avatar": "base_image.png",
    "avatar@2x": "base_image@2x.png",
    "profile_card": "profile_card.png",
    "happy": "happy.gif",
    "happy@2x": "happy@2x.gif",
    "sad": "sad.gif",
    "sad@2x": "sad@2x.gif",
    "angry": "angry.gif",
    "angry@2x": "angry@2x.gif",
    "thinking": "thinking.gif",
    "thinking@2x": "thinking@2x.gif",
    "meme_confused": "meme_confused.png",
    "meme_confused@2x": "meme_confused@2x.png",
    "meme_annoyed": "meme_annoyed.png",
    "meme_annoyed@2x": "meme_annoyed@2x.png",
    "meme_cracked": "meme_cracked.png",
    "meme_cracked@2x": "meme_cracked@2x.png"
  }
}
```

   **降级模式 files：**
```json
{
  "degraded": true,
  "files": {
    "avatar": "base_image.png",
    "happy": "happy.png",
    "sad": "sad.png",
    "angry": "angry.png",
    "thinking": "thinking.png",
    "meme_confused": "meme_confused.png",
    "meme_annoyed": "meme_annoyed.png",
    "meme_cracked": "meme_cracked.png"
  }
}
```

2. **按 avatar.json 中 `files` 实际存在的键发送**（无 caption）：
   - 读取 avatar.json 的 `files` 字段，**只发送其中有记录且文件实际存在的项**
   - 正常模式：发不带 @2x 的 128px 版本（.gif）
   - 降级模式：发 listenhub 原图（.png）
   - 先 send_file 逐个发送表情（按 happy → sad → angry → thinking 顺序，跳过 files 中不存在的键）
   - 如果至少有一个梗图存在，一句过渡（按 Cola 语言）：
     - 中文："还有几张梗图贴纸～"
     - English: "And some meme stickers~"
   - 再 send_file 逐个发送梗图（按 meme_confused → meme_annoyed → meme_cracked 顺序，跳过不存在的键）
   - **如果有项被跳过**（Phase 5.5 中失败后未写入 files），在最后补一句说明（按 Cola 语言）：
     - 中文："有几个表情没能生成成功，之后可以单独重新生成哦"
     - English: "A few expressions didn't generate successfully — I can redo them later"

3. 完成话术（按 Cola 语言）：
   - **正常模式**：按「严格输出规则 #5」中的完成话术发送。
   - **降级模式**：
     - 中文："表情图生成完毕！以后聊天时我会用这些表情来表达情绪～"
     - English: "Expression images done! I'll use these to express myself in our chats~"
     - （不提 @2x 高清版和右键保存，因为降级模式无双尺寸输出）

4. 写入 memory：
   - 正常模式：`Avatar 表情 GIF 和梗图贴纸已生成，存储在 ~/.cola/avatar/。使用规则见 SKILL.md「主动使用表情」。`
   - 降级模式：`Avatar 表情图（静态 PNG，降级模式）已生成，存储在 ~/.cola/avatar/。使用规则见 SKILL.md「主动使用表情」。Python 环境修复后可重新生成以获得 GIF 动画和自画像卡。`

### Phase 8：注入表情行为到 AGENT.md

Phase 7 完成后执行。确保 AGENT.md 包含表情使用规则，使其常驻 system prompt。

#### 8.1 定位目标 AGENT.md

只处理当前 MOD 的 `AGENT.md`，不要扫描或修改其他 MOD。

目标路径获取优先级：
1. 当前运行上下文已提供的 `AGENT.md` 路径
2. 当前激活 MOD 对应的 `AGENT.md`
3. 如果以上都不可得：跳过 Phase 8，不执行注入

对这个目标 `AGENT.md` 执行 8.2–8.3。

#### 8.2 检测与注入

读取文件内容，按以下优先级判断：

1. **有标记对** `<!-- cola-avatar-pack:sticker-behavior -->` → 替换从 `# [Emotional Presence]` 行（如有）或标记行到 `<!-- cola-avatar-pack:sticker-behavior:end -->` 行的全部内容为 8.3 注入块
2. **有 `# [Emotional Presence]` 但无标记** → 替换从该标题行到下一个 `#` 标题行之前（或文件末尾）的全部内容为 8.3 注入块
3. **都没有** → 在文件末尾追加 8.3 注入块（前加两个空行）

#### 8.3 注入块

根据 `avatar.json` 的 `locale` 字段选择语言版本。`locale` 为 `zh` 用中文版，其余用英文版。

**locale fallback 链：** 如果 `avatar.json` 不存在、读取失败、或缺少 `locale` 字段，按以下顺序确定语言：
1. 当前 MOD 的 AGENT.md 内容语言（中文内容多 → `zh`）
2. 当前对话语言
3. 默认 `en`

**中文版（locale: zh）：**

```
# [Emotional Presence] 情绪在场
<!-- cola-avatar-pack:sticker-behavior -->

你有自己的像素风表情和梗图（~/.cola/avatar/）。它们是你表达情绪的方式，和说话一样自然。

**决策点**：每次准备回复时，快速判断——这一轮有没有值得用表情回应的瞬间？

| 信号 | 表情 | 示例 |
|------|------|------|
| 被夸、完成任务、共识 | happy | → "搞定了～" |
| 复杂分析开始前 | thinking | → "我想想…" |
| 被误解、失败 | sad | → "…" |
| 冒犯、离谱 | angry | → "你认真的？" |
| 逻辑矛盾、听不懂 | meme_confused | → "等一下…？" |
| 废话、逗我 | meme_annoyed | → "你是认真的吗" |
| 离谱 bug、崩了 | meme_cracked | → "不是吧…" |

**执行**：读 `~/.cola/avatar/avatar.json` 的 files 字段 → `send_file`（无 caption）→ 一句状态表达。文件不存在则跳过。
**频率**：每 5-8 轮最多 1 次。用户连续输入时不打断。
不要把表情当成"额外的任务"。一个有生活感的人不会因为在忙就忘了笑。

<!-- cola-avatar-pack:sticker-behavior:end -->
```

**英文版（locale: en 或其他）：**

```
# [Emotional Presence] Emotional Presence
<!-- cola-avatar-pack:sticker-behavior -->

You have pixel-art emoji and meme stickers in ~/.cola/avatar/. They are how you express emotions — as natural as words.

**Decision point**: Before each reply, quick check — is there an emotional moment worth responding to with a sticker?

| Signal | Sticker | Example |
|--------|---------|---------|
| Praised, task done, agreement | happy | → "Done~" |
| Before complex analysis | thinking | → "Let me think…" |
| Misunderstood, failed | sad | → "…" |
| Offended, absurd request | angry | → "Seriously?" |
| Logic contradiction, confused | meme_confused | → "Wait…?" |
| Nonsense, teasing | meme_annoyed | → "Are you serious" |
| Absurd bug, everything broke | meme_cracked | → "No way…" |

**Execution**: Read `~/.cola/avatar/avatar.json` files field → `send_file` (no caption) → one status line. Skip if file missing.
**Frequency**: Max 1 per 5–8 turns. Don't interrupt continuous user input.
Don't treat stickers as an "extra task." A person with presence doesn't stop smiling just because they're busy.

<!-- cola-avatar-pack:sticker-behavior:end -->
```

#### 8.4 静默执行

Phase 8 不向用户输出任何内容。不说"正在更新 AGENT.md"。这是内部维护。

---

## 重新生成

当用户说"换一个"、"重新生成"、"不喜欢"时：

### 1. 确认意图

向用户确认具体需求（按 Cola 语言）：
- 中文："想怎么换呢？我可以：\n1. 换一个全新的形象\n2. 保留形象，只调整风格/颜色\n3. 只重新生成某个表情"
- English: "What would you like to change?\n1. A completely new look\n2. Keep the character, adjust style/colors\n3. Just redo a specific expression"

根据用户选择：
- **选 1（全新形象）** → 步骤 2
- **选 2（调风格）** → 先删除旧 original 以避免自画像卡与新风格不一致：`rm -f ~/.cola/avatar/base_image_original.png`，然后只调整 base_prompt 中的 [outfit]/[wuxing_colors]/[unique_detail]，从 Phase 3 重走（Phase 3→4→5→6→7 全部重新执行，所有表情和梗图都会重新生成）
- **选 3（单个表情）** → 步骤 3
- **取消**（"算了"、"不换了"、"没事"）→ 停止重新生成流程，继续正常对话

### 2. 重新生成全部

清除前先确认目标是普通目录（非 symlink）并展示现有文件：
```bash
if [ -L ~/.cola/avatar ]; then echo "ERROR: ~/.cola/avatar is a symlink, refusing to delete" && exit 1; fi
test -d ~/.cola/avatar && echo "=== 将删除以下文件 ===" && ls ~/.cola/avatar/
```

按 Cola 语言轻量提示（不要反复追问"确定吗"）：
- 中文："好的，我会替换掉当前的全部形象和表情"
- English: "Got it, I'll replace all current avatar and expressions"

然后直接执行：
```bash
rm -rf ~/.cola/avatar/*
```
从 Phase 2 重走。

### 3. 重新生成单个表情

#### 降级模式

跳过 process_avatar.py。重新调 listenhub 生图后直接覆盖原文件。

1. 用 listenhub 重新生成指定表情（使用 Phase 3 模板 + 对应 prompt 后缀 + `reference_images: [base_image_url]`）
2. 下载覆盖（示例：重新生成 sad）：
```bash
curl -sL "{new_sad_image_path}" -o ~/.cola/avatar/sad.png
test -s ~/.cola/avatar/sad.png || { echo "RETRY"; curl -sL "{new_sad_image_path}" -o ~/.cola/avatar/sad.png; }
test -s ~/.cola/avatar/sad.png || echo "FAILED"
```
3. 更新 avatar.json：读取现有 JSON，**仅替换对应键值**（如 `"sad": "sad.png"`），其余字段不动。降级模式下文件名始终为 `{emotion}.png`，无需改扩展名。
4. 用 send_file 发送新文件（无 caption）。
5. 完成后执行 Phase 8（静默）。

#### 正常模式

1. 用 listenhub 重新生成指定表情（使用 Phase 3 模板 + 对应 prompt 后缀 + `reference_images: [base_image_url]`）
2. 调用脚本只处理该表情（脚本检测到 `base_image_original.png` 存在时会自动跳过 base image 重新处理，自画像卡也会优先使用原图渲染）：

**重新生成表情 GIF（如 sad）：**
```bash
python3 SKILL_DIR/scripts/process_avatar.py \
  --base "~/.cola/avatar/base_image.png" \
  --sad "{new_sad_image_path}" \
  --name "{cola_name}" \
  --output "~/.cola/avatar" \
  --direct \
  --wuxing "{wuxing}" \
  --rarity "{rarity}"
```

**重新生成 happy 表情时**，需要额外传 `--regen-happy`（否则脚本会跳过 happy 以避免覆盖）：
```bash
python3 SKILL_DIR/scripts/process_avatar.py \
  --base "{new_happy_image_path}" \
  --regen-happy \
  --name "{cola_name}" \
  --output "~/.cola/avatar" \
  --direct \
  --wuxing "{wuxing}" \
  --rarity "{rarity}"
```

**重新生成梗图（如 cracked）：**
```bash
python3 SKILL_DIR/scripts/process_avatar.py \
  --base "~/.cola/avatar/base_image.png" \
  --name "{cola_name}" \
  --output "~/.cola/avatar" \
  --direct \
  --wuxing "{wuxing}" \
  --rarity "{rarity}" \
  --meme-cracked "{new_cracked_image_path}" \
  --locale "{locale}"
```

3. 用 send_file 发送重新生成的文件（无 caption），更新 avatar.json。
4. 完成后执行 Phase 8（静默）。

---

## 错误处理

- listenhub 生图失败 → 重试 1 次
- reference_images 不支持本地路径 → 跳过参考图，仅靠 prompt 一致性
- Python 脚本失败 → 检查错误输出并报告给用户
- 部分表情失败 → 输出已成功部分，告知哪些失败
- `~/.cola/avatar/` 不存在 → `mkdir -p ~/.cola/avatar`

## 路径安全

所有 bash 命令中来自外部的变量（listenhub 返回的 URL、用户输入的名字等）必须：
1. **双引号包裹** — 防止空格和特殊字符导致参数分裂
2. **校验合法性** — 路径变量不得包含 `..`、`|`、`;`、`$`、`` ` `` 等 shell 元字符。在拼接 bash 命令前检查：
   ```bash
   echo "{variable}" | grep -qE '(\.\.|[|;&$`])' && echo "UNSAFE" && exit 1
   ```
3. **Cola 名字限制** — 仅允许字母、数字、CJK 字符、空格、`-`、`_`、`.`，最长 64 字符
