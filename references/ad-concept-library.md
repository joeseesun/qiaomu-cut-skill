# 宣传片创意库（每支片一个独立创意）

来源：2026-09-29 用户反馈「四个插件的宣传片风格都一样」后，对 Apple 及同类大厂宣传片手法的调研与实做（Reader / RSS / 电台 / Agent 四支）。调研依据见文末。

## 0. 铁律：先选创意，再写代码

- **一支片一个创意（concept）。** 品牌色、字体、镜头、配乐、结构里，至少有五项和同批其他片不同。只换配色和文案不算不同。
- 同一批（同一个项目、同一次请求）做多支片时，**禁止共用一套骨架**（同样的封面—钩子—圆形展开—四个功能段—信任句—片尾）。共用的只能是工具，例如 motion kit、音效合成器、渲染管线；不能是结构。
- 创意写进 `motion-brief.json` 的 `concept`，`qcut motion check` 检查是否写完，`qcut motion diversity <项目...>` 检查一批片是否真的不同。

## 1. concept 字段

```json
"concept": {
  "archetype": "silhouette-dance",           // 见 §2，同批不可重复
  "reference": "Apple iPod「剪影」广告",       // 必须点名一个真实的广告/片子，不能写“高级感”
  "device": "六个频道=六种纯色+六种舞步",       // 一句话：全片反复出现的那个“机关”
  "tempo": 128, "time": "4/4",
  "musicStyle": "funk-house",                // 同批不可重复
  "typeStyle": "rounded-YuantiSC",           // 同批不宜重复
  "palette": ["#FFD500", "#FF2D78", "#111"],
  "camera": "机位不动，逐拍硬切，一次3D转身",
  "structure": "四个频道单人舞 → 分屏 → 六宫格 → 产品镜头 → 写作侧影 → 快切 → 白底收束",
  "duration": 31
}
```

## 2. 原型库（archetype）

| archetype | 参考 | 机关（device） | 镜头 | 配乐 | 字体/色 | 适合 |
| --- | --- | --- | --- | --- | --- | --- |
| `manifesto-typography` | Apple「Think Different」、Apple Books | 一支荧光笔/一个符号贯穿全片；排版即主张 | 连续慢推、失焦-对焦叠化 | 独奏钢琴、三拍子、无鼓 | 衬线、纸色+墨黑+一个强调色 | 阅读、写作、笔记、需要“安静”的产品 |
| `kinetic-typography` | Nike 动态字体、Spotify Wrapped | 一个数字狂飙 → 突然静音 → 反转 | 每拍硬切、弹簧砸字、甩镜、速度斜坡 | 140+ BPM 强节奏电子/808 | 特粗黑体、全屏色块（2–3 色） | 信息过载、效率、订阅流、数据 |
| `silhouette-dance` | Apple iPod「剪影」广告 | 纯色背景+黑色剪影+唯一的白色耳机线，卖情绪 | 机位不动，逐拍硬切，分屏/宫格 | 放克/house/摇滚，可跳舞 | 圆体、六种饱和纯色 | 音乐、声音、情绪、生活方式 |
| `spatial-flight` | Apple Vision Pro 发布片 | 玻璃面板悬浮在空间里，一镜到底的飞行 | 连续镜头、视差、景深 | 电影氛围、心跳低频、无鼓 | 极细体、深空紫黑+一个荧光色 | AI、agent、知识库、“空间”概念 |
| `product-hero` | Apple 产品特写片 | 一个物件被光慢慢扫过，零装饰 | 极慢环绕/推近，微距 | 极简合成器、留白 | 无衬线细体、黑/白 | 有实体感的工具、硬件 |
| `before-after` | Apple Photos/Camera 对比片 | 同一画面左右/前后切换 | 硬切或擦除 | 短促、上扬 | 大字对比 | 修复、改写、效率提升 |
| `one-day` | Apple「A Day in the Life」、Google「Year in Search」 | 一天中的几个时刻 | 时间轴推进 | 民谣/原声吉他 | 手写体、暖色 | 生活工具、习惯类 |
| `user-story` | Apple「Shot on iPhone」 | 用户作品当主角，产品退到脚注 | 作品全屏、署名 | 与作品匹配 | 极简署名 | 有用户作品/案例的产品（需真实素材） |

原型不够用时新增一行再用，不要为了“不重复”硬拼。

## 3. 差异矩阵（做批量前先填）

| 维度 | A | B | C | D |
| --- | --- | --- | --- | --- |
| archetype |  |  |  |  |
| reference |  |  |  |  |
| 机关 device |  |  |  |  |
| 节拍/拍号 |  |  |  |  |
| 配乐风格 |  |  |  |  |
| 字体 |  |  |  |  |
| 主色/背景 |  |  |  |  |
| 镜头语言 |  |  |  |  |
| 结构 |  |  |  |  |
| 时长 |  |  |  |  |

同一列里，archetype、配乐风格、结构不能相同；字体、主色、镜头语言最多一对相近；时长要有长有短。

## 4. 选原型的判断

1. 先问“这个产品让人**感觉**到什么”，再问“它有什么功能”。Apple 卖情绪、卖结果，不卖功能列表；`selling the outcome` 比 `demo` 转化更好。
2. 产品像什么，就借什么广告：安静的书 → 文学宣言；信息洪流 → 动态字体；声音 → 剪影；AI/空间 → 空间飞行。
3. 有真实截图就让它当主角（放大、失焦、聚焦），没有真实素材时用产品自己的源码/配色/文案在画面里重建，并在画面上标注“界面演示”。
4. 每支片只有一个机关，其余功能服务于它；宁可少讲两个功能。
5. 封面（第 0 帧）也要属于这个创意：文字排版片用大字，剪影片用剪影，空间片用光点，见 `cover-thumbnail-method.md`。

## 5. 配乐与声音也必须分开

- 每支片单独写配乐脚本，不共用同一个 `score.py`；节拍、拍号、乐器、织体都要变（钢琴华尔兹 / 808 强节奏 / 放克 house / 无鼓氛围）。
- 音效按创意做质感：纸与荧光笔、重击与甩镜、模拟电台与响指、玻璃与深空低频。

## 6. 验收

```bash
qcut motion check <project>                 # concept 写完整、封面写完整
qcut motion diversity <p1> <p2> <p3> <p4>   # 同批片是否真的不同
```

`diversity` 会阻断：archetype 相同、配乐风格相同、结构相同、reference 缺失或雷同；会警告：字体相同、节拍接近（±8 BPM）、主色相近、镜头描述相同。

## 来源

- Apple iPod「剪影」：纯色背景、黑色剪影、白色耳机线、可跳舞的音乐，“卖情绪”。https://en.wikipedia.org/wiki/IPod_advertising ；https://www.mbaknol.com/management-case-studies/case-study-apple-ipod-silhouette-ad-campaign/
- Apple「Think Different」：极简排版，靠字距、字重、对齐建立节奏。https://simplyadtype.wordpress.com/2021/11/12/apple-motion-typography/
- Apple「Shot on iPhone」：用户作品当主角。https://www.adsoftheworld.com/campaigns/shot-on-iphone
- 发布片原则：卖结果不卖演示；动态字体+高对比色块；Nike 3D 变形转场。https://www.flowjam.com/blog/30-best-launch-video-examples-checklist ；https://vidico.com/news/best-product-launch-videos/
