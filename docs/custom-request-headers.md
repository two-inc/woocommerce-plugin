---
description: "Validation rules and constraints for the Diagnostics custom request-header table."
---

# The custom request-header table

- The Diagnostics header table sends any number of named headers on calls to the Two
  API, each with its own "also send from browser" tick. Every rule the save
  enforces — a non-empty name in the RFC 7230 token set, no reserved name matched
  case-insensitively, no duplicate name, a non-blank value, printable-ASCII values
  — is re-applied on the READ path, because a stored value can arrive from a
  hand-edited row or an import that no form validated.
- **The header table gets no data patch or migration, deliberately.** The
  single-value setting it replaces never reached a production release on any
  platform, so no merchant ever had one configured; do not add one on the
  assumption that stored values exist.
- **A browser-ticked header must already be allowed by the API for
  browser-originated calls**, or the one direct call the browser makes fails CORS
  preflight and the sole-trader autofill silently finds no buyer. Nothing enforces
  it and no field help states it.
- A refusal names the rule, never who sets the header — the reason has to be true of
  every reserved name, not of the one example that prompted the question.
- **The printable-ASCII value pattern carries `/D`.** A bare
  `$` also matches immediately before a trailing newline, which is precisely the
  byte the rule exists to refuse, and a header value ending in one is a
  response-splitting sink.
