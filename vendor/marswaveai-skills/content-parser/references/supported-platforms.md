# Supported Platforms

## URL Patterns

| Platform | URL Pattern | Content Types |
|----------|-------------|---------------|
| YouTube | `youtube.com/watch?v=`, `youtu.be/` | Video transcripts |
| Bilibili | `bilibili.com/video/` | Video transcripts |
| Twitter/X | `twitter.com/`, `x.com/` | Profile tweets, single tweets |
| WeChat | `mp.weixin.qq.com/s/`, `mp.weixin.qq.com/s?__biz=` | Public articles |
| PDF | Direct `.pdf` URL | Document text |
| DOCX | Direct `.docx` URL | Document text |
| Images | Direct image URL (`.jpg`, `.png`, etc.) | Image description/OCR |
| General web | Any HTTP(S) URL | Article text, blog posts |

## URL Normalization

Before submitting URLs to the API:

- `youtu.be/XXX` → `https://www.youtube.com/watch?v=XXX`
- Ensure URLs start with `https://` (upgrade `http://` if needed)
- Strip tracking parameters when obvious (e.g., `utm_*`, `vd_source=`)
- Bilibili: keep the `BV` ID, strip query params

## Content Type Detection

The parser identifies content type based on:
1. URL domain (platform recognition)
2. File extension (PDF, DOCX, image formats)
3. Page structure (article vs. thread vs. video)
4. Metadata (og:type, schema.org)

## Limitations

- Paywalled content may not be accessible
- JavaScript-rendered content may be partially extracted
- Rate limits apply per the standard API limits
- Very long content may be truncated
- Some platforms may block automated access
- Twitter/X: profile pages and single tweets are supported

## Platform-Specific Notes

### YouTube
- Extracts video transcript/subtitles when available
- Falls back to video description if no transcript
- Supports standard and shortened URLs

### Bilibili
- Extracts video description and metadata
- Supports BV-format video IDs

### Twitter/X
- Extracts profile tweets or single tweet content
- For profile URLs, use `options.twitter.count` to control how many tweets to fetch (1-100, default 20)
- Supports both `twitter.com` and `x.com` domains

### WeChat
- Extracts article content from public account posts
- Supports both short (`/s/XXX`) and long (`/s?__biz=`) URL formats

### Documents (PDF, DOCX)
- Extracts text content from document files via direct URL
- Works with publicly accessible file URLs (e.g., Google Cloud Storage)

### Images
- Processes image content from direct URLs
- Supported formats: JPEG, PNG, GIF, WebP, BMP

### Web Articles
- Extracts main article body using content extraction
- Removes navigation, ads, sidebars
- Preserves headings and paragraph structure
