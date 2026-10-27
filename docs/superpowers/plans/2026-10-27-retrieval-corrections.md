# Retrieval Corrections Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this delegated repair.

**Goal:** Correct PDF coverage reporting and recover image-only text locally; improve demonstrated cross-language retrieval.

**Architecture:** Retain six tools and common local/cloud results. Optional bounded OCR is part of PDF extraction with an extraction-cache fingerprint. Select the semantic repair from private controlled comparisons.

**Tech Stack:** Node 24, TypeScript, PDF.js, optional canvas, Tesseract CLI, local Transformers.js.

**Spec:** docs/superpowers/specs/2026-10-27-retrieval-corrections-design.md

## Global Constraints

- Do not alter source books, credentials or cloud contents.
- No release until user review; no personal corpus in git.
- OCR disabled by default; preserve gaps on unavailable/failed OCR.
- Inference stays local; exact evidence references survive search/read.

## Review Focus

- A blank page must not suppress a real image-only gap elsewhere.
- Missing language data, failed rendering and timeout must leave readable native pages available.
- Changed OCR settings must not reuse an old successful extraction silently.
- OCR text must not be confused with embedded PDF text.
- Cross-language evaluation must contain same-language distractors and preserve English retrieval.

### Task 1: PDF coverage and optional OCR

Files: src/content/{pdf,ocr,extract,worker}.ts, src/config.ts, src/domain/{model,source}.ts, src/index/{refresh,store}.ts, src/{cli,service}.ts; tests/content.test.ts, tests/refresh.test.ts, tests/ocr.test.ts.

- [ ] Write failing blank-page and missing-OCR regressions; run focused tests and inspect failures.
- [ ] Add blank state, optional bounded local OCR and provenance, extraction fingerprint and configuration wiring.
- [ ] Verify focused tests, real synthetic OCR and private PDF page round trips; run full suite/type check.

### Task 2: Cross-language search

Files: src/index/{embeddings,model}.ts/json as determined by measured cause; tests/semantic-model.test.ts and README.md.

- [ ] Compare pinned small q8/fp32 and base q8 on identical real candidate passages; choose minimum working repair.
- [ ] Write stronger failing multilingual regression with original synthetic examples and language-matched distractors.
- [ ] Implement selected repair, invalidate generated vectors via manifest, run model and whole-suite tests.
- [ ] Reindex private corpus, verify paired queries and exact source references through installed MCP.

### Task 3: Delivery

- [ ] Update concise setup/compatibility notes and third-party notices as needed.
- [ ] Review changes, fix important findings, verify installed package and all six tools.
- [ ] Commit and push the verified repair to the authorized repo; no tag or release.

### Task 4: Corpus-driven semantic representation

- [ ] RED regression: heading plus adjacent body becomes one semantic hit while original keyword passage IDs remain unchanged, including after rebuilding FTS.
- [ ] Add pure section-unit construction and persist derived units outside FTS; preserve PDF/annotation/resource/section/offset boundaries and singleton IDs.
- [ ] Use the same expected unit set for embedding readiness and target-specific coverage; invalidate paragraph vectors through manifest chunk version.
- [ ] Test exact source ranges, original references, derived references, removed units and Unicode boundaries; run whole suite and typecheck.
- [ ] Fresh review of only this new unit layer, then full private corpus reindex and all six paired relevance checks before accepting it.
