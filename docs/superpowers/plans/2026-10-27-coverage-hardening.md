# Readest MCP coverage hardening implementation plan

> **For agentic workers:** Use superpowers:executing-plans to execute and verify each task.

**Goal:** Exercise existing filters, real annotations, source lifecycle and recovery; fix only reproduced defects.
**Architecture:** Preserve the six read-only tools and shared local/cloud results. Tests exercise actual SQLite, source adapters and MCP processes; live UI actions use a new disposable verification book.
**Tech Stack:** TypeScript, Vitest, Node 24, official MCP SDK, stock Readest.
**Spec:** ../specs/2026-10-27-readest-mcp-design.md; owner request to test gaps and fix their causes.

## Global constraints
- No secrets or private texts in Git; no new API or write tools.
- Preserve original books. Disposable generated book and test annotations are the only intended account changes.
- Isolate live local probes in a separate MCP cache; keep the installed cloud configuration.
- Keep known scope limits explicit; no claim of multi-day, Drive-provider or unexecuted platform testing.

## Review focus
- Date bounds with UTC offsets must compare actual instants, not ISO spelling.
- Filters combine without mixing books, annotation types or target kinds.
- Annotation edits/deletion invalidate search results, references and vectors.
- Process interruption releases/reclaims abandoned locks without exposing partial updates.
- The local adapter reads stock Readest files passively, including missing downloads.

### Task 1: Filters and annotation lifecycle
Files: tests/filters.test.ts, tests/annotation-lifecycle.test.ts; src/index/store.ts only if a failure proves a defect.
- [ ] Add table-driven literal expectations for every book/annotation filter, combinations, pagination, UTC-offset bounds and missing timestamps.
- [ ] Run against existing code; retain observed failures, diagnose, then implement the smallest correction.
- [ ] Add local/cloud lifecycle checks for changed/deleted annotation evidence and stale references.
- [ ] Verify targeted tests and full suite, including live/model/OCR checks.

### Task 2: Live account and local acceptance
Files: private diagnostics only, plus a synthetic EPUB generated outside Git.
- [ ] Import the generated book using stock Readest; create a real highlight and personal note, sync, query via MCP, edit and remove only generated annotations.
- [ ] Exercise local mode against the actual library with an isolated cache; check source files unchanged during passive reads.
- [ ] Exercise bounded model/OCR and larger synthetic library cases; record limits and avoid calling them broad quality benchmarks.

### Task 3: Recovery, review and delivery
Files: tests/process-recovery.test.ts; docs/compatibility.md; any production fix only with an observed failing regression.
- [ ] Use child processes to interrupt actual locks/cache writes and verify recovery, exclusion and readable snapshots.
- [ ] Run full tests/typecheck/package install and current-client smoke checks appropriate to changes.
- [ ] Obtain independent review, resolve actionable findings, open a PR and run CI on macOS/Linux/Windows.
- [ ] Update verification evidence; integrate/install fixes within owner-authorized scope. Record anything requiring an essential login/manual step.
