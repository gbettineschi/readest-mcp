# Retrieval corrections

The user requested fixes for observed PDF text gaps and poor Italian-to-English semantic retrieval. They delegated execution and asked to continue. Keep source books and Readest cloud read-only; do not publish a release.

## PDF

Inspection distinguished genuinely blank pages (no PDF drawing operators) from image-only pages. Classify only zero-operator pages as blank. Preserve physical page references. Add optional local Tesseract OCR for pages without embedded text and with drawing operators. Render inside the existing bounded worker using PDF.js and its optional canvas runtime, feed PNG via stdin to a bounded child process (no shell), and retain explicit OCR provenance. Missing OCR or failures must retain text gaps, never fabricate text or silently claim complete coverage. Default OCR off; configure English/Italian locally for this installation. Existing text remains authoritative. Fingerprint PDF extraction settings so cached extraction is refreshed when behavior changes. Blank pages alone do not make text coverage incomplete; OCR remains an approximation.

Alternatives: external preprocessing alone would leave the MCP unable to handle later imports; a hosted OCR service adds credentials and sends book images away. Optional local OCR fits the read-only, personal setup.

## Semantics

Read-only comparisons use the real private corpus, original query pairs in Italian/English, and new synthetic cross-language distractors. Filtering short passages alone did not repair cross-language ranking; fp32 E5-small did not repair it either. Evaluate E5-base before selecting a fix. Preserve exact source offsets, static MCP schema parity and offline inference. A larger model is acceptable only with measured improvement; no remote text inference or new paid API.

## Verification

Regression tests first for blank pages, image-only pages, unavailable OCR, extraction-cache migration, OCR evidence round trips, and cross-language retrieval. Full suite, type check, optional real OCR/model tests, then installed MCP tests on all 26 books. Personal files and evaluation text stay outside git.
