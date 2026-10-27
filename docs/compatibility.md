# Compatibility and verification

This file records evidence, not a general compatibility guarantee. Checked 27 October 2026.

- Node 24.22.1 on macOS arm64 is the current local test runtime. The system Node installation is unchanged.
- Readest 0.12.16 is installed on this Mac. Local fixtures follow its `library.json`, managed book directories and per-book configuration. Passive reads do not launch the app or modify its data.
- Cloud fixtures follow Readest snapshot `44c90152f6b04e74f71245bb3642d9a7e03042ed`: raw DB records from separate books/configs/notes pulls, book `synced_at` pagination and note/config update/deletion clocks. This is a published application interface, not a guaranteed versioned developer API.
- Authentication follows the official KOReader integration's separate email/password session. Social-only accounts may require setting a password in Readest. This MCP never does that on the user's behalf and never imports the reader's session automatically.
- Default cloud project configuration is the vendor-published anonymous project URL/key from that snapshot's `.env`. Its JWT role was checked as `anon`; it is public project configuration, not an account session or service-role credential. Account sessions stay in private local storage.
- The cloud factory resolves the session's account identity before choosing its cache partition. Changing the account requires reconnecting the MCP, preventing previous-account cache reuse.
- URL acquisition uses the read endpoint's book-hash/extension fallback; account authorization is not forwarded to storage downloads. Cloud availability and account eligibility still require a real authorized probe.

Sources: [sync documentation](https://www.readest.com/docs/sync), [sync server](https://github.com/readest/readest/blob/44c90152f6b04e74f71245bb3642d9a7e03042ed/apps/readest-app/src/pages/api/sync.ts), [download endpoint](https://github.com/readest/readest/blob/44c90152f6b04e74f71245bb3642d9a7e03042ed/apps/readest-app/src/pages/api/storage/download.ts), [KOReader authentication](https://github.com/readest/readest/blob/44c90152f6b04e74f71245bb3642d9a7e03042ed/apps/readest.koplugin/readest_supabaseauth.lua).
## Fixture and installation checks

- 65 default tests passed on macOS arm64: all six real MCP tools in local and loopback-cloud processes, identical definitions, exact-reference retrieval, long chapter continuation, stale editions, missing versus empty notes, cloud timeouts with/without cache, content limits and private path/session boundaries.
- A packed production-only install in a clean directory passed initialization, tool discovery, EPUB extraction/search and an exact-reference round trip with optional dependencies omitted. A separate installed package with optional dependencies passed real local-model inference.
- Production dependency audit reported no known vulnerabilities at the check time. Dependency licenses were inspected; the model is downloaded separately.
- Readest 0.12.16 was rechecked on this Mac. No saved library was found in the bounded standard local paths. No live local library or Drive sync was tested.
- Cloud setup is installed, but live account access is pending separate sign-in. A browser Google session is not reused or extracted. Catalogue, annotation, download and session-renewal eligibility are not yet established for a real account.
- Codex configuration was added while preserving prior settings. Current-chat reconnection has not been demonstrated; the running app's optional control socket was unavailable. A fresh client check and account probe are separate from the fixture results.
- CI is configured for Node 24 on macOS, Linux and Windows; workflow presence alone is not evidence of passing those hosts.

## Local semantic retrieval probe

On this arm64 Mac with Node 24.22.1, Transformers.js 4.3.1 and the pinned q8 multilingual E5-small model, the opt-in offline CPU test retrieved all six predetermined English/Italian paraphrases within the top three of eight synthetic passages. Vectors were finite, 384-dimensional and normalized. One warm-filesystem run took 1.15 seconds including model initialization, with process peak RSS 689.75 MiB (the test runner is included). This is a small corpus/host measurement, not a library-scale performance claim. Model files total about 140 MB and are explicitly downloaded, checksum-verified and kept outside the repository.

