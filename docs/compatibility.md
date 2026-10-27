# Compatibility and verification

This file records evidence, not a general compatibility guarantee. Live-account and client installation checks will be added after the executable exists.

- Node 24.22.1 on macOS arm64 is the current local test runtime. The system Node installation is unchanged.
- Readest 0.12.16 is installed on this Mac. Local fixtures follow its `library.json`, managed book directories and per-book configuration. Passive reads do not launch the app or modify its data.
- Cloud fixtures follow Readest snapshot `44c90152f6b04e74f71245bb3642d9a7e03042ed`: raw DB records from separate books/configs/notes pulls, book `synced_at` pagination and note/config update/deletion clocks. This is a published application interface, not a guaranteed versioned developer API.
- Authentication follows the official KOReader integration's separate email/password session. Social-only accounts may require setting a password in Readest. This MCP never does that on the user's behalf and never imports the reader's session automatically.
- Default cloud project configuration is the vendor-published anonymous project URL/key from that snapshot's `.env`. Its JWT role was checked as `anon`; it is public project configuration, not an account session or service-role credential. Account sessions stay in private local storage.
- The cloud factory resolves the session's account identity before choosing its cache partition. Changing the account requires reconnecting the MCP, preventing previous-account cache reuse.
- URL acquisition uses the read endpoint's book-hash/extension fallback; account authorization is not forwarded to storage downloads. Cloud availability and account eligibility still require a real authorized probe.

Sources: [sync documentation](https://www.readest.com/docs/sync), [sync server](https://github.com/readest/readest/blob/44c90152f6b04e74f71245bb3642d9a7e03042ed/apps/readest-app/src/pages/api/sync.ts), [download endpoint](https://github.com/readest/readest/blob/44c90152f6b04e74f71245bb3642d9a7e03042ed/apps/readest-app/src/pages/api/storage/download.ts), [KOReader authentication](https://github.com/readest/readest/blob/44c90152f6b04e74f71245bb3642d9a7e03042ed/apps/readest.koplugin/readest_supabaseauth.lua).
