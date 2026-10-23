---
description: "How gateway settings refuse, report and gate unrecognised stored values, and how unresolved fee quotes withhold the method."
---

# Admin settings fail loud: an unrecognised stored value is never priced

The standard for EVERY gateway setting, not only the surcharge method.

- Save refuses it. The field's `validate_<field>_field()` throws for a value
  outside the field's known set, judged on the RAW submission — so a crafted
  POST cannot store a value nothing understands. Only the field's explicit
  unset key persists as the default.
- The merchant is told. A refusal is re-emitted into `WC_Admin_Settings`' static
  error bucket, which outlives the gateway object WooCommerce discards on save
  and which suppresses core's blanket success notice. A gateway's own
  `display_errors()` prints on an object that no longer holds the refusal.
- Read paths raise. The settings reader is the single choke point: it maps the
  unset key to the default and throws for anything else. Callers that price a
  fee or build an order let that throw.
- Gates catch it. The availability-gate filter withdraws the Two gateway and
  nothing else; render-time and wc-ajax callers degrade to "no fee" rather
  than fatalling the page. That judgement runs in admin too, so an
  admin-created order cannot place with the fee silently absent. The reader
  logs the offending value once per request, so the catchers stay quiet.
- Buyer copy stays generic. The buyer sees the existing "not available"
  wording. A setting name, a stored value or an enum key never reaches the
  storefront — those belong in the WooCommerce log and in the admin field's
  own validation message.

Degrading a junk value to a working default is the failure this replaces: it
prices an order under a configuration nobody chose, and nobody is told.

- A quote that never resolved is reported. A configured surcharge the
  pricing service could not price — unreachable, a non-2xx status, an answer that
  cannot be read, or one quoted in a currency the basket is not in — is logged at
  error level naming the term and the cause. A quote that resolved to nothing to
  charge is not a failure and is not reported.
- A quote that never resolved withholds the method at checkout. The
  availability-gate filter quotes the term the basket would be charged for and
  drops the Two gateway when that quote fails, alongside the unmet-minimum and
  no-FX-rate withholds. Only the charged term counts, and only when that term
  has something to charge: one misconfigured term does not take the method
  offline for a checkout not using it, and a resolved zero, a term configured to
  charge nothing — including a cap with no percentage behind it, and the
  default term in fee-difference mode — a term with no surcharge configured
  and an empty basket all withhold nothing and cost no pricing call. A failed
  quote is never cached, so recovery is the next request and every render
  during an outage pays the quote's own timeout. Gate and charge reach the wire
  through the one quote helper on one ceiling, so the gate can never give up
  sooner than the path that charges; the other plugins use the same ceiling. The judgement runs on a checkout
  page carrying the basket the fee applies to: the cart page renders no payment
  method, an admin request is never judged on it, and the admin's own fee
  preview reads the merchant rates rather than a basket quote. Off the checkout page
  the withhold still fires on a failure the cart-fee hook recorded in the same
  request.
- A quote answering in another currency is refused, not cached. The
  answer is checked against the currency it was asked in before the quote is
  stored, so a mismatched answer is reported as a failure once and cannot be
  served again for the rest of the cache window.
- A fee answer that cannot be drawn is refused, not drawn. The rates
  read refuses a set with nothing priced, and one carrying no currency for the
  amounts it does hold, rather than reporting success. On the screens, a term the
  answer did not price is labelled as carrying no figure — never an empty gap in
  the admin, and never a formatted zero on a buyer's chip, both of which read as
  "this term carries no fee". A term priced AT zero still shows its zero.

## A brand can withhold a setting from the form

A brand overlay's `allowed_fields` (see `brands/two.php`) lists the base
settings the form shows; every other base field is withheld (TWO-26610).
WooCommerce neither renders nor saves a withheld field, but its stored value
or declared default still applies. A new setting therefore:

- Reads through `get_option()`, which resolves a withheld field's default.
  Reading `$this->settings` directly sees only what is stored.
- Treats a missing posted value as "cleared" only while the field is on the
  form. A save step that runs before WooCommerce's own loop, as the custom
  request-header table's does, skips a withheld field.
- Is withheld on an overlay until the overlay lists it, so a default-on
  feature still runs there, unseen and uneditable.
