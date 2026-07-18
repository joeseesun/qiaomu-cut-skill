# Image Prompt Guide

## Writing Good Prompts

### Structure

A good image prompt has these elements (in any order):

1. **Subject**: What is in the image (person, object, scene)
2. **Style**: Art style or visual treatment
3. **Composition**: How elements are arranged
4. **Lighting/Mood**: Time of day, atmosphere
5. **Quality modifiers**: Detail level, rendering quality

### Examples

**Basic**: "a cat sitting on a windowsill"

**Better**: "a fluffy orange tabby cat sitting on a sunny windowsill, warm afternoon light, cozy interior, highly detailed, photorealistic"

**Advanced**: "a fluffy orange tabby cat sitting on a vintage wooden windowsill, golden hour sunlight streaming through lace curtains, dust particles visible in light beams, bokeh background of a garden, photorealistic, 8K quality, cinematic composition"

## Style Keywords

| Style | Keywords to add |
|-------|----------------|
| Photorealistic | photorealistic, highly detailed, 8K, professional photography |
| Cyberpunk | neon lights, futuristic, dystopian, rain-slicked streets |
| Ink painting | Chinese ink painting, traditional art style, brush strokes |
| Watercolor | watercolor painting, soft edges, flowing colors |
| Anime | anime style, Japanese animation, cel shading |
| Oil painting | oil painting, thick brushstrokes, rich colors, canvas texture |
| Minimalist | minimalist, clean lines, simple composition, white space |
| Vintage | vintage, retro, film grain, muted colors, 1970s |

## Composition Tips

- "close-up" / "portrait" for face/detail shots
- "wide angle" / "panoramic" for landscapes
- "top-down" / "bird's eye view" for overhead shots
- "cinematic composition" for movie-like framing
- "centered" / "rule of thirds" for specific placement

## Using Reference Images

Reference images guide the AI on style, not content. Tips:

- Use reference images for style transfer: "generate in this art style"
- Two modes available:
  - **URL mode**: Direct image URLs (`.jpg`, `.png`, `.webp`, `.gif`)
  - **Local file mode**: Provide file paths — the agent encodes them as base64 (`.jpg`, `.png`, `.webp`, `.heic`, `.heif`)
- Max 14 reference images per request
- The prompt still controls the content; references control the visual style
- For URL mode, recommended image hosts: imgbb.com, sm.ms, postimages.org, imgur.com

## Language Note

Always write prompts in **English** — the image generation model is trained on English descriptions. If the user provides a Chinese prompt, translate it to English before submitting.
