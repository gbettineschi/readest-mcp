# Readest MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small, source-read-only MCP that searches Readest EPUB/PDF books and annotations with checkable references, through identical cloud/local tool contracts.

**Architecture:** Select one `LibrarySource` adapter during setup. Normalize records before the shared extraction, cache, retrieval and MCP layers; no source-mode branches in tool handlers. Return typed data plus consistent status, warnings, errors and coverage in both modes.

**Tech Stack:** TypeScript ESM, Node.js 24.15+ (24 LTS), official MCP SDK v2 server/client, Zod 4, Vitest, `node:sqlite` FTS5, `pdfjs-dist`, `yauzl`, `fast-xml-parser`, `linkedom`, `@supabase/supabase-js`; optional `@huggingface/transformers` with quantized multilingual E5. Pin verified package/model revisions during the owning task.

**Spec:** [2026-10-27-readest-mcp-design.md](../specs/2026-10-27-readest-mcp-design.md). This is the updated planning baseline; the older local-only draft is superseded. This plan has not been executed. Implementation must begin only after review, using the user's chosen execution method.

## Global Constraints

- Same six tool names, short descriptions, input schemas, output schemas and annotations in both modes.
- Shared application result: `data`, `status`, `warnings`, `error`, `meta`. All five keys are present.
- `status` is `ok | partial | error`; `data` is the tool's payload or `null`.
- Do not add a warning merely because the selected mode is local.
- Report only known limitations, and preserve unknown completeness.
- Cache/index writes are allowed; source writes are not.
- No automatic app launch, download watcher, source switching, Readest fork or direct Drive OAuth in this release.
- Pagination defaults to 20, maximum 50. Query maximum 1,000 characters; excerpt maximum 320 characters; content defaults to 4,000 and is capped at 12,000 characters.
- Serialized application results are capped at 64 KiB using pagination or an explicit truncation warning.
- Reject source files over 256 MiB, EPUB expanded content over 512 MiB or 20,000 entries, and extraction taking over 60 seconds.
- No handwriting recognition, OCR, image/formula understanding or complete editing history.
- Do not promise exhaustive search, universal compatibility or support response times.

## Review Focus

1. A cloud timeout after a successful sync must return explicitly cached data, while a timeout with no cache must not look like an empty library — Tasks 3, 5 and 7.
2. A local file/config changing during refresh must not create mixed current evidence or falsely report zero annotations — Tasks 2 and 5.
3. Different accounts, directories, editions and duplicate metadata must not share evidence IDs or semantic vectors — Tasks 1, 4, 5 and 6.
4. A signed URL or in-place path must not leak credentials or escape permitted roots; malformed book content must remain bounded — Tasks 2, 3 and 4.
5. Missing model files, an interrupted model download or an unsupported host must not quietly label keyword results as semantic — Tasks 6 and 8.

---

## Workspace and ownership

The current chat directory is not the product repository. During execution create an isolated repository at `work/readest-mcp` under this chat's workspace; if it exists, inspect it and preserve its work. Copy this plan and its spec into that repository's same `docs/superpowers/` paths, keeping published documentation free of machine-specific absolute paths. Use the worktree skill at execution time. Do not initialize, install, publish, configure Codex or read personal books during this planning turn.

Paths below are relative to the product root. Every task owns its tests and includes a focused commit after verification. No task may claim real-account compatibility from mocked HTTP or synthetic files.

## File map

| Files | Responsibility |
|---|---|
| `src/domain/model.ts`, `result.ts`, `source.ts` | Normalized book/annotation/evidence types; result semantics; adapter boundary. |
| `src/mcp/schemas.ts`, `server.ts` | One static tool registry, input/output validation and MCP serialization. |
| `src/config.ts`, `limits.ts`, `security/paths.ts`, `security/redact.ts` | Source choice, bounds, allowed roots and credential-safe diagnostics. |
| `src/sources/local.ts`, `local-format.ts` | Read saved Readest records and map supported local versions. |
| `src/sources/cloud.ts`, `cloud-client.ts`, `cloud-auth.ts` | Read-only remote acquisition, protocol mapping, separate private session. |
| `src/content/epub.ts`, `pdf.ts`, `extract.ts`, `references.ts` | Bounded document extraction and revision-specific references. |
| `src/index/store.ts`, `refresh.ts`, `search.ts`, `embeddings.ts` | Generated SQLite state, refresh lifecycle, lexical/hybrid retrieval, optional local vectors. |
| `src/service.ts`, `src/cli.ts` | Shared tool handlers and composition/maintenance/login commands. |
| `tests/fixtures/`, `tests/helpers/` | Generated source fixtures, fake source, HTTP recorder and SDK harness. |
| `README.md`, `docs/compatibility.md`, `.github/workflows/ci.yml` | Concise setup, measured compatibility and reproducible checks. |

## Shared interface definitions

Define these in Task 1; subsequent tasks use these names rather than inventing parallel contracts.

- `Result<T>` has the exact envelope in the spec. `makeResult<T>(input: Result<T>): Result<T>` validates invariants, redacts diagnostics, and enforces serialized limits.
- `ToolName` is the six names in the spec. `Inputs` and `Outputs` map each name to its input/payload type. `inputSchemas` and `outputSchemas` export the corresponding Zod schema maps. `ToolHandlers` maps each name to `(input: Inputs[K]) => Promise<Result<Outputs[K]>>`. `createMcpServer(handlers: ToolHandlers): McpServer` registers the same schemas for every source.
- `Book` has source-scoped `id`, source key, metadata, saved reading state and independent file/annotation/index availability. `Annotation` keeps its five Readest kinds and original locator, quoted text, comment, optional ink, timestamps and deletion marker. Unsupported/missing fields stay unknown; do not return raw config or credentials.
- `SourceCheckpoint` is an opaque versioned value owned by the adapter. `SourceRead` is `{source_id, kind: full|delta, books, annotations, deleted_book_ids, deleted_annotation_ids, checkpoint, refreshed_at, coverage, warnings}`. Failed substreams retain their previous checkpoints; never commit a proposed checkpoint before its data transaction.
- `LibrarySource.readSnapshot(previous: SourceCheckpoint|null, signal: AbortSignal): Promise<SourceRead>` and `resolveBookFile(book: Book, options: {acquire: boolean, signal: AbortSignal}): Promise<FileResolution>` are the whole acquisition boundary. `FileResolution` is either a validated readable file plus provenance or a typed unavailability/failure. Local never downloads; cloud may download when `acquire:true`.
- `DocumentExtractor.extract(book: Book, file: FileResolution): Promise<ExtractedBook>` produces byte-derived revision, ordered `StructureItem[]`, `Passage[]` and warnings, with per-page extraction status.
- `IndexStore` exposes `applySourceRead(read: SourceRead): void`, `replaceContent(book_id: string, content: ExtractedBook): void`, `getBook(id: string): Book|null`, `getPassage(id: string): Passage|null`, `listBooks(input: Inputs['list_books']): Outputs['list_books']`, `listAnnotations(input: Inputs['list_annotations']): Outputs['list_annotations']`, `search(input: Inputs['search_library'], semantic: QueryEmbedding|null): Promise<Outputs['search_library']>`, `status(): Outputs['library_status']` and `close(): void`. `getStructure(book_id: string, page: {limit:number,cursor:string|null}): Page<StructureItem>` supports `get_book`; `getAnnotation(id: string): Annotation|null` supports annotation selectors. Define `Page<T>` as `{items:T[],next_cursor:string|null}`. Implementations return typed payloads; the service builds envelopes. Task 6 adds `replaceEmbeddings(book_id: string, revision: string, manifest: ModelManifest, chunks: EmbeddedChunk[]): void`; define the pure data types in `domain/model.ts`. `QueryEmbedding` contains a normalized vector and manifest. The store never imports a model runtime or calls an embedder; shared orchestration supplies the vector.
- `RefreshCoordinator.refresh(options: {content: available|all, rebuild: boolean}, signal: AbortSignal): Promise<RefreshReport>` uses source, extractor and store. `createToolHandlers(deps: {source, store, extractor, refresh, embedder: Embedder|null}): ToolHandlers` owns request orchestration. `Embedder.embed(texts: string[], kind: query|passage): Promise<Float32Array[]>` and its manifest are defined in Task 6.

### Task 1: Establish the static MCP contract and source boundary

**Files:** Create `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `src/domain/{model,result,source}.ts`, `src/mcp/{schemas,server}.ts`, `src/limits.ts`, `src/security/redact.ts`, `tests/contracts.test.ts`, `tests/helpers/fake-source.ts`.

**Interfaces:** Produces the shared types and `createMcpServer` above; later tasks implement the interfaces rather than changing tool schemas by mode.

- [ ] **1. Write the contract tests and minimal project test configuration.** Create the isolated repo, copy spec/plan, verify SDK v2/Node 24 package compatibility, pin dependencies and set `npm test` to `vitest run`, `typecheck` to `tsc --noEmit`, `build` to `tsc`. With one SDK in-memory client per fake source, assert:

  ```ts
  expect(localTools.map(({ name, description, inputSchema, outputSchema, annotations }) =>
    ({ name, description, inputSchema, outputSchema, annotations }))).toEqual(cloudToolDefinitions);
  expect(localTools).toHaveLength(6);
  expect(outputSchemas.list_books.safeParse(successfulEmpty).success).toBe(true);
  expect(outputSchemas.list_books.safeParse(sourceFailure).success).toBe(true);
  expect(sourceFailure).toMatchObject({ status: 'error', data: null });
  ```

  Also assert `status:error` requires an error, success requires `error:null`, normal pagination is not partial, unknown coverage is accepted, and expected tool errors retain the envelope and MCP `isError:true`. Use independently authored expected field assertions, not snapshots generated from the implementation under test.
- [ ] **2. Run** `npm test -- tests/contracts.test.ts`; verify assertions fail because the implementation is missing, not because fixtures cannot run.
- [ ] **3. Implement** normalized types, per-tool Zod input/output schemas, result validation/redaction, the six fixed registrations and `structuredContent` plus matching JSON text rendering. All six use source-read-only annotations. Add Node 24/FTS5 runtime smoke assertions. Do not install source adapters or make network requests.
- [ ] **4. Run** `npm test -- tests/contracts.test.ts` and `npm run typecheck`; require all passing, including error-output validation and both fake modes.
- [ ] **5. Commit** as `feat: define source-independent MCP contracts`.

### Task 2: Read a local library without altering it

**Files:** Create `src/config.ts`, `src/security/paths.ts`, `src/sources/{local,local-format}.ts`, `tests/local-source.test.ts`, `tests/fixtures/local/`; extend `src/security/redact.ts` only for actual source diagnostics.

**Interfaces:** Consumes `LibrarySource`, `SourceRead`, `Book`, `Annotation`; produces `loadConfig(path: string): Config`, `createLocalSource(config: LocalConfig): LibrarySource`, `resolveAllowedPath(path: string, roots: string[]): Promise<string>` and local format mapping. `config.ts` owns `Config`, `LocalConfig`, `CloudConfig`, `CacheConfig` and `EmbeddingConfig`: one discriminated source selection, external cache directory, private cloud credential path, optional local model setting, and explicit additional local content roots. No tokens/passwords in the ordinary config.

- [ ] **1. Write failing fixture tests.** Include one local EPUB, one remote placeholder with saved notes, one missing config, an actual empty `booknotes` array, all five note types, unsupported format, deleted entry and corrupt catalogue. Assert missing config is unavailable, valid empty notes are empty, local mode performs no HTTP, and source digests remain unchanged. Test custom roots, traversal/symlink escape, unknown reading status, inherited/absent preferences, and a config replaced during reading (bounded retry, then explicit unavailable result).
- [ ] **2. Run** `npm test -- tests/local-source.test.ts`; verify the intended failures.
- [ ] **3. Implement** bounded standard-path detection with explicit override on ambiguity; read snapshots with before/after fingerprint checks and one retry. Map supported fields from `v0.12.16` without copying app code. Canonical source identity hashes the selected location; in-place content is constrained to approved roots. Do not launch Readest, read credentials, initialize an empty library or open statistics DBs in this version.
- [ ] **4. Run** `npm test -- tests/local-source.test.ts tests/contracts.test.ts`; require correct availability and unchanged source digests.
- [ ] **5. Commit** as `feat: read local Readest library snapshots`.

### Task 3: Add read-only cloud acquisition and private authentication

**Files:** Create `src/sources/{cloud,cloud-client,cloud-auth}.ts`, `tests/cloud-source.test.ts`, `tests/cloud-auth.test.ts`, `tests/helpers/cloud-http.ts`, `tests/fixtures/cloud/`, `docs/compatibility.md`.

**Interfaces:** Consumes the same `LibrarySource` contract; produces `createCloudSource(config: CloudConfig, credentials: CredentialStore): LibrarySource`, `CredentialStore.load/save/clear`, `signIn(email: string, password: string): Promise<void>` and serialized renewal through the official Supabase SDK.

- [ ] **1. Write failing HTTP/session tests.** Model the pinned official client/server payloads, not raw guesses: independent books/configs/notes responses and cursors, tied book-page boundaries, tombstones, valid empty pulls, malformed 200 response, one failed channel, 401 and the pinned route's 403 `Not authenticated` renewal, genuine access denial, timeout, truncated/oversized response, expired signed URL, interrupted transfer and concurrent renewal. Assert one renewal/retry for recognized expired authentication, no renewal loop for genuine denial, no checkpoint advancement after incomplete data, auth never forwarded to the storage download, no pushes/uploads/deletes, and no secrets in diagnostics. Verify session files use private permissions and atomic replacement; passwords are never persisted.
- [ ] **2. Run** `npm test -- tests/cloud-source.test.ts tests/cloud-auth.test.ts`; verify expected failures.
- [ ] **3. Implement** the documented email/password session path and read allowlist, consulting the pinned source and official account setup. Resolve official public cloud/Supabase configuration from published integration configuration and record its source; never assume custom OAuth callbacks work. Use per-stream checkpoints: books use server `synced_at` semantics with its boundary-completing pagination; configs/notes use their separate update/delete semantics. Reject stalled cursors rather than declaring completeness. Bound metadata HTTP bodies to 32 MiB and requests to 15 seconds, preserve prior data on failure, and do not infer deletion from failed channels. Download to `.part`, enforce limits and validate before atomic rename. Retry an expired signed URL once. Map errors to stable domain codes without exposing provider messages containing secrets.
- [ ] **4. Run** both test files plus `tests/contracts.test.ts`. Record tested API snapshot and auth/renewal assumptions in `docs/compatibility.md`. If a privately authorized account session is already available, perform an early read-only catalogue probe to catch access/configuration errors before building further; otherwise record it as pending and continue independent tasks. Full live validation belongs to Task 8. Absence of credentials is not permission to scrape an existing session or claim connection success.
- [ ] **5. Commit** as `feat: add read-only Readest cloud source`.

### Task 4: Extract EPUB/PDF and resolve exact references

**Files:** Create `src/content/{epub,pdf,extract,references}.ts`, `tests/content.test.ts`, `tests/references.test.ts`, generated EPUB/PDF fixtures and their expected texts/locations.

**Interfaces:** Produces `DocumentExtractor`, `ExtractedBook`, `resolveReference(reference: EvidenceReference, content: ExtractedBook): Evidence`, and `matchAnnotationContext(annotation: Annotation, content: ExtractedBook): exact|ambiguous|unresolved` with evidence on exact matches.

- [ ] **1. Write failing tests.** Generate EPUB 2/3 books with nested NAV/NCX, encoded paths, Unicode and scripts/styles; PDFs with physical pages/printed labels, text, scans, mixed pages, password protection and corrupt objects. Assert exact extracted passages and locations, paragraph ordering, no external-resource fetch, and bounded ZIP/PDF work. Test a source changed during snapshot acquisition and a preallocated/truncated file: never index text under a fingerprint computed from different bytes or declare readiness from file existence. Identical titles with different bytes must have different revisions; resolving an old passage after replacement must produce `STALE_REFERENCE`. Repeated annotation quotes must remain ambiguous. Check available ink survives normalization without claiming searchable handwriting.
- [ ] **2. Run** `npm test -- tests/content.test.ts tests/references.test.ts`; verify intended failures.
- [ ] **3. Implement** maintained extractors with deterministic normalized text, structure and source offsets. Hash bytes, not metadata alone. Enforce limits while streaming/decompressing, and terminate extraction work after the bound. Map native locators without relabeling generated offsets as CFIs. Public fixtures are synthetic, accompanied by known expected results.
- [ ] **4. Run** content/reference tests; verify all fixtures' source digests remain unchanged and mixed-page gaps are visible.
- [ ] **5. Commit** as `feat: extract book evidence with revision-safe references`.

### Task 5: Build the shared index and recoverable refresh lifecycle

**Files:** Create `src/index/{store,refresh,search}.ts`, `tests/index.test.ts`, `tests/refresh.test.ts`.

**Interfaces:** Implements `IndexStore` and `RefreshCoordinator`; produces `openIndex(config: CacheConfig, source_id: string): IndexStore`. Lexical search returns typed hits with evidence IDs, actual coverage and stable pagination tied to an index generation.

- [ ] **1. Write failing integration tests.** Index the same fixture corpus through each adapter and assert equivalent normalized content. Test word/phrase retrieval across book text, quotes and user notes; Italian/English diacritics and filters; stable pagination; correct note-only availability without a book file. Interrupt refresh before checkpoint commit, delete a note/book, offload a file, corrupt a catalogue, replace an edition and run competing writers. Assert no cross-account/directory hits, no stale-reference remapping, no false empty library, correct cached-data warning after a source failure, and no resurrection of tombstones. Missing config may retain explicitly stale cached notes but must not silently claim current notes or erase them as a successful empty read.
- [ ] **2. Run** `npm test -- tests/index.test.ts tests/refresh.test.ts`; confirm intended failures.
- [ ] **3. Implement** SQLite schema/versioning, parameterized FTS5/BM25 and single-writer coordination. Partition by canonical source identity and model/content revision. Apply records and checkpoints transactionally; retain readable prior data on interrupted refresh and track per-book content failures. Bind pagination cursors to query and generation; reject changed-generation cursors. Startup refreshes metadata, not an entire book collection. `available` indexes existing files/cache; `all` requests cloud acquisition and reports missing local files. Preserve clear source-vs-index timestamps and source-scoped coverage. Do not execute caller SQL or raw FTS operators.
- [ ] **4. Run** both index tests and all source/content tests; require semantic-index tables to remain unused for now and preserve source digests.
- [ ] **5. Commit** as `feat: index reading evidence and recover refresh safely`.

### Task 6: Add optional local semantic and hybrid search

**Files:** Create `src/index/embeddings.ts`, `tests/semantic.test.ts`, `tests/semantic-model.test.ts`, synthetic bilingual relevance cases.

**Interfaces:** Implements `Embedder`, model manifest `{id,revision,dtype,dimensions,chunk_version}` and `createLocalEmbedder(config: EmbeddingConfig): Promise<Embedder>`; extends `IndexStore.search` with vector ranking without changing its public schema. Adds `replaceEmbeddings` as defined above and `fetchModel(config: EmbeddingConfig): Promise<ModelManifest>` for the CLI. The shared refresh/service layer calls the embedder; neither a source adapter nor the SQLite store performs model inference.

- [ ] **1. Write failing tests.** Use deterministic vectors for cosine ranking, hybrid reciprocal-rank fusion (`k=60`), target filters, deletion/revision invalidation and source partitioning. Assert semantic-disabled calls and unavailable native model backends return `CAPABILITY_UNAVAILABLE`, while hybrid fallback is `partial` with `used_mode:keyword` and a warning. Tests for long/multilingual passages must retain source offsets and fit the model's input token budget; failed/interrupted model installation must never mark it ready.
- [ ] **2. Run** `npm test -- tests/semantic.test.ts`; confirm the intended failures.
- [ ] **3. Implement** the optional Transformers.js adapter with quantized `Xenova/multilingual-e5-small`. Pin the actual model commit and file hashes after checking the model card/license. Use the documented E5 `query:`/`passage:` prefixes, mean pooling and normalization. Split passages into bounded subranges using tokenizer counts, preserving offsets; ensure prefixes and special tokens fit the 512-token model limit. Store vectors by source, revision, model manifest and subrange. Stream cosine ranking from SQLite; do not introduce an ANN server or silently truncate a book to one model input. Model acquisition is explicit; normal inference runs offline and never uploads text.
- [ ] **4. Run** `npm test -- tests/semantic.test.ts`, then `READEST_TEST_MODEL=1 npm test -- tests/semantic-model.test.ts` after fetching the pinned model. The real CPU test must return finite normalized vectors and retrieve each predetermined relevant passage within the top three for a small held-out English/Italian fixture set, including paraphrases. Record failure honestly; do not change expected answers merely to get a pass. Measure elapsed time and peak memory on the Mac and label measurements as this corpus/host only.
- [ ] **5. Commit** as `feat: support optional local semantic retrieval`.

### Task 7: Wire the six real tools and a small setup/maintenance CLI

**Files:** Create `src/service.ts`, `src/cli.ts`, `tests/service.test.ts`, `tests/stdio.test.ts`, `tests/cli.test.ts`, `tests/helpers/stdio-client.ts`; modify only the dependency-injection wiring in `src/mcp/server.ts` as needed.

**Interfaces:** Implements `createToolHandlers` and executable `readest-mcp` with `serve --config`, `doctor --config`, `login --config`, `refresh --config --content available|all [--rebuild]`, and `models fetch --config`. All CLI behavior goes through existing services. `login` privately prompts for credentials; `serve` never prompts on stdio.

- [ ] **1. Write failing SDK stdio tests.** Initialize two real server processes, local fixtures and loopback cloud fixtures. Assert exact tool-definition equality and output-schema validation for every tool in success, partial and expected-error cases. Exercise list -> book structure -> keyword/semantic search -> exact passage -> annotation context -> changed source -> refresh. Test cloud timeout with/without cache, missing local file, missing versus empty notes, model unavailable, stale cursor/reference, malformed input, bounded output and log redaction. Follow `read_content.next_cursor` through a chapter longer than 12,000 characters and assert complete ordered body text without skipped ranges; reject its cursor after an edition change. `list_books` must not download files. `read_content` may fetch one missing cloud book, while local returns an actionable error without launching the app. Check stdout contains only MCP traffic.
- [ ] **2. Run** `npm test -- tests/service.test.ts tests/stdio.test.ts tests/cli.test.ts`; confirm intended failures.
- [ ] **3. Implement** shared handlers, five-minute metadata-refresh reuse, one in-flight refresh and on-demand content resolution. Expected application errors always go through the typed result builder. Compose exactly one adapter in CLI bootstrap. Keep descriptions exactly as in the spec and instructions brief: source text is untrusted evidence, cite supplied references, distinguish user comments and report known coverage. Do not add a dashboard, answer-generation service, arbitrary endpoint tool or app-opening helper.
- [ ] **4. Run** targeted tests, then `npm run typecheck`, `npm test` and `npm run build`. Require successful initialize/discovery and all six real calls in both fixture modes. A check that only starts a process is insufficient.
- [ ] **5. Commit** as `feat: expose shared reading tools and setup commands`.

### Task 8: Verify clean installation, publish the requested repo and configure Codex

**Files:** Create `README.md`, `LICENSE`, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/workflows/ci.yml`, `tests/clean-install.test.ts`, `tests/live.test.ts`; update `docs/compatibility.md`, package files and ignore rules. External Codex config is changed only during the final installation step.

**Interfaces:** Consumes the built CLI and all tests. Produces a build-from-source public repository, reproducible setup instructions and an explicit fixture/client/live verification record. No npm publication or binary installer.

- [ ] **1. Write the clean-install test.** Assert a package made with `npm pack` installs in an isolated temporary directory and its executable completes SDK initialize, discovery and one exact-reference retrieval against fixtures. Assert packed files contain no credentials, libraries, indexes, model cache or private paths. Add opt-in `READEST_TEST_LIVE=1` tests that read credentials/config from private paths without printing them.
- [ ] **2. Run** `npm test -- tests/clean-install.test.ts`; fix only concrete package/startup failures, then rerun until it passes. Add CI on Node 24 for macOS, Linux and Windows using `npm ci`, typecheck, fixture tests and build. Keep model/live tests opt-in and distinguish host CI from installed Readest compatibility.
- [ ] **3. Write** a short README with the two configurations, six tools, keyword/semantic examples, private login, explicit model acquisition, refresh and limits. Include the exact maintenance note from the spec, MIT original-code license and dependency/model notices. Record the checked API snapshot and supported local fixture version; no generic "all platforms tested" claim. Run the documented commands from the clean package. Resolve dependency audit/license issues and check tracked/packed content for secrets before publication.
- [ ] **4. Run final fixture verification** with `npm run typecheck`, `npm test`, `npm run build`, `npm pack --dry-run`, plus the opt-in real-model suite from Task 6. Save a compact compatibility record of what passed and what was not run. Commit as `docs: document and verify Readest MCP setup`.
- [ ] **5. Publish** the already requested public repository `gbettineschi/readest-mcp` after checking the destination does not contain unrelated work. Use the GitHub connector when sufficient, otherwise the authenticated Git CLI. Push only the reviewed project and verify its public URL/default branch and CI result. Publication and local setup are within the earlier requested scope; do not include personal test data to demonstrate functionality.
- [ ] **6. Perform local setup and live probes.** Recheck installed Readest/version and bounded library locations. If a local library exists, test book listing, one saved annotation where available, EPUB/PDF evidence as available and a reference round-trip without changing source digests. For cloud, let the user privately sign in if needed and test actual list, annotation, download and renewal access without assuming eligibility. Never set a password or accept account terms for the user. Missing books/login block only those live checks, not the rest of the deliverable; record their exact status.
- [ ] **7. Configure Codex** only after the executable passes its clean-install test. Read the current OpenAI/Codex setup guidance, preserve other MCP entries and add the absolute executable/config paths. Reconnect through supported client controls if available; otherwise state that reopening is needed. Verify actual tool discovery in Codex and a read call separately from SDK success or config-file changes. Run `READEST_TEST_LIVE=1 npm test -- tests/live.test.ts` for authorized configured sources and report each real result, including unavailable formats/annotations.

## Completion and handoff

The software can be called fixture-verified only after both source modes pass the same six-tool contract and evidence round-trip. Semantic support needs its real-model check, cloud-connected needs an actual authorized account call, and Codex-installed needs actual client discovery. Missing credentials, an uninitialized library or a required client restart must stay visible; none becomes a successful empty result.

Self-review before handoff: map every spec requirement to the owning task, check all shared signatures and tool names, verify the five Review Focus cases have concrete tests, and keep deferred app-opening/OCR/statistics/Drive work out of this release.

Planning self-review completed on 27 October 2026: contract/result parity maps to Tasks 1 and 7; acquisition/privacy to 2 and 3; formats and references to 4; lifecycle and coverage to 5; local semantics to 6; distribution and real-client checks to 8. The five Review Focus conditions have explicit owning tests. No implementation, account connection or software test has been performed by writing this plan.

Recommended execution approach: **Native**, with one whole-project independent review after the functional tasks. The adapter interfaces, revision handling and shared result semantics are closely coupled; one implementer preserves continuity and avoids repeated context handoffs for a small personal project. Subagent-driven execution remains available if the user prefers an independent implementer/reviewer gate per task.
