# Readest MCP

A small, read-only MCP server for exploring your Readest books and annotations. Search EPUB/PDF text, highlights and personal notes, then retrieve passages with book, chapter/page and revision references. Your assistant uses that evidence to answer questions.

Choose Readest Cloud or a saved local Readest library. Both expose the same six tools and result schemas. This is an unofficial integration, built with the official TypeScript MCP SDK.

Built for my own reading and research, and shared in the hope that others find it useful. Provided as is; development follows my personal needs and available time. Thoughtful bug reports, fixes and contributions are welcome.

## Install

Requires Node **24.15+ in the 24 LTS line** (including SQLite FTS5).

```sh
git clone https://github.com/gbettineschi/readest-mcp.git
cd readest-mcp
npm ci
npm run build
```

To use keyword search without the optional local embedding runtime, install with `npm ci --omit=optional`. No npm release or binary installer is published yet.

## Configure

Save one of these as `~/.config/readest-mcp/config.json` (create the directory first).

**Readest Cloud**

```json
{"source":"cloud"}
```

Sign in from your own terminal:

```sh
node dist/cli.js login
```

The password prompt is hidden. Only a renewable account session is stored, in a private local file; passwords are not stored. Social-only accounts may need a password set in Readest first. This uses Readest's published sync interface and the account flow documented for KOReader, rather than a separate developer API. Cloud storage access still depends on what is uploaded and accessible to your account.

**Local library, including Readest-managed Drive sync**

```json
{"source":"local","library_dir":"/absolute/path/to/Readest/Books"}
```

Use the directory containing `library.json`. Omit `library_dir` only if one saved library exists in a standard app location. For imported files stored elsewhere, add their parent directories as `content_roots`. The adapter reads saved files passively: download/sync missing books in Readest itself. It does not connect directly to Drive or launch Readest.

Optional shared settings: `cache_dir` and `embeddings: {"enabled":true,"model_dir":"/absolute/path/to/models"}`. Relative paths resolve beside the configuration file; `~` is supported. Keep cache and model directories outside your source content roots. Defaults live under `~/.cache/readest-mcp`.

## Prepare and connect

```sh
node dist/cli.js doctor
node dist/cli.js refresh --content available
```

`refresh --content all` also acquires cloud books where available. `--rebuild` rebuilds generated search data. Neither edits your Readest library. Startup refreshes metadata, not every book's contents; explicit refresh builds the searchable corpus. Reading one book can prepare it on demand.

For Codex, add this to `~/.codex/config.toml`, using absolute paths:

```toml
[mcp_servers.readest]
command = "/absolute/path/to/node24"
args = ["/absolute/path/to/readest-mcp/dist/cli.js", "serve", "--config", "/absolute/path/to/config.json"]
startup_timeout_sec = 30
tool_timeout_sec = 120
```

Other stdio MCP clients use the same command and arguments. Reconnect the client after changing configuration or signing into a different account. See [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Tools

| Tool | Purpose |
|---|---|
| `library_status` | Availability, indexing counts and capabilities |
| `list_books` | Browse/filter known books and saved reading state |
| `get_book` | Book details and available chapter/page structure |
| `list_annotations` | Highlights, comments, bookmarks, excerpts, notebook and ink records |
| `search_library` | Keyword, semantic or hybrid search; select text, quotes or notes |
| `read_content` | Read a passage, chapter/page or annotation; follow continuation cursors |

Results use `data`, `status`, `warnings`, `error` and `meta` in both modes. Metadata reports source, refresh time, cached fallback and known coverage. Normal pagination is not a failure; `ok` does not promise an exhaustive personal library or conceptual search. Quotes and your comments remain separate. References belong to the indexed revision and become stale after an edition change.

Try asking your assistant:

- “List books tagged research and show my notes on one of them.”
- “Search book text for uncertainty; read the matching passages and cite their chapters.”
- “Use hybrid search to find discussions of deciding with incomplete information. Distinguish my comments from the author's text.”

## Optional semantic search

Set `embeddings.enabled` to `true`, then run:

```sh
node dist/cli.js models fetch
node dist/cli.js refresh --content available
```

This explicitly downloads about 140 MB of pinned, checksum-verified multilingual E5-small model files. Inference runs locally on CPU; book text is not uploaded to an embedding service. Long passages are split within the tokenizer budget with source offsets preserved. Hybrid combines keyword and vector ranks. If semantics is unavailable, semantic requests fail clearly and hybrid reports a keyword fallback.

## Limits and verification

EPUB 2/3 and text-bearing PDFs are supported. Scans need OCR elsewhere; encrypted PDFs, extraction gaps and missing files are reported. PDF layout extraction is imperfect. Original annotation locators are preserved; quote context may be ambiguous or unresolved. Ink strokes are retained where available, without handwriting recognition. Large annotation payloads may be explicitly truncated.

Pages default to 20 items (maximum 50); excerpts to 320 characters; content to 4,000 (maximum 12,000, with continuation). Responses are bounded at 64 KiB. Files are limited to 256 MiB, expanded EPUBs to 512 MiB/20,000 entries, extraction to 60 seconds.

Synthetic local/cloud tests exercise all six tools through real MCP processes, plus package installation and exact-reference retrieval. A small real-model test checks English/Italian paraphrases; it is not a quality benchmark. [Compatibility evidence](docs/compatibility.md) distinguishes fixture, live-account and client checks. Cloud compatibility follows a pinned Readest implementation and may need adjustment as Readest evolves.

```sh
npm run typecheck
npm test
READEST_TEST_MODEL=1 npm test -- tests/semantic-model.test.ts
# Opt in only with your private source configured:
READEST_TEST_LIVE=1 npm test -- tests/live.test.ts
```

MIT for original code. See [third-party notices](THIRD_PARTY_NOTICES.md) and [contribution notes](CONTRIBUTING.md).
