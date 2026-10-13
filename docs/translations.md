---
description: "How to regenerate the .pot, merge and compile the .po/.mo catalogues, and what the catalogue CI check rejects."
---

# Translation catalogues

- Regenerate the `.pot` with WP-CLI, never by hand (TWO-25766):
  `docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app wordpress:cli-2.12.0-php8.2 wp i18n make-pot . languages/twoinc-payment-gateway.pot`
  then per locale `msgmerge --no-wrap --no-fuzzy-matching --backup=none --update <po> <pot>`
  and `msgattrib --no-wrap --no-obsolete`. `--no-fuzzy-matching` stops msgmerge
  guessing a translation for a new string from a similar old one; `--no-wrap` is
  required because the unit suite matches catalogue content by literal substring
  and a wrapped `msgstr` reads as untranslated.
- A string reaching `__()` as a variable — an API error body, `fee_line_label`,
  the merchant-configured Title — is invisible to `make-pot`, so its catalogue
  entry is live despite having no `#:` reference. Check before deleting one.
- After editing any `languages/*.po`, recompile its `.mo` — WordPress reads only
  the compiled catalogue: `for po in languages/*.po; do msgfmt -o "${po%.po}.mo" "$po"; done`.
  CI fails when a `.mo` disagrees with its `.po` (`.github/scripts/check-catalogues.sh`).
  That script also rejects a malformed/missing `.po` header and a `msgstr` whose
  placeholders do not match its `msgid` — recompiling fixes neither, so read which
  of the three it reported before reaching for `msgfmt`. A translation must carry
  exactly the conversion specifiers its source string has: nothing substitutes into
  an invented one, and a dropped one silently loses whatever it was going to show.
