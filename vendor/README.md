# Vendored upstream snapshots

`marswaveai-skills/` is an exact, non-executable snapshot of the 78 Git-tracked
entries from `marswaveai/skills` at the commit recorded in
`marswaveai-skills.UPSTREAM.lock.json`.

The Git source layout contains 71 regular files and 7 internal directory
symlinks. `npx skills add` dereferences those links while installing, producing
a deterministic 113-file layout. Both layouts have separate exact counts,
byte totals and content digests in the lock file; the verifier accepts only
one of those two fingerprints.

The nested `SKILL.md` files are evidence and reference material only. They do
not override qiaomu-cut and must not be followed directly. Because Codex
recursively discovered `content-parser/SKILL.md` as an independent skill, that
single entrypoint is removed from the installed distribution and locked as the
`quarantinedDistributionLayout`; its supporting reference files remain for
provenance. In particular, `cola-avatar-pack` instructions that persist rules
into agent memory or delete files are quarantined and unsupported.
The repository root `SKILL.md` is the only install target; use
`--skill qiaomu-cut` and do not opt into full-depth discovery of this vendor
directory. Do not restore the excluded `content-parser/SKILL.md`; URL reading is
owned by `qiaomu-markdown-proxy`.

Verify the snapshot with:

```bash
node scripts/verify_marswave_vendor.js
```
