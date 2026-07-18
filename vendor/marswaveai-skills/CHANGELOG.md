# Changelog

## [1.3.0] - 2026-06-25

### Enhancement

**Added:**
- `video-gen/` — PixVerse as a third model family (`listenhub openapi video pixverse generate`). Nine atomic capabilities: text_to_video, image_to_video, transition, multi_transition, fusion, restyle, mimic, lip_sync, agent. Introduces **lip sync** (PixVerse-only, audio or TTS), mimic (locked 720p), the marketing agent (ad_master/promo_mix, 720p/1080p + 20/30/60), and fusion `@refName` prompt syntax.
- `video-gen/references/pixverse-api.md` — dedicated PixVerse reference (capability list, capability→flag mapping, per-capability parameter tables, constraints, output format).
- `video-gen/SKILL.md` — Step 3d lip-sync collection block, PixVerse command templates (generate + estimate), PixVerse option in the model picker, PixVerse examples, Lipsync row in the Model Comparison table.

**Changed:**
- `listenhub/SKILL.md` + `listenhub-cli/SKILL.md` — added `pixverse`, `口型`, `lipsync`, `对口型` trigger words routing to `/video-gen`.
- `video-gen/SKILL.md` — corrected SeeDance rate limit to 5 RPM (was stale at 2; aligned with HappyHorse via #243).

## [1.2.0] - 2026-05-20

### New Skill

**Added:**
- `video-gen/` — AI video generation via SeeDance (text-to-video, first/last frame animation, reference-guided generation with images/video/audio). Requires `listenhub-cli` with `video` subcommand (not yet in published 0.1.0 — skill gates gracefully at runtime).

**Changed:**
- `listenhub/SKILL.md` — Added video-gen route to router
- `listenhub-cli/SKILL.md` — Added video-gen route to router

## [1.1.0] - 2026-04-07

### New Skill

**Added:**
- `cola-avatar-pack/` — Generate Cola pixel-art avatar, profile card, 4 emoji GIFs (happy/sad/angry/thinking) and 3 meme stickers (confused/annoyed/cracked)

## [1.0.0] - 2026-03-04

### Architecture Migration (Phase 1)

Decomposed the monolithic `listenhub` skill into individual, focused skills with shared infrastructure.

**Added:**
- `shared/` — Centralized API reference, authentication guide, and common patterns
- `podcast/` — Podcast generation skill (solo, dialogue, debate modes)
- `explainer/` — Explainer video skill (info and story styles)
- `speech/` — Text-to-speech skill (FlowSpeech + multi-speaker Speech)
- `image-gen/` — AI image generation skill (Labnana API)
- `content-parser/` — URL content extraction skill
- `CHANGELOG.md` — This file

**Removed:**
- `listenhub/scripts/` — All shell scripts (replaced by curl-from-docs pattern)
- `listenhub/VERSION` — No longer needed
- `listenhub/SKILL.md` — Replaced by individual skill files

**Changed:**
- API interaction model: from shell script execution to curl commands constructed from `shared/api-reference.md`
- Parameter collection: all enumerable params now use AskUserQuestion interactive prompts
- `listenhub/` now contains only `DEPRECATED.md` pointing to new skills
- Flattened directory structure: skills now live at repo root instead of under `skills/` subdirectory
- `README.md` and `README.zh.md` updated with new skill matrix and directory structure

**Issue:** [MARS-3517](https://linear.app/marswave/issue/MARS-3517)
