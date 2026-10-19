---
description: "What jsdom can and cannot verify about keyboard and focus, the JS-suite traps, and the focus rules around the sole-trader signup popup."
---

# JS suites, keyboard focus and signup popups

## Keyboard behaviour is not verifiable in jsdom

- jsdom implements no sequential focus navigation: a dispatched `Tab` keydown moves
  focus nowhere, so no Jest suite here can observe a focus trap, a wrong tab order
  or a reverse-Tab dead end, however many cases it carries and however green it is.
  `tests/js/company-search-tab-stop.test.js` therefore asserts only the state the
  browser derives tab order FROM — `tabindex` on the field, `hidden` on the panel,
  document order of the control's parts. The traversal itself is covered by no
  automated test in this repo — the e2e suite has no keyboard case — so it is
  hand-verification only until one is added. A passing jsdom Tab test is never
  evidence that a trap is absent, so no case here may dispatch `Tab` and assert on
  what did not happen:
  an event left undefaulted is what a trap implemented by moving focus looks like
  too.
- Focus a handler moves ITSELF, with `element.focus()`, is the exception: jsdom
  performs that, so arrow-key traversal inside a composite control is directly
  observable where tab order is not. What a suite can pin for tab order is the
  roving `tabindex` the browser derives it from, never the traversal.
- jsdom has no layout and applies no `:focus-visible`, so a focus indicator is
  browser-verification only.

Three more traps in the JS suites:

- **A real chip click fires no `focusin`.** The chip's `mousedown` handler calls
  `preventDefault()`, which suppresses the native focus, so a rule written only
  against `focusin` never sees a pointer buyer at all.
- **jsdom's `getElementById` answers with the first-REGISTERED node, not the
  tree-first one**, so a fixture carrying a duplicate id silently resolves to the
  wrong element.
- **A mutation proves NEW coverage only when re-run against the base ref.** One the
  existing suite already catches proves the suite is sensitive, not that the case
  added covers anything.

## A popup window is in no tab listing

- `window.open` returns a window outside a browser extension's tab group, so a tab
  list can never answer "did the popup open" — nor can a hang. The authoritative
  check is the page's own retained handle and its `.closed`, which means wrapping
  `window.open` before the action that should raise one. Judging from a tab list
  yields a confident false "no window opened".

## What focus landing on the checkout does to an open signup popup

Once the sole-trader tokens are minted, every `focusin` on the checkout is
classified once — whether a popup is up or not — and these are the three rules
(TWO-25658):

- **The role's own Sole trader chip is inert.** Arrival moves the popup neither way
  — only an activation raises it, and the browser delivers Enter and Space on a
  focused chip as a click.
- **Any other target closes an open popup.**
- **A target outside that role's popover closes the popover too**, with the company
  field counted as INSIDE it: the field is the popover's own trigger and sits
  outside the panel node, and a buyer typing a query is still inside the control;
  its own focus opener would otherwise race this rule on event order.

Launchers are not exempt from rule two — a launch blurs whatever holds focus first.
A popover left on screen for the flight around a document focusing nothing reaches
no keystroke at all, so the launch parks that focus on the company field one tick
later, through the panel, which holds off the field's own opener. That one
control is exempt from the rules above for the whole flight: the window losing focus
to the popup blurs the field, and a buyer clicking back into the checkout would
otherwise end their own enrolment. The settle drops the park before it decides where
focus belongs, so what it reads is the unplaced focus the launch actually left.

**Reaching another role's Sole trader chip by FOCUS closes this popup and launches
one for that chip** — the exemption is gated on the chip being inside this role's own
popover, so another role's chip is a target like any other, and the rule then activates
it, its own click handler being the one place a launch is spelled out. Each role holds
its own sole-trader controller (TWO-25658).

**That "own popover" is resolved off the field on every event, never from a stored
node.** The panel builds the popover as the field's SIBLING, and a host that morphs its
server markup over the live DOM rebuilds the popover — and can delete the wrap the panel
built — while keeping the field. Judged against a stored popover, or against one found
by a descendant search under whatever container the field is left in, this role's own
re-rendered chip reads as another role's and the rule inverts on it: returning to the
very chip that launched the popup closes it, and on a two-role page a descendant search
can answer with the other role's popover outright.

## Where a hand-closed signup popup leaves focus

A popup the buyer closes themselves decided nothing, so the launcher still owns
the focus it gave up and gets it back — as long as that launcher survived the
close. The Sole trader chip does not: it lives inside the dropdown the settle
closes. Focus then goes to whichever launcher is still standing, which once a
sole trader is adopted is the "select a different sole trader" link, and that
link reopens the same chooser. Where nothing was adopted, focus goes to the
company name field instead, whose own opener reopens the search popover and
takes the focus into its query.

One consistent target — always the company name field — would read better than
a target that depends on which control the buyer launched from. It is not done:
the field's opener would have to be revised to guarantee the popover opens when
that is wanted and stays closed when it is not, and getting that right is hard
enough that the inconsistency is the safer state to be in.
