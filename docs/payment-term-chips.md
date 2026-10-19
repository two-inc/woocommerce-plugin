---
description: "Keyboard, naming and commit behaviour of the payment-term chip radio group, and the single charged-term resolver."
---

# The payment-term chips are a radio group

- The chips are `button` elements carrying `role="radio"` inside a
  `role="radiogroup"` container, and they implement that role's whole keyboard
  contract: the group is a SINGLE tab stop, carried by the checked chip, and the
  arrow keys move the checked term and the focus together, Home and End jump to the
  ends, and both ends wrap. Both halves or neither: roles without the
  keyboard behaviour advertise something the control does not do, which is its own
  defect.
- **The group is named by the heading above it**, through `aria-labelledby`. That
  heading is a `span`: a `label` names exactly one form control, so as a `label` it
  named nothing and left the group anonymous. A standard-term chip carries no
  `aria-label` — the visible "N days" already reads as a name, and a second one
  risks WCAG 2.5.3.
- **A chip states its term type, not just a day count.** An end-of-month term
  falls due that many days after the end of the month, so a chip reading
  "30 days" on a shop configured that way states the wrong due date. The visible
  text is `30 days` under standard terms and `EOM+30` under end of month, and the
  end-of-month chip alone carries a `title` and an `aria-label` spelling it out:
  `EOM+30: pay 30 days after the end of the month`. The name opens with the
  visible token because WCAG 2.5.3 requires it to contain the visible text. The
  copy is translated PHP-side and reaches the renderer in the checkout bootstrap
  alongside the flag saying which type is stored; a missing end-of-month template
  degrades to the bare `EOM+30` token rather than to a standard-term label.
- **The surcharge's own line states the term type too**, for the same reason the
  chip does: the default wording is `Payment terms fee - 30 days` under standard
  terms and `Payment terms fee - 30 days from end of month` under end of month.
  It is decided once, where the fee line is named, so the cart, the order, the
  emails and the admin order view cannot disagree. A merchant-set line
  description and a brand overlay's fee-line label are both taken verbatim — an
  operator who names the line names all of it.
- **That name states the surcharge as well**, because an `aria-label` replaces the
  whole accessible name and the `+€n,nn` rendered inside the chip is then announced
  nowhere. A priced end-of-month chip is named
  `EOM+30: pay 30 days after the end of the month, plus a €7,25 surcharge`. That is
  a second whole sentence rather than the first with a clause appended, so a
  translator can order the clauses, and its placeholders are numbered because the
  day count and the amount are different values. The chips are rebuilt when the
  quote lands, so the name follows the amount in. A term the quote did not price, a
  set where every term quotes nothing, and a quote still in flight all name no
  amount — the same three states that show no amount on the chip.
- One expression decides both the visual `--selected` class and `aria-checked`, so
  the tick and the exposed state cannot drift apart. A selection matching no offered
  chip leaves nothing checked and puts the tab stop on the first, so the group
  cannot fall out of the tab order.
- **A modified arrow key is left to the browser.** Alt+Left is "back" and
  Ctrl/Cmd+Arrow are the browser's own shortcuts; a group that swallows them breaks
  navigation.
- The focus ring is `:focus-visible`, not `:focus`: with one tab stop the focused
  chip is the only thing saying where the keyboard is, and a clicked chip still gets
  no ring.
- **A re-render replaces every chip, so it destroys the one the buyer is on.**
  `render()` hands focus back to the rebuilt chip carrying the same term. Every fee
  quote, every term selection and every other checkout update re-renders, so without
  it the ordinary click path drops focus to the body too.
- **One resolver decides the term a request is charged for.**
  `WC_Twoinc_Payment_Terms::resolve_charged_term()` prefers the posted hidden
  field and falls back to the session, and the cart fee, the availability gate
  and the order payload all read it. The field follows a chip the moment the
  buyer moves to it while the session follows a round trip later, so a fee
  resolved from the session alone charges the term the buyer left while the order
  is booked on the one they chose.
- **Selection follows focus, so the commit is coalesced.** Each committed change
  costs a selection post, a full checkout update and a fresh fee quote, and an arrow
  sweep crosses every chip on the way. The arrow keys update the chips and the hidden
  `two_selected_term` field in place and arm one delayed commit; a click supersedes a
  commit still waiting. The order is composed on that posted field, current from the
  first keystroke, so the delay costs only the displayed total.
- **The keydown binding is delegated from `document`, not `document.body`.** This
  script is enqueued in the head, where there is no body yet, so a body-rooted
  binding attaches to nothing at all — and jsdom cannot catch it, because the Jest
  harness evaluates the source with a body already present. It is delegated rather
  than bound on the container because a checkout update replaces the payment
  fragment and the container with it, and namespaced with an unbind first so a
  second evaluation of the script replaces the handler instead of stacking one that
  moves the selection twice per key.
