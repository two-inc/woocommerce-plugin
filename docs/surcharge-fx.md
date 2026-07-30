# Surcharge FX: what fails closed and what does not

The surcharge grid is configured in the **store** currency
(`woocommerce_currency`) while the pricing request is made in the **active
checkout** currency. When they diverge, the two monetary components — the
fixed surcharge and the cap — are converted via the Two FX layer
(`WC_Twoinc_FX`). The percentage itself is currency-agnostic and never
converted.

Note what the cap actually caps. It is **not** a cap on the percentage
portion: it is an upper limit on the **whole fee line item**, applied after
the percentage passthrough and the fixed surcharge have been summed. So on
`fixed_and_percentage` the cap constrains the fixed component too. (The
passthrough is grossed up before the clamp; the surcharge is grossed up only
under `surcharge_basis = merchant_receives`, which this plugin never sends —
it always sends `buyer_pays`.)

## Fail-closed: no FX rate at all

If no rate can be resolved for the store to checkout pair, the surcharge
cannot be expressed in the request currency at all. Sending a
wrong-currency amount is unacceptable, and silently dropping the surcharge
charges the buyer nothing while telling nobody — so the **payment method is
withheld for the whole checkout**
(`WC_Twoinc_Payment_Terms::surcharge_currency_unquotable()`, called from
`WC_Twoinc::apply_brand_availability_gate()`), and the condition is logged
at error level once per request. `build_buyer_fee_share()` returning `null`
on the same condition is the defence-in-depth backstop for paths the gate
does not run on.

## NOT a failure: a component that converts to 0.00

Both a fixed amount and a cap may round to `0.00` when converted into a much
stronger checkout currency. Neither is a failure; both are relayed as
`0.00`.

- **Fixed → 0.00** — a legitimately tiny configured fee can be genuinely
  negligible in a stronger currency, and `0.00` is the arithmetically
  correct answer. Logged at info, because a surcharge line quietly reading
  `0.00` otherwise looks like a bug.
- **Cap → 0.00** — relayed as `cap => 0`, which makes the pricing API clamp
  the fee to zero. Because the cap bounds the whole line item, this zeroes
  the **entire** fee, including any fixed surcharge configured alongside the
  percentage — not just the percentage portion. That is a bigger effect than
  the fixed case above, so it is logged at info for the same reason: a fee
  line quietly reading `0.00` otherwise looks like a bug.

  It is still the right outcome. The merchant configured a cap that is worth
  nothing in the checkout currency, and "charge no fee" is what that cap
  says. The alternative the guard below chose — withholding the Two payment
  method for the entire checkout — is a far larger consequence for the same
  configuration.

### Correction: the reverted zero-cap guard (TWO-25269)

An earlier revision of `build_buyer_fee_share()` failed **closed** on a
configured cap that converted to `0.00`, on the premise that "a zero cap is
indistinguishable from _no_ cap downstream, so relaying it would send an
UNCAPPED percentage — an overcharge".

**That premise was false, and the guard has been reverted.** The API's fee
calculation and its own test suite were both read directly under TWO-25269,
and all three of the following hold:

- the clamp tests the cap for **presence**, not for truthiness, so a cap of
  zero is applied rather than ignored;
- the request field is optional with a documented minimum of zero, and its
  absence — not a zero value — is what means "no cap". Absence and zero are
  distinct;
- the API's own tests pin the zero-cap case, asserting a resulting fee of
  zero even with a surcharge configured.

So a zero cap is not an uncapped percentage and there is no overcharge. A
cap that converts to zero simply means the surcharge is not applied — which
is already the API's behaviour, so the plugin must not guard against it.

See TWO-25269 for the verbatim source references; they are deliberately not
reproduced here, because this repository is public and the pricing service's
is not.

## Rounding stays

Plugin-side rounding of converted amounts (`WC_Twoinc_Helper::round_amt`)
is **required**, not incidental. The pricing API's money type is fixed at two
decimal places and rejects any value carrying more precision than that, so a
sub-cent amount is a validation error, not a silently-rounded one. Removing
the rounding would turn a converted amount like `0.0008` into an HTTP 422.
