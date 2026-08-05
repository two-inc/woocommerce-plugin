#!/usr/bin/env bash
#
# Every committed .mo must agree with its sibling .po (TWO-25292).
#
# WordPress reads only the compiled .mo, so a .mo that has drifted from its
# .po ships wrong copy — or silently reverts to English — on a translated
# shop, and no other gate can see it. The drift is not hypothetical: .po is
# text and auto-merges on rebase, while .mo is binary and cannot merge, so
# resolving a catalogue conflict by keeping either side is wrong in one
# direction or the other. Keeping "ours" resurrects a msgid the other side
# deleted; keeping "theirs" drops one this side added.
#
# WHY DECODED CATALOGUES RATHER THAN BYTES
#
# Byte-comparing the committed .mo against a fresh msgfmt run is the simpler
# check, and today every committed .mo in this repo is byte-reproducible. But
# the .mo encoder is free to change between gettext releases (string order,
# hash table sizing), the CI runners are self-hosted images this repo does not
# pin, and a byte check would then fail on every unrelated pull request — far
# worse than no check at all. So the comparison decodes both sides with the
# same msgunfmt binary in the same job and diffs the result: whatever gettext
# version the runner carries is applied identically to both sides, and cannot
# on its own produce a mismatch. `msgfmt --version` is printed so a real
# toolchain change is still visible in the log.
#
# Fuzzy and obsolete entries need no special handling for the same reason:
# msgfmt drops them, and it drops them from both sides.
#
# Usage: .github/scripts/check-catalogues.sh   (run from anywhere)

set -euo pipefail

cd "$(dirname "$0")/../.."

fail() {
    echo "::error::$*"
    exit 1
}

for tool in msgfmt msgunfmt; do
    command -v "$tool" >/dev/null 2>&1 ||
        fail "$tool not found — install GNU gettext (apt-get install gettext)"
done

echo "gettext: $(msgfmt --version | head -1)"

shopt -s nullglob
po_files=(languages/*.po)
mo_files=(languages/*.mo)
shopt -u nullglob

# A glob that matched nothing would make this script vacuously green, which is
# the one failure mode a guard must not have.
[ ${#po_files[@]} -gt 0 ] ||
    fail "no .po files found under languages/ — this check would pass vacuously"

echo "checking ${#po_files[@]} catalogue(s)"

tmp=$(mktemp -d) || fail "could not create a temporary directory"
trap 'rm -rf "$tmp"' EXIT

status=0

for po in "${po_files[@]}"; do
    mo="${po%.po}.mo"

    if [ ! -f "$mo" ]; then
        echo "::error file=$po::no compiled catalogue for this source"
        echo "  fix: msgfmt -o $mo $po"
        status=1
        continue
    fi

    # Compile the source the way a developer would, then decode both sides.
    if ! msgfmt -o "$tmp/generated.mo" "$po" 2>"$tmp/msgfmt.err"; then
        echo "::error file=$po::msgfmt cannot compile this source"
        sed 's/^/  /' "$tmp/msgfmt.err"
        status=1
        continue
    fi

    # A catalogue with no (or a charset-less) header decodes to mojibake rather
    # than failing, which would turn the diff below into thousands of lines of
    # "invalid multibyte sequence". Reject it here with something readable.
    if ! msgfmt --check-header -o /dev/null "$po" 2>"$tmp/hdr.err"; then
        echo "::error file=$po::catalogue header is missing or malformed"
        sed 's/^/  /' "$tmp/hdr.err"
        status=1
        continue
    fi

    # A msgstr whose placeholder set differs from its msgid compiles fine and
    # decodes fine, so nothing above can see it — but at runtime sprintf() gets
    # a format string it has no arguments for. The plugin degrades rather than
    # fataling on that (WC_Twoinc::format_api_key_notice), which means a broken
    # translation would otherwise show generic copy in that locale forever with
    # no other signal. Catch it here instead (TWO-25326).
    #
    # KNOWN GAP, deliberately not closed here: msgfmt only inspects entries
    # xgettext flagged "#, php-format", and it flags an entry only when the
    # SOURCE string carries a specifier. So a placeholder-free msgid whose
    # translation invents one stays invisible to this gate. A hand-rolled
    # msgid-vs-msgstr comparison was tried and reverted: it produced false
    # positives on ordinary gettext (plural entries, URL-encoded text like
    # %2F, fuzzy entries), and by this script's own header a gate that fails
    # unrelated pull requests is worse than no gate. The runtime handles that
    # case instead — WC_Twoinc::strip_unfilled_placeholders() drops a
    # specifier nothing will substitute into rather than printing it.
    if ! msgfmt --check-format -o /dev/null "$po" 2>"$tmp/fmt.err"; then
        echo "::error file=$po::a translation's placeholders do not match its source string"
        sed 's/^/  /' "$tmp/fmt.err"
        status=1
        continue
    fi

    if ! msgunfmt -o "$tmp/committed.po" "$mo" 2>"$tmp/unfmt.err" ||
        ! msgunfmt -o "$tmp/generated.po" "$tmp/generated.mo" 2>>"$tmp/unfmt.err"; then
        echo "::error file=$mo::cannot decode this compiled catalogue"
        sed 's/^/  /' "$tmp/unfmt.err"
        status=1
        continue
    fi

    # diff exits 0 for identical, 1 for differing, 2 for trouble. Folding 2
    # into 1 would report a broken diff as a catalogue mismatch and send the
    # developer to recompile a catalogue that was fine.
    diff_status=0
    diff -u --label "$mo (committed)" --label "$po (recompiled)" \
        "$tmp/committed.po" "$tmp/generated.po" >"$tmp/diff.txt" 2>"$tmp/diff.err" ||
        diff_status=$?

    if [ "$diff_status" -gt 1 ]; then
        echo "::error file=$mo::could not diff this catalogue against its source"
        sed 's/^/  /' "$tmp/diff.err"
        status=1
        continue
    fi

    if [ "$diff_status" -eq 0 ]; then
        # Byte equality is not required, but its loss is the only warning that
        # the runner's gettext has started encoding differently, so say so.
        if cmp -s "$mo" "$tmp/generated.mo"; then
            echo "  ok  $mo"
        else
            echo "  ok  $mo (content matches; bytes differ — gettext encoder drift)"
        fi
        continue
    fi

    echo "::error file=$mo::compiled catalogue disagrees with $po — it was not recompiled"
    echo "  fix: msgfmt -o $mo $po"
    echo "  '-' lines are in the committed .mo but NOT in the .po (a string the"
    echo "      .po deleted, still live in the compiled catalogue)"
    echo "  '+' lines are in the .po but NOT in the committed .mo (a string the"
    echo "      .po added, missing from the compiled catalogue)"
    sed 's/^/  /' "$tmp/diff.txt"
    status=1
done

# A .mo with no .po cannot be regenerated or reviewed by anyone.
for mo in "${mo_files[@]}"; do
    po="${mo%.mo}.po"
    if [ ! -f "$po" ]; then
        echo "::error file=$mo::compiled catalogue has no .po source — delete it or add the source"
        status=1
    fi
done

if [ "$status" -ne 0 ]; then
    echo
    echo "::error::catalogue check failed — see the per-file errors above."
    echo "Recompile every locale with: for po in languages/*.po; do msgfmt -o \"\${po%.po}.mo\" \"\$po\"; done"
    exit 1
fi

echo "all catalogues agree with their sources"
