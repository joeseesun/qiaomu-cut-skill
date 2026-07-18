# ListenHub Integration Trust Report

Date: 2026-07-19
Mode: Governed
Owner: 向阳乔木

## input_files

- `vendor/marswaveai-skills/` — exact upstream Git-tracked snapshot.
- `vendor/marswaveai-skills.UPSTREAM.lock.json` — repository, commit, tree, license and content digest.
- `references/listenhub-provider.md` — normalized qiaomu-cut provider contract.
- `scripts/adapters/listenhub.js` — runtime gates, redaction, capability detection and private capture.
- `scripts/fetch_generated.js` and `scripts/ingest_asset.js` — local asset boundary.

## output contract

1. Packaged commands must not accept or emit long-lived provider credentials; API keys, bearer/JWT values and generic token/password/cookie/credential fields may not enter source, captures, public output, manifests or Git. Short-lived generated-media URLs may exist only in mode-0600 private captures until fetched.
2. Remote creation requires per-request `--yes` and a QiaoCut project.
3. Local uploads require a separate `--allow-upload` and project-relative regular files.
4. Provider output is captured privately, then downloaded and verified before timeline use.
5. Generated assets record provenance and remain separate from timeline attachment.
6. Final video continues through preview/final rendering and `reports/output_quality_scorecard.md`.
7. Explainer narration prefers the exact authorized speaker name `向阳乔木`; zero/ambiguous/unauthorized matches never silently substitute another voice.
8. Generated-image style is derived per project and held consistent by a visual bible, not a hard-coded universal style.

## Evidence

- `file-backed fixture`: 78 upstream entries, 71 files, 7 internal symlinks, 1,675,008 bytes.
- Upstream lock: commit `957774057d11fb57ffaf0262b0fba93b87da4933`, tree `257163ba0095d92d3f7aee87836345834123b339`.
- Vendor integrity script checks the exact content digest and rejects escaping symlinks.
- Local ListenHub npm package detected as `@marswave/listenhub-cli@0.0.15`; its CLI protocol reports `listenhub --version` = `0.1.0`. Image, video, TTS, music, podcast, explainer, slides, content extraction, Voice and PixVerse help routes were detected without a paid call.
- Credential-stripped local help inspection confirmed `listenhub openapi speakers list --language zh -j` and direct-binary `listenhub openapi tts --text ... --voice <speakerId> --output <file> --format mp3`. The locked TTS route has no `create` subcommand, no `--json` flag and no verified estimate route. No real speaker-list or TTS request was made.
- Local Coli package detected as `@marswave/coli@0.0.20`; the `coli asr` route is available.
- `scripts/bootstrap_listenhub.sh --check` verifies executable package identity, both exact npm package versions, the ListenHub CLI protocol version and the Coli ASR route; wrong or unverifiable versions fail closed. `--install` uses exact package specs rather than `latest`.
- `scripts/listenhub_smoke.js`: 182 dynamically counted deterministic mock assertions covering exact package/protocol contracts; per-call cost gates including `--yes=false` rejection; unknown-option rejection; exact/ambiguous speaker resolution; the dedicated narration lookup → lossless-WAV TTS → exact-container/signature check → auto-ingest → staging-cleanup flow; speaker/name/catalog/text/capture provenance; credential-store/XDG mode enforcement; destructive-action refusal; generalized secret-bearing flag rejection; upload gates; ASR key isolation, project containment and nested-symlink refusal; mode-0700/0600 private capture boundaries; JSON/JSONL/quoted/bracketed compound-credential, credential-bearing storage-URL and URL/control-sequence redaction; locked/stale-lock-recovering SHA dedupe with provenance history; download size/signature/SSRF gates; and all-file release scans including extensionless media.
- `scripts/security_smoke.js`: 39 assertions, including a concrete Tang-dynasty Li Bai ink-wash visual bible whose melancholic-to-hopeful palette, lighting, composition, ID and prompt prefix are derived from the brief, plus zero-call 33tc `pick/cut` confirmation gates, minimal child-process environment isolation, and structured credential/URL output redaction.
- `scripts/file_narration_smoke.js`: real 1.208333-second ffmpeg preview with `narration.engine=file`, verified “向阳乔木” manifest provenance, H.264 video, AAC audio and a post-ingest audio-tamper rejection.
- Release scan covers JavaScript, JSON, Markdown, YAML, shell, Python and vendored HTML. No credential value was written to the repository or sent to a provider. A credential supplied in the conversation was also expanded by a private development shell trace, so it must be treated as compromised and revoked/rotated before any real provider call.

## trust report

- Credentials: only `LISTENHUB_API_KEY` or the provider's local store; packaged doctor/bootstrap output reports presence/readiness only and never intentionally prints the value.
- Network: status/capability checks are read-only; generation/extraction may spend credits and requires explicit confirmation.
- Upload: local media leaves the machine only after `--allow-upload`.
- Vendor: nested upstream skills are reference-only. `cola-avatar-pack`, agent-memory persistence, home-directory writes/deletes and nested GitHub workflow permissions are quarantined.
- Privacy: provider input retention, training use, data region and downstream deletion are unknown.

## rollback boundary

- Remove project-private `.qiaocut/jobs/listenhub/` to discard remote task captures.
- Remove generated files only after verifying no timeline references them.
- Revert the qiaomu-cut integration commit to remove adapters and vendor snapshot.
- Uninstall the pinned optional CLI packages through npm if no longer wanted.
- Upstream updates are manual and commit-locked; runtime auto-update is disabled.

## missing evidence

- No paid ListenHub creation was executed for this integration.
- The real account's `向阳乔木` speaker existence, unique ID and authorization were not queried. Exact/no-result/ambiguous behavior and provenance are enforced by deterministic mocks, but real provider identity and audio quality remain missing evidence until the exposed key is rotated and a future call is explicitly approved.
- No real provider media URL was downloaded; downloader behavior is covered by deterministic local checks and code review.
- No real Coli model transcription or word-level alignment was executed.
- No clean-host Linux/Windows install proof.
- No human blind review of generated media quality.
- No provider evidence for retention, training use, regional processing or deletion.
