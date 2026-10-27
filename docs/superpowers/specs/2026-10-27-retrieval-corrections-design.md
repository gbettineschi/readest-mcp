# Retrieval corrections

The user requested fixes for observed PDF text gaps and poor Italian-to-English semantic retrieval. They delegated execution and asked to continue. Keep source books and Readest cloud read-only; do not publish a release.

## PDF

Inspection distinguished genuinely blank pages (no PDF drawing operators) from image-only pages. Classify only zero-operator pages as blank. Preserve physical page references. Add optional local Tesseract OCR for pages without embedded text and with drawing operators. Render inside the existing bounded worker using PDF.js and its optional canvas runtime, feed PNG via stdin to a bounded child process (no shell), and retain explicit OCR provenance. Missing OCR or failures must retain text gaps, never fabricate text or silently claim complete coverage. Default OCR off; configure English/Italian locally for this installation. Existing text remains authoritative. Fingerprint PDF extraction settings so cached extraction is refreshed when behavior changes. Blank pages alone do not make text coverage incomplete; OCR remains an approximation.

Alternatives: external preprocessing alone would leave the MCP unable to handle later imports; a hosted OCR service adds credentials and sends book images away. Optional local OCR fits the read-only, personal setup.

## Semantics

Read-only comparisons use the real private corpus, original query pairs in Italian/English, and new synthetic cross-language distractors. Filtering short passages alone did not repair cross-language ranking; fp32 E5-small did not repair it either. Evaluate E5-base before selecting a fix. Preserve exact source offsets, static MCP schema parity and offline inference. A larger model is acceptable only with measured improvement; no remote text inference or new paid API.

## Verification

Regression tests first for blank pages, image-only pages, unavailable OCR, extraction-cache migration, OCR evidence round trips, and cross-language retrieval. Full suite, type check, optional real OCR/model tests, then installed MCP tests on all 26 books. Personal files and evaluation text stay outside git.

## Corpus-driven retrieval-unit correction

The whole-corpus check rejected the model-only repair: standalone headings and index entries occupied all five results for one Italian learning query and degraded English focus results. A private read-only section-context spike improved these paired queries. Add a derived semantic representation of consecutive EPUB paragraphs within the same section/resource/spine and contiguous normalized offsets. Keep the original extraction and lexical rows unchanged. Joined units have distinct, text-bound IDs and `paragraph:null`; their chapter, resource, source revision and exact normalized offsets remain available. Their text is retrievable through existing passage selectors. PDF pages and annotation evidence remain separate. All evidence remains searchable; there are no length-based rank penalties, book-specific class heuristics, hidden language translation or discarded short notes. Model manifest chunk version changes, preventing a mixture of old paragraph vectors and section vectors. Retained original paragraph vectors for other manifests cannot affect the new manifest. Only the derived unit set is used to assess semantic completeness.

Alternatives considered: dropping short text hides legitimate short notes and prose; regrouping original extraction would change keyword/reference behavior. A separate derived semantic representation preserves those contracts and changes the granularity only where needed. The executor chose this implementation within the user's delegated repair, based on the failed full-corpus check.
