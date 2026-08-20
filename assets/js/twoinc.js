let twoincUtilHelper = {
  /**
   * Check if any element in the list is null or empty
   */
  isAnyElementEmpty: function (values) {
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!v || v.length === 0) {
        return true;
      }
    }

    return false;
  },

  /**
   * Normalise a checkout value read out of the DOM to displayable text
   * (TWO-25288).
   *
   * Null, undefined and whitespace-only all become `""`, so callers can treat
   * "is there a value" as a plain truthiness check without a guard of their own.
   *
   * Whitespace-only is the case worth having: the company picker's empty option
   * carries a non-breaking space as its LABEL (its value is `""`), and that
   * label does reach code — `getCompanyName()` reads the picker's rendered
   * selection text out of the checkout snapshot — where it is a one-character
   * string that is truthy and invisible. `trim()` covers it without special
   * handling, since its whitespace definition includes U+00A0.
   *
   * @param {*} value
   * @returns {string}
   */
  blankToEmpty: function (value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  },

  /**
   * Prefix marking an organisation number as internally minted rather than
   * issued by a company registry (TWO-25326 §12).
   *
   * Sole-trader enrollment mints one of these for a buyer who has no registry
   * identifier of their own; it carries the company-type semantics the backend
   * derives on its side. It is a protocol value, not a number the buyer's own
   * authorities would recognise, so showing it to them is meaningless at best
   * and reads as a corrupted field at worst.
   *
   * Matched as a literal, case-sensitive prefix: it is a string the plugin's
   * own backend mints, not something a buyer or a registry ever types, so
   * there is no case or spacing variant to be liberal about. A real
   * organisation number that merely CONTAINS these characters somewhere other
   * than the start is not one of these and stays visible.
   */
  SYNTHETIC_NUMBER_PREFIX: "TWO:",

  /**
   * Is this organisation number internally minted, i.e. one §12 forbids
   * showing (TWO-25326 §12)?
   *
   * For the callers that need to branch on the fact itself rather than just
   * render the filtered value — hiding a whole field, say. Empty is NOT
   * synthetic: "no number captured yet" is a different state from "a number
   * that must not be shown", and only the latter suppresses a field the buyer
   * would otherwise type into.
   *
   * @param {*} value
   * @returns {boolean}
   */
  isSyntheticCompanyNumber: function (value) {
    return twoincUtilHelper
      .blankToEmpty(value)
      .startsWith(twoincUtilHelper.SYNTHETIC_NUMBER_PREFIX);
  },

  /**
   * Normalise an organisation number for DISPLAY (TWO-25326 §12).
   *
   * Returns `""` — never the prefixed value — for an internally minted
   * identifier, so every caller's existing "is there a number" truthiness
   * check doubles as the suppression: a label keyed on it hides itself, a
   * bracketed composition drops its brackets, and no call site needs a filter
   * of its own.
   *
   * DISPLAY ONLY. The value still has to be posted and sent to the API —
   * Two's payment method cannot authorise an order without it — so the
   * submitted `#company_id` input, the instance state and the order-intent
   * payload all keep the raw value. Anything reading this function's result
   * is, by construction, about to put it in front of a human.
   *
   * @param {*} value
   * @returns {string} the number to show, or `""` if it must not be shown
   */
  formatCompanyNumber: function (value) {
    if (twoincUtilHelper.isSyntheticCompanyNumber(value)) return "";
    return twoincUtilHelper.blankToEmpty(value);
  },

  /**
   * Compose the "<label> (<number>)" chunk both company displays use, with
   * the number filtered through formatCompanyNumber (TWO-25326 §12).
   *
   * The brackets belong to the number, not to the composition: when the
   * number resolves to nothing the label is returned bare, never with an
   * empty pair of parens trailing it. That is the whole reason this is one
   * function rather than a filter applied at each call site — two of the
   * three sites had already written the parens as literal text around a
   * value that can now come back empty.
   *
   * `label` is passed through untouched, NOT blank-collapsed, because the
   * two callers disagree about what it contains: the intent notices pass
   * plain text destined for `.text()`, while the search dropdown passes the
   * search response's pre-highlighted HTML fragment destined for innerHTML.
   * Trimming or re-encoding here would have to pick one contract and break
   * the other. Callers that hold plain text collapse it themselves — see
   * formatCompanyLabel below.
   *
   * @param {string} label already in its caller's own escaping contract
   * @param {*} value raw organisation number
   * @returns {string}
   */
  composeCompanyLabel: function (label, value) {
    const number = twoincUtilHelper.formatCompanyNumber(value);
    return label && number ? label + " (" + number + ")" : label;
  },

  /**
   * composeCompanyLabel for a plain-text company name (TWO-25326 §12).
   *
   * @param {*} name
   * @param {*} value
   * @returns {string}
   */
  formatCompanyLabel: function (name, value) {
    return twoincUtilHelper.composeCompanyLabel(twoincUtilHelper.blankToEmpty(name), value);
  },

  /**
   * Construct url to Twoinc checkout api.
   *
   * `client` / `client_v` identify this plugin and its version to the API, and
   * are the only attribution the company-search endpoint can get: the widget
   * runs in the buyer's browser, so the user-agent is the shopper's. They go
   * in the query string rather than a header on purpose — a custom header
   * makes the request non-simple and buys a CORS preflight per keystroke.
   *
   * `params` may be a plain object or a URLSearchParams. It used to be
   * assigned to as an object either way, which silently dropped both fields
   * for every URLSearchParams caller (the company search): `new
   * URLSearchParams(existing)` copies entries, not JS properties. Normalising
   * first, and going through set(), covers both shapes and mutates neither.
   */
  constructTwoincUrl: function (path, params) {
    const searchParams = new URLSearchParams(params || {});
    searchParams.set("client", window.twoinc.client_name);
    searchParams.set("client_v", window.twoinc.client_version);
    return window.twoinc.twoinc_checkout_host + path + "?" + searchParams.toString();
  },

  /**
   * Hash some input to store as key
   */
  getUnsecuredHash: function (inp, seed) {
    if (!seed) seed = 0;
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < inp.length; i++) {
      ch = inp.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
};

/**
 * Which checkout address plays which ROLE, and the one place that decides it
 * (TWO-40 §1).
 *
 * Phrased by role — invoice/billing vs delivery/shipping — never by
 * "primary/secondary". WooCommerce is BILLING-FIRST: `#billing_*` is the
 * always-shown form AND the one that plays the invoice role, so the two happen
 * to coincide here. They do not coincide on PrestaShop, Magento/Luma or Hyvä,
 * where the delivery form is the always-shown one and the invoice form is the
 * conditional one. Anything that reasons about "the primary form" therefore
 * ports wrong in both directions; anything that asks for a ROLE ports cleanly.
 *
 * Every country/company read that feeds sole-trader chip visibility, the
 * signup/token-mint calls, or the two-address mirror goes through here, so
 * they cannot disagree about which form they mean — the duplicated,
 * independently-resolved reads were the documented root cause of several
 * bugs on the PrestaShop implementation this ports from.
 *
 * The payment tile has no address fields of its own, so anything rendered
 * there reads `invoice()` EXPLICITLY rather than "whichever form is on
 * screen".
 */
let twoincAddressRoles = {
  /** WooCommerce field-name prefix of the address that is invoiced. */
  invoice: function () {
    return "billing";
  },

  /** WooCommerce field-name prefix of the address that is delivered to. */
  delivery: function () {
    return "shipping";
  },

  /**
   * `#`-prefixed selector of one field on a role's form.
   *
   * @param {string} role a value returned by invoice()/delivery()
   * @param {string} name unprefixed WooCommerce field name, e.g. "country"
   * @returns {string}
   */
  field: function (role, name) {
    return "#" + role + "_" + name;
  },

  /**
   * Live value of one field on a role's form, trimmed, "" when absent.
   *
   * LIVE, never a committed/saved/session copy: the buyer's current typing is
   * what the chip and the workflow calls are about.
   *
   * @param {string} role
   * @param {string} name
   * @returns {string}
   */
  value: function (role, name) {
    return (jQuery(twoincAddressRoles.field(role, name)).val() || "").trim();
  }
};

/**
 * Mirror the invoice address onto the delivery address, until the buyer edits
 * the delivery address themselves (TWO-40 §2).
 *
 * The delivery address is NEVER locked and never made read-only. A design that
 * mirrored the non-default address read-only was tried and rejected on the
 * platform this ports from, killed by a real business case: one legal entity
 * based in Northern Ireland with a branch in the Republic — no separate
 * registration, but a genuinely different valid country/company pairing on the
 * second address. So the rule is propagate-until-edited, not lock.
 *
 * "Edited" is a pure CONTENT-MATCH check, deliberately not a flag set by UI
 * events: before writing, every field this mirror can write is compared
 * (trimmed, case-insensitive) against the value this mirror last wrote there.
 * ONE field disagreeing pins the WHOLE delivery address, not just that field —
 * per-field granularity was considered and explicitly ruled out, because a
 * buyer who has corrected one line of an address is editing the address, not
 * that line.
 *
 * There is deliberately NO "resume sync" control. Because the check is pure
 * content, clearing the delivery fields back out re-matches on its own and the
 * mirror resumes — an earlier design with an explicit flag tied to UI events
 * was dropped in favour of exactly this property.
 *
 * A field the buyer has left EMPTY counts as still-synced whatever the mirror
 * last wrote, so a freshly-revealed "Ship to a different address?" form (every
 * field blank) mirrors rather than reading as buyer-edited. An empty field
 * holds no buyer content there is anything to protect.
 *
 * Note what this is NOT for on WooCommerce: the org number and company are
 * required on the INVOICE-role address only (§2.7), which here is the
 * always-shown `#billing_*` form — so unlike the shipping-first platforms,
 * WooCommerce can never hide the address that legally needs them. Nothing
 * below adds a required cue to a delivery field.
 */
let twoincAddressMirror = {
  /**
   * Every field this mirror can write, and therefore every field the pin
   * check must watch.
   *
   * `address_2` and `state` are in the list on purpose. A first pass left them
   * out reasoning they were "safe" to overwrite; they are not — a buyer typing
   * into address line 2 is exactly as strong a signal of independent editing
   * as one typing into the city.
   */
  MIRRORED_FIELDS: ["company", "country", "address_1", "address_2", "city", "postcode", "state"],

  /**
   * What this mirror last wrote to each delivery field, i.e. the provenance
   * record the pin check compares against. `null` until seeded.
   *
   * @type {Object<string, string>|null}
   */
  written: null,

  /** Re-entrancy guard: our own writes must not be read as buyer edits. */
  writing: false,

  /** Trimmed, case-insensitive comparison form. */
  normalize: function (value) {
    return twoincUtilHelper.blankToEmpty(value).trim().toLowerCase();
  },

  /**
   * Seed the provenance record from the invoice address, so an unedited
   * delivery form that already agrees with it (WooCommerce prefills a
   * logged-in buyer's saved shipping address, which usually does) reads as
   * synced rather than as buyer-edited.
   *
   * @returns {void}
   */
  seed: function () {
    const invoice = twoincAddressRoles.invoice();
    twoincAddressMirror.written = {};
    twoincAddressMirror.MIRRORED_FIELDS.forEach(function (name) {
      twoincAddressMirror.written[name] = twoincAddressRoles.value(invoice, name);
    });
  },

  /**
   * Whether the delivery address is part of this order at all.
   *
   * WooCommerce keeps the shipping fields in the DOM permanently and gates
   * them on "Ship to a different address?"; with that box unchecked it ignores
   * every one of them on submit and uses the billing address. Writing into
   * them then is pure noise — and noise with a cost, since this plugin's
   * checkout is also live for other payment methods, and quietly rewriting a
   * form that has no bearing on the order is not something a payment gateway
   * should do.
   *
   * Absence of the checkbox means the delivery form is unconditional (a theme
   * that always shows it), so that reads as in-play rather than out.
   *
   * Checking the box fires WooCommerce's own checkout update, and this runs
   * again from `updated_checkout` — so the form is filled the moment it starts
   * to matter, not before.
   *
   * @returns {boolean}
   */
  deliveryFormIsInPlay: function () {
    const $toggle = jQuery("#ship-to-different-address-checkbox");
    return $toggle.length === 0 || $toggle.is(":checked");
  },

  /**
   * Whether the buyer has taken the delivery address over.
   *
   * @returns {boolean}
   */
  isPinned: function () {
    if (twoincAddressMirror.written === null) return false;
    const delivery = twoincAddressRoles.delivery();
    return twoincAddressMirror.MIRRORED_FIELDS.some(function (name) {
      const $field = jQuery(twoincAddressRoles.field(delivery, name));
      // A field the delivery form does not have cannot have been edited.
      if (!$field.length) return false;
      const current = twoincAddressMirror.normalize($field.val());
      if (!current) return false;
      return current !== twoincAddressMirror.normalize(twoincAddressMirror.written[name]);
    });
  },

  /**
   * Propagate the invoice address onto the delivery address, unless pinned.
   *
   * Country is written first and with a `change`, because WooCommerce core's
   * own address-i18n.js rebuilds the state control (select vs text vs absent)
   * off that event — so the state write below has to land on whatever control
   * that rebuild produced, not the one that was there before.
   *
   * @returns {boolean} whether anything was propagated
   */
  sync: function () {
    if (twoincAddressMirror.writing) return false;
    if (twoincAddressMirror.written === null) twoincAddressMirror.seed();
    const delivery = twoincAddressRoles.delivery();
    // Nothing to mirror onto: a checkout with shipping fields switched off
    // entirely (virtual cart, or a store that does not ship).
    if (!jQuery(twoincAddressRoles.field(delivery, "country")).length) return false;
    if (!twoincAddressMirror.deliveryFormIsInPlay()) return false;
    if (twoincAddressMirror.isPinned()) return false;

    const invoice = twoincAddressRoles.invoice();
    twoincAddressMirror.writing = true;
    try {
      twoincAddressMirror.MIRRORED_FIELDS.forEach(function (name) {
        const value = twoincAddressRoles.value(invoice, name);
        const $field = jQuery(twoincAddressRoles.field(delivery, name));
        if (!$field.length) {
          twoincAddressMirror.written[name] = value;
          return;
        }
        if (twoincAddressMirror.normalize($field.val()) !== twoincAddressMirror.normalize(value)) {
          $field.val(value);
          if (name === "country") $field.trigger("change");
        }
        // Record what actually LANDED, not what was intended. A <select> given
        // a value it has no option for keeps its current selection silently,
        // and the delivery country select is exactly that: it lists the
        // countries the store SHIPS to, which is not always the set it bills
        // to. Recording the intended value there would leave the record
        // disagreeing with the field, the next pin check would read that as a
        // buyer edit, and the mirror would pin itself for the session over a
        // write the buyer never made.
        twoincAddressMirror.written[name] = twoincUtilHelper.blankToEmpty($field.val());
      });
    } finally {
      twoincAddressMirror.writing = false;
    }
    return true;
  },

  /** Test seam: forget the provenance record. */
  reset: function () {
    twoincAddressMirror.written = null;
    twoincAddressMirror.writing = false;
  }
};

/**
 * The ONE write path for a captured company, and the guard that keeps a stale
 * organisation number from outliving the name it was captured with
 * (TWO-40 §5).
 *
 * This state machine was the single most repeated bug source on the platform
 * this ports from — write-backs, mirror writes and sole-trader adoption each
 * grew their own copy of "set the number, set the name", and each one was
 * fixed separately, more than once. Three pieces, and they only work together:
 *
 *  1. A PAIRING TAG on the company-name field, recording which organisation
 *     number that particular name was captured under. On the next buyer input
 *     to the name field, a tag that is absent or no longer describes the
 *     name/number pair means the buyer has retyped the name and the number is
 *     stale — so the number is wiped along with the state that depends on it.
 *
 *  2. This SINGLE WRITE HELPER, which sets the number, the name and the tag in
 *     one call. That is not tidiness: any code that sets `#company_id` without
 *     coming through here leaves a pair the tag does not describe, and the
 *     guard wipes it on the buyer's very next keystroke. If a capture keeps
 *     vanishing, look for a raw `.val()` write first.
 *
 *  3. A PROVENANCE MARKER, separate from the tag, recording that a field's
 *     current value came from the plugin rather than from the buyer. The tag
 *     answers "is this pair still consistent"; provenance answers "is this
 *     still ours to overwrite", which is what the delivery-address mirror
 *     needs and what the tag cannot tell it.
 *
 *  4. The CAPTURE MODE — which of the three capture UIs the buyer is currently
 *     using. See the property's own comment.
 *
 * The name and number fields are the INVOICE-role ones — they are what
 * WooCommerce posts and what the order intent is authorised against.
 */
let twoincCompanyCapture = {
  /**
   * Which of the three company-capture UIs is the buyer's ACTIVE input surface
   * (#486, Doug): `'search'` (the selectWoo registry picker, the default),
   * `'manual'` (the plain native `#billing_company`, reached only through
   * `enterManualCompanyEntry`) or `'sole_trader'` (the adopted/enrolled sole
   * trader, whose name the picker renders as its own selection — TWO-40 §7
   * direction (a)).
   *
   * This replaces the runtime mutation of `window.twoinc.enable_company_search`
   * that used to stand in for it. That was an overload of the merchant's admin
   * setting onto a buyer-driven state, and it cost two live bugs: the search
   * widget vanishing on a payment-method switch, and `getCompanyName()` reading
   * the wrong field for an adopted sole trader (starving `isReadyApprovalCheck`
   * so no order intent ever fired). `enable_company_search` is now what its name
   * says — merchant configuration, write-once, never touched at runtime; its
   * real value reaches JS as `window.twoinc.company_search_location`, which
   * decides WHERE the one search control renders, never whether it is active.
   *
   * Distinct from `twoincSoleTrader.mode` (`'business' | 'sole_trader'`), which
   * tracks the CHIP the buyer picked. The two axes cross: a buyer can be
   * `twoincSoleTrader.mode === "business"` while this reads `'manual'`.
   *
   * @type {'search'|'manual'|'sole_trader'}
   */
  mode: "search",

  /** Attribute holding the name/number pairing tag. */
  PAIRING_ATTR: "data-two-company-pairing",

  /** Attribute marking a value as plugin-written rather than buyer-typed. */
  PROVENANCE_ATTR: "data-two-plugin-written",

  nameField: function () {
    return jQuery(twoincAddressRoles.field(twoincAddressRoles.invoice(), "company"));
  },

  numberField: function () {
    return jQuery("#company_id");
  },

  /**
   * The tag describing one name/number pair.
   *
   * Both halves, not just the name: a tag keyed on the name alone would still
   * match after some other code path replaced the number behind it, which is
   * exactly the silent-stale-number case this exists to catch.
   *
   * @param {*} companyName
   * @param {*} companyId
   * @returns {string}
   */
  pairingTag: function (companyName, companyId) {
    return (
      twoincUtilHelper.blankToEmpty(companyName).toLowerCase() +
      "|" +
      twoincUtilHelper.blankToEmpty(companyId)
    );
  },

  /**
   * Write a captured company: number, name, pairing tag and provenance, in one
   * call. THE only sanctioned writer of `#company_id`.
   *
   * @param {*} companyName
   * @param {*} companyId
   * @param {Object} [options]
   * @param {string} [options.country] country the capture belongs to; defaults
   *   to the invoice-role country the form currently holds
   * @returns {void}
   */
  write: function (companyName, companyId, options) {
    const opts = options || {};
    const name = twoincUtilHelper.blankToEmpty(companyName);
    const number = twoincUtilHelper.blankToEmpty(companyId);
    const $name = twoincCompanyCapture.nameField();
    const $number = twoincCompanyCapture.numberField();

    // Written only when the value actually moves. Re-assigning an input's
    // value to what it already holds resets the caret in some browsers, and
    // one caller of this helper is the retype guard, which runs while the
    // buyer has the caret in that very field.
    if (twoincUtilHelper.blankToEmpty($number.val()) !== number) $number.val(number);
    if (twoincUtilHelper.blankToEmpty($name.val()) !== name) $name.val(name);

    if (number) {
      $name.attr(twoincCompanyCapture.PAIRING_ATTR, twoincCompanyCapture.pairingTag(name, number));
      $name.attr(twoincCompanyCapture.PROVENANCE_ATTR, "1");
      $number.attr(twoincCompanyCapture.PROVENANCE_ATTR, "1");
    } else {
      // A name with no number is not a pair, so there is no tag to hold. The
      // manual-entry mode captures exactly that, deliberately.
      twoincCompanyCapture.forgetPairing();
    }

    const instance = Twoinc.getInstance();
    // RAW onto the record, normalised onto the DOM. The record is what goes
    // into `buyer.company` on the order intent verbatim, and normalising it
    // here would change the organisation number this plugin POSTS — a
    // behaviour change nothing in this port asked for. Every comparison
    // against the record already normalises at the point of reading, which is
    // why it can hold a padded string or a JSON number safely.
    instance.customerCompany.company_name = companyName;
    instance.customerCompany.organization_number = companyId;
    // Pin the country the capture belongs to alongside the number, so the pair
    // can never be assembled from two different moments (TWO-25333). Only on a
    // capturing write: a clearing write has no capture for a country to belong
    // to.
    if (number) {
      instance.customerCompany.country_prefix =
        opts.country || twoincSelectWooHelper.currentCountry();
    }
  },

  /** Drop the pairing tag and both provenance markers. */
  forgetPairing: function () {
    twoincCompanyCapture
      .nameField()
      .removeAttr(twoincCompanyCapture.PAIRING_ATTR)
      .removeAttr(twoincCompanyCapture.PROVENANCE_ATTR);
    twoincCompanyCapture.numberField().removeAttr(twoincCompanyCapture.PROVENANCE_ATTR);
  },

  /**
   * Whether a field still holds the value the plugin wrote into it.
   *
   * @param {Object} $field jQuery-wrapped field
   * @returns {boolean}
   */
  isPluginWritten: function ($field) {
    return $field.attr(twoincCompanyCapture.PROVENANCE_ATTR) === "1";
  },

  /**
   * Buyer input on the company-name field: drop a now-stale organisation
   * number, and the state that depends on it.
   *
   * Bound to `input`/`change`, which in this file only ever fire for a real
   * buyer edit — every plugin write goes through `.val()`, which dispatches no
   * event at all.
   *
   * Deliberately does NOT wipe the address fields. The registry address the
   * outgoing company brought with it is stale, but it is also the only address
   * on the form, and destroying an address mid-keystroke costs the buyer more
   * than a stale line does. `registryAddressApplied` is cleared instead, so
   * the next manual-entry switch or country change tidies it.
   *
   * @returns {boolean} whether a stale capture was dropped
   */
  guardCompanyRetype: function () {
    const $name = twoincCompanyCapture.nameField();
    const $number = twoincCompanyCapture.numberField();
    const number = twoincUtilHelper.blankToEmpty($number.val());

    // The buyer's own typing, whatever else follows.
    $name.removeAttr(twoincCompanyCapture.PROVENANCE_ATTR);

    // No number, nothing stale to drop — manual entry captures a name alone
    // by design, and every keystroke there would otherwise take this path.
    if (!number) {
      $name.removeAttr(twoincCompanyCapture.PAIRING_ATTR);
      return false;
    }

    const expected = twoincCompanyCapture.pairingTag($name.val(), number);
    if ($name.attr(twoincCompanyCapture.PAIRING_ATTR) === expected) return false;

    twoincCompanyCapture.write($name.val(), "");

    const instance = Twoinc.getInstance();
    instance.customerCompany.country_prefix = twoincSelectWooHelper.currentCountry();
    instance.registryAddressApplied = false;

    // `#company_id`'s own visibility depends on the value just cleared
    // (TWO-25326 §12), and the verdict on screen was about the company that
    // has just stopped being captured.
    twoincDomHelper.clearIntentVerdicts();
    twoincDomHelper.toggleBusinessFields();
    twoincSelectWooHelper.renderCompanySummary();
    return true;
  }
};

/**
 * Company-search widget: search/dropdown/manual-entry/select2 lifecycle,
 * encapsulated (TWO-25326 architecture rebuild). Mirrors PrestaShop's
 * TwoCompanySearch class — a single class owns the ENTIRE search, dropdown,
 * manual-entry and select2 lifecycle, configured via a constructor options
 * object, with exactly one construction site (below, `twoincSelectWooHelper`).
 * Same class, same dropdown/query-field/manual-entry behaviour, never a
 * second implementation.
 *
 * Company-search-adjacent but checkout-wide concerns — toggling which
 * fields are visible for the selected account type, the intent-message
 * text, sole-trader mode — stay in `twoincDomHelper` / `twoincSoleTrader`
 * below and call into this class's public methods, the same way
 * `Twoinc#enableCompanySearch()` does.
 */
class TwoCompanySearch {
  /**
   * @param {Object} [options]
   * @param {string} [options.companyFieldSelector] CSS selector of the
   *   company-search <select> to attach to. Defaults to
   *   `#billing_company_display`, the id WooCommerce always renders it
   *   under on this plugin's checkout.
   */
  constructor(options) {
    options = options || {};
    this.companyFieldSelector = options.companyFieldSelector || "#billing_company_display";
  }

  /**
   * CSS selector of the <select> this instance attaches selectWoo to. Set
   * from the constructor's options above; declared here (rather than left
   * purely as an instance property) so every other field this class owns is
   * visible in one place.
   */
  companyFieldSelector;

  /**
   * Hard ceiling on a single company-search request, ms (TWO-25232). Before
   * this there was no client timeout at all, so a request that never
   * completed left the dropdown spinning forever. Deliberately wider than
   * the backend's own retry envelope for the upstream provider lookup, so a
   * slow-but-arriving response is never cut off client-side — this is the
   * backstop for a request that does not arrive at all.
   */
  companySearchTimeoutMs = 30000;

  /**
   * Characters the buyer must type before the company search runs
   * (TWO-25288). THE single source of this threshold in the plugin: the
   * widget's minimumInputLength reads it, the "not in the list" button's
   * visibility rule reads it, and the min-chars hint is interpolated from it.
   * The hint's PHP string keeps its %d placeholder unresolved for exactly
   * that reason — the number the buyer is told and the number enforced are
   * the same value, so they cannot drift apart.
   */
  companySearchMinLength = 3;

  /**
   * The dropdown's own search field. select2 tears the dropdown down and
   * rebuilds it on every open, so this node is never the same one twice and
   * nothing may hold a reference to it — every use is a fresh lookup, and
   * every handler on it is delegated.
   */
  companySearchInputSelector = 'input[aria-owns="select2-billing_company_display-results"]';

  /**
   * DOM id of the manual-entry button. Unchanged across TWO-25288 (the
   * cloned-<div> version) and the button rework below, so the stylesheet
   * rule and any brand overlays that match it keep working.
   */
  manualEntryRowId = "company_not_in_btn";

  /** DOM id of the link back out of manual entry and into search. */
  searchCompanyBtnId = "search_company_btn";

  /**
   * DOM id of the mode-chips group (TWO-40 §0) — the `.two-company-mode-chips`
   * equivalent, one level in from the dropdown, direct sibling of the
   * results list. Holds the "Registered company" chip, the "Sole trader"
   * chip (only while available), and the "Enter manually" chip
   * (`manualEntryRowId`), in that order.
   */
  modeChipsWrapperId = "company_mode_chips";

  /** Class on the mode-chips group wrapper. */
  modeChipsWrapperClass = "twoinc-mode-chips";

  /** Shared class on every button inside the mode-chips group. */
  modeChipClass = "twoinc-mode-chip";

  /** DOM id of the "Registered company" mode chip. */
  businessChipId = "company_mode_chip_business";

  /** DOM id of the "Sole trader" mode chip. */
  soleTraderChipId = "company_mode_chip_sole_trader";

  /**
   * Text for a company search that could not be completed. Read lazily
   * because window.twoinc is populated by the checkout render; the literal
   * is the last-resort fallback for a page where the localised string is
   * missing (older cached PHP, brand overlay that trims the text map).
   */
  /**
   * Sequence number of the most recently dispatched company-search request.
   * A superseded request must not act on the shared spinner: select2 does
   * abort the previous request before dispatching the next, so today the
   * hide always lands before the next show — but that ordering is an
   * internal detail of select2's ajax adapter, and a stuck-hidden spinner
   * would be a silent regression if it ever changed.
   */
  companySearchSeq = 0;

  /**
   * Elements the browser will stop on during Tab traversal.
   *
   * Deliberately a superset — `[tabindex]` catches both the select2 combobox
   * span (`tabindex="0"`, not a natively focusable element) and rows that
   * carry `tabindex="-1"` to opt OUT — which is why the caller filters on the
   * live `tabIndex` property rather than trusting the selector alone.
   */
  tabbableSelector =
    "a[href], area[href], input:not([disabled]):not([type=hidden]), " +
    "select:not([disabled]), textarea:not([disabled]), button:not([disabled]), " +
    "iframe, object, embed, [tabindex], [contenteditable]";

  /**
   * The last billing country this page has acted on (TWO-24867 / TWO-25326).
   *
   * `null` until the first known country is seen — by `initialize()`'s seed,
   * by the country handler, or by `onUpdatedCheckout`'s re-sync, whichever
   * gets there first. All three go through `countryDidChange`, so none of
   * them can leave this out of step with the field.
   */
  lastObservedCountry = null;

  /** DOM class of the payment-tile slot the company-search control moves into
   * when `company_search_location` is 'payment_tile' (TWO-25326 §7.1). */
  companySearchTileSlotClass = "twoinc-company-search-tile-slot";

  /**
   * DOM id of the wrapper that holds the relocated company-search control
   * (TWO-25326 §7.1). One element, created once; every move below is this
   * same node changing parent, never a clone.
   */
  companySearchTileWrapperId = "twoinc-company-search-tile-wrapper";

  /**
   * DOM id of the company-number label under the company-name field
   * (TWO-25288, narrowed to number-only by TWO-25326 §7).
   *
   * Id and class kept as `twoinc_company_summary` / `.twoinc-company-summary`
   * even though it no longer summarises anything but the number: brand
   * overlays style this element by class (`.custom-checkout
   * .twoinc-company-summary` in twoinc.css is one in this repo alone), and
   * renaming it would silently drop their styling on a change whose whole
   * purpose is cosmetic.
   */
  companySummaryId = "twoinc_company_summary";

  companySearchUnavailableText() {
    return (
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_search_unavailable) ||
      "Company search is temporarily unavailable. Please try again."
    );
  }

  /**
   * Hint shown in the empty company-search field (TWO-25288). Read lazily for
   * the same reason as the message above.
   */
  companySearchPlaceholderText() {
    return (
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_search_placeholder) ||
      "Enter company name to search"
    );
  }

  /**
   * Hint stating the search threshold (TWO-25288), shown as the query field's
   * own WATERMARK (Doug 2026-08-20, live).
   *
   * Deliberately a FIXED number rather than select2's own "N more characters"
   * countdown: the buyer is told what the field needs, not how far off they
   * currently are. The template carries an unresolved %d, interpolated here
   * from companySearchMinLength, so the claimed minimum is the enforced one.
   *
   * It used to render through select2's `language.inputTooShort` hook, which
   * paints a message ROW inside the results panel — a second on-screen hint
   * directly under the query field, whose own placeholder already read
   * "Enter company name to search". PrestaShop folded the two into the one
   * placeholder slot and this matches it (TWO-40): see
   * `applyQueryFieldPlaceholder`.
   */
  companySearchTooShortText() {
    const template =
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_search_too_short) ||
      "Please enter %d or more characters";
    // Matches gettext's positional form (`%1$d`) as well as the bare `%d` the
    // msgid carries: a translator is entitled to reorder arguments, and the
    // `#, php-format` family of placeholders is what they would reach for. The
    // msgid itself stays `%d` — changing it would invalidate the catalogues.
    return template.replace(/%(\d+\$)?d/, twoincSelectWooHelper.companySearchMinLength);
  }

  /**
   * Label of the "Enter manually" mode chip (TWO-40 §0). Read lazily for the
   * same reason as the hints above.
   *
   * Was "My company is not on the list" (TWO-25288). That copy is gone
   * outright, not kept alongside this chip — it has been fully absorbed
   * into this one label.
   */
  enterManuallyText() {
    return (
      (window.twoinc && window.twoinc.text && window.twoinc.text.enter_manually) || "Enter manually"
    );
  }

  /** Label of the link back out of manual entry and into search. */
  searchCompanyText() {
    return (
      (window.twoinc && window.twoinc.text && window.twoinc.text.search_company) ||
      "Search for company"
    );
  }

  /**
   * Build the manual-entry affordance as a real, focusable button (#30.x.1,
   * #30.x.2, #30.x.3).
   *
   * TWO-25288 made this a pseudo-option `<li role="option">` living INSIDE
   * `.select2-results__options` so it would be arrow-reachable and announced.
   * That traded one accessibility gap for two others:
   *
   *  - `.select2-results__options` is exactly the element select2/selectWoo
   *    apply their own scroll-and-clip to, so the row was only visible if the
   *    buyer scrolled past however many results came back, and the ONLY way
   *    to reach it by keyboard was arrowing down through every one of them —
   *    it carried `tabindex="-1"`, deliberately excluded from the normal Tab
   *    sequence, on purpose, to match the listbox pattern.
   *  - selectWoo's own result-row activation binds on plain `mouseup` with no
   *    button check at all (`Results.prototype.bind`), so a RIGHT click
   *    activated the row exactly like a left click — true of every real
   *    result row too, but only this one was ours to fix.
   *
   * A real `<button>` fixes both: native Tab order, native Enter/Space
   * activation, and a native `click` event that only ever fires for the
   * primary mouse button — no bespoke keydown bridge and no button check to
   * hand-roll.
   *
   * Now one of three `.twoinc-mode-chip` buttons inside `.twoinc-mode-chips`
   * (TWO-40 §0) — see `buildBusinessChip`/`buildSoleTraderChip` and
   * `syncManualEntryButton`, which places the group as a whole.
   *
   * @returns {Object} jQuery-wrapped <button>
   */
  buildManualEntryButton() {
    const helper = twoincSelectWooHelper;

    return jQuery("<button></button>")
      .attr({ id: helper.manualEntryRowId, type: "button", "data-mode": "manual" })
      .addClass(helper.modeChipClass)
      .text(helper.enterManuallyText())
      .on("click", function () {
        helper.activateManualEntry();
      });
  }

  /**
   * Switch out of company search into manual entry, from the button's own
   * click handler (#30.x.3).
   *
   * Removes the button before deferring, same reason as before: a second
   * click in the same tick must not queue a second switch. Deferred out of
   * the click dispatch because entering manual entry destroys this widget,
   * and destroying it from inside the event that is still unwinding on it
   * would pull the DOM out from under that unwind.
   *
   * @returns {void}
   */
  activateManualEntry() {
    const helper = twoincSelectWooHelper;

    // Mid-decision the chip must STAY: the outstanding flight/popup is what
    // decides the buyer's mode, and `enterManualCompanyEntry` refuses in that
    // state anyway — so removing the chip first left no chip AND no manual
    // mode (TWO-40).
    if (twoincSoleTrader.isDeciding()) return;

    // Captured synchronously because the deferred callback cannot tell the two
    // cases apart — both leave `mode === "sole_trader"` by the time it runs:
    // a click made while ALREADY in sole-trader mode is the buyer choosing to
    // leave it, whereas the prefetch switching INTO sole-trader mode during
    // the deferral is the race `enterManualCompanyEntry`'s guard protects.
    const leavingSoleTrader = twoincSoleTrader.mode === "sole_trader";

    jQuery("#" + helper.manualEntryRowId).remove();
    setTimeout(function () {
      // Re-checked against the same predicates: either can change during the
      // deferral, and reverting under an in-flight decision is what every
      // other exit from sole-trader mode refuses to do.
      if (
        leavingSoleTrader &&
        twoincSoleTrader.mode === "sole_trader" &&
        !twoincSoleTrader.isDeciding()
      ) {
        // In here rather than at click time: this destroys the widget the
        // clicked chip lives in, which is what the docblock defers for.
        twoincSoleTrader.setMode("business");
      }
      twoincSelectWooHelper.enterManualCompanyEntry();
    }, 0);
  }

  /**
   * "Registered company" mode chip (TWO-40 §0). A no-op while already in
   * business mode, or while `twoincSoleTrader.isDeciding()` — see the click
   * handler's own comment (TWO-40 §7 correction: the dropdown/widget this
   * chip lives in now deliberately survives a sole-trader autofill flight
   * or open signup popup, so it IS reachable during that wait, not only in
   * business mode as it used to be).
   *
   * @returns {Object} jQuery-wrapped <button>
   */
  buildBusinessChip() {
    const helper = twoincSelectWooHelper;
    const cfg = twoincSoleTrader.config();
    const label = (cfg.text && cfg.text.registered_business) || "Registered company";

    return jQuery("<button></button>")
      .attr({ id: helper.businessChipId, type: "button", "data-mode": "business" })
      .addClass(helper.modeChipClass)
      .text(label)
      .on("click", function () {
        // Refused while sole-trader mode is still DECIDING what it is
        // (TWO-40 §7 correction, round-1 review — Han/Vader): this chip only
        // coexists with `sole_trader` mode DURING that wait (an adopted sole
        // trader destroys the widget it lives in), so acting on it mid-wait
        // raced the buyer against the flight/popup's own resolution —
        // `applyPrefetch` or the ACCEPTED handler could silently reassert or
        // drop what the click just tried to undo. `isDeciding()`, not the
        // wider `isBusy()` (round-3 review — Vader): once adopted, the
        // outcome is already settled and only the popup-close poll hasn't
        // caught up yet — refusing the click for that stretch too is a UX
        // regression, not a safety guard.
        if (twoincSoleTrader.mode === "business" || twoincSoleTrader.isDeciding()) return;
        // Read BEFORE the switch, reopened after (Doug 2026-08-20, live):
        // `setMode`'s business branch destroys this dropdown and re-attaches a
        // fresh, CLOSED widget — see its own comment — so the chip took the
        // whole panel down with it. `syncQueryFieldSuppression` did un-hide the
        // query row correctly; it un-hid it on a dropdown that was no longer on
        // screen. Conditional on it having been open so the other route through
        // the same branch (a mode revert with no dropdown in sight) does not
        // pop one open unasked.
        const wasOpen = twoincSelectWooHelper.companySearchDropdownIsOpen();
        twoincSoleTrader.setMode("business");
        if (!wasOpen) return;
        // Synchronous, still inside the click: selectWoo's outside-click close
        // is a `document.body` mousedown handler bound per OPEN
        // (`BaseSelection._attachCloseHandler`), so the mousedown that produced
        // this click was dispatched before the widget this line opens existed
        // and cannot close it. Focus lands in the query input — the row is
        // visible again by then, `attach()`'s own `select2:open` handler having
        // re-synced the new dropdown's copy of it.
        twoincSelectWooHelper.openCompanySearchDropdown();
      });
  }

  /**
   * "Sole trader" mode chip (TWO-40 §0). Only ever added to the group while
   * `twoincSoleTrader.isAvailable()` — see `syncSoleTraderChip`.
   *
   * @returns {Object} jQuery-wrapped <button>
   */
  buildSoleTraderChip() {
    const helper = twoincSelectWooHelper;
    const cfg = twoincSoleTrader.config();
    const label = (cfg.text && cfg.text.sole_trader) || "Sole trader";

    return jQuery("<button></button>")
      .attr({ id: helper.soleTraderChipId, type: "button", "data-mode": "sole_trader" })
      .addClass(helper.modeChipClass)
      .text(label)
      .on("click", function () {
        twoincSoleTrader.onModeChipClick("sole_trader");
      });
  }

  /**
   * Add or remove the sole-trader chip to match current availability
   * (TWO-40 §0/§1). Split out from `syncManualEntryButton` because
   * availability resolves asynchronously per country and can change while
   * the dropdown is already open and the rest of the group already built.
   *
   * @returns {void}
   */
  syncSoleTraderChip() {
    const helper = twoincSelectWooHelper;
    const $existing = jQuery("#" + helper.soleTraderChipId);

    if (twoincSoleTrader.isAvailable()) {
      if (!$existing.length) {
        jQuery("#" + helper.businessChipId).after(helper.buildSoleTraderChip());
      }
    } else {
      $existing.remove();
    }
  }

  /**
   * Cosmetic-only selected-chip class (TWO-40 §0) — never a visibility
   * mechanism. Manual entry has no "selected" state of its own worth
   * tracking here: activating it destroys the widget the chips live in, so
   * there is nothing left to paint a class onto.
   *
   * @returns {void}
   */
  updateModeChipsSelection() {
    const helper = twoincSelectWooHelper;
    const mode = twoincSoleTrader.mode === "sole_trader" ? "sole_trader" : "business";

    // By class, not `"#" + id` — same reason as `syncManualEntryButton`'s
    // own lookup (see its comment): an id selector only ever finds ONE
    // wrapper even when a stale, orphaned one shares the id, and this is
    // called from every `setMode()` switch, not only right after
    // `syncManualEntryButton` has already deduped.
    jQuery("." + helper.modeChipsWrapperClass)
      .find("." + helper.modeChipClass)
      .each(function () {
        jQuery(this).toggleClass("twoinc-mode-chip--selected", jQuery(this).data("mode") === mode);
      });
  }

  /**
   * Put the mode-chips group right after the results list, or take it away
   * (#30.x.1, TWO-40 §0).
   *
   * A SIBLING of `.select2-results__options`, not a child of it, so it sits
   * outside the part of the dropdown that scrolls: always visible the moment
   * it should be, regardless of how many results came back. Still inside the
   * dropdown itself — appended into `.select2-results`, the same wrapper the
   * results list lives in — so it reads as part of the same panel, just
   * beneath the scrollable area rather than the last row inside it.
   *
   * Holds all three mode chips as ONE group, one wrapper level in from the
   * dropdown (TWO-40 §0 — the same DOM-placement defect ported wrong twice
   * before this): "Registered company", "Sole trader" (while available) and
   * "Enter manually", in that order, so the manual-entry chip — and its own
   * Tab shortcut, keyed on `manualEntryRowId` — stays the group's last
   * child and the last tabbable element in the document, unchanged from
   * before this group existed.
   *
   * Visibility rule is "search UI active", NOT the search threshold
   * (TWO-25326 §2, found live 2026-08-02) and NOT a company already
   * captured (found live 2026-08-02, same date, a second regression): the
   * group only ever exists inside the dropdown, so it is only ever on
   * screen while the dropdown is open — and the dropdown being open IS the
   * buyer searching. There is no independent visibility switch on the group
   * or on any one chip; the dropdown's own open/closed state is the only
   * one (TWO-40 §0).
   *
   * Note this leaves the group in the dropdown's subtree while the dropdown
   * is closed. That is not a stray tab-stop: selectWoo's AttachBody decorator
   * DETACHES the whole dropdown container from the document on close, so a
   * node inside it is not focusable, not rendered and not reachable by Tab
   * until the dropdown is attached again.
   *
   * @returns {void}
   */
  syncManualEntryButton() {
    const helper = twoincSelectWooHelper;

    const picker = jQuery("#billing_company_display").data("select2");
    if (!picker || !picker.$results || !picker.$results.length) return;

    const $list = picker.$results;

    // Sweep away the ENTIRE panel, not just its chip wrapper, for any STALE
    // `.select2-results` belonging to THIS field (round-2 review — Vader:
    // `closeCompanySearchBeforeCheckoutUpdate` deliberately skips closing
    // while a sole-trader flight is outstanding — see its own comment — so
    // a fragment replace during that window can still orphan a whole
    // dropdown here, same as before that fix existed).
    //
    // Scoped by the results-list id, not a blanket `.select2-results` query
    // (round-3 review — Han: an unscoped sweep found and removed WHATEVER
    // select2/selectWoo dropdown happened to be open elsewhere on the page
    // at the same moment — `#billing_country`'s, for one — since this
    // function runs from `twoincSoleTrader.apply()`, an async availability
    // callback with no relation to what else the buyer has open). selectWoo
    // derives that id deterministically from the field's own id
    // (`container.id + "-results"`, vendored `search.js`) — the SAME id on
    // every re-init of THIS field, stale or fresh — so this only ever
    // matches a duplicate for `#billing_company_display`, never another
    // widget's.
    const resultsIdPrefix = "select2-" + helper.companyFieldSelector.replace("#", "") + "-results";
    jQuery("[id^='" + resultsIdPrefix + "']")
      .closest(".select2-results")
      .not($list.closest(".select2-results"))
      .closest(".select2-container--open")
      .remove();

    // By class, not `"#" + id`: an id selector only ever returns ONE match
    // even when a second, orphaned wrapper exists. That second wrapper is
    // real, not hypothetical — WooCommerce's checkout AJAX can replace the
    // `<select>` this widget is attached to (`updated_checkout`'s fragment
    // swap) while its dropdown is open, via a plain `replaceWith()` that
    // never calls `select2("destroy")` on the outgoing element. selectWoo's
    // own AttachBody decorator only detaches the dropdown it renders into
    // `<body>` from inside `destroy()`/`close()` — a widget discarded by
    // having its element torn out from under it, rather than destroyed, so
    // its dropdown (and whatever this function had already appended into
    // it) is orphaned in `<body>` forever. The next open on the freshly
    // re-attached widget then renders a second, independent panel (TWO-40,
    // live-reported by Doug: two `.select2-results` panels, each holding its
    // own `#company_mode_chips`). The class selector catches every wrapper
    // there is regardless of which panel is stale, so this always ends the
    // pass with at most one.
    let $wrapper = jQuery("." + helper.modeChipsWrapperClass);

    // Already there, immediately after the current results list, and no
    // duplicates: nothing to do. Load-bearing rather than an optimisation
    // for the same reason it was before: an unconditional re-append on every
    // keystroke would tear down and rebuild the same nodes for no reason.
    if ($wrapper.length !== 1 || !$wrapper.prev().is($list)) {
      $wrapper.remove();
      $wrapper = jQuery("<div>", {
        id: helper.modeChipsWrapperId,
        class: helper.modeChipsWrapperClass,
        role: "radiogroup"
      });
      $wrapper.append(helper.buildBusinessChip());
      $wrapper.append(helper.buildManualEntryButton());
      $list.after($wrapper);
    }

    helper.syncSoleTraderChip();
    helper.updateModeChipsSelection();
  }

  /**
   * Wire the manual-entry affordance to a company-search widget (TWO-25288,
   * reworked #30.x.1-3).
   *
   * Idempotent by construction. The handler is namespaced and every bind is
   * preceded by the matching `.off()`, so calling this again — and it IS
   * called again, from the 800ms re-run of enableCompanySearch and from every
   * return out of manual entry — leaves exactly one handler bound. The
   * previous implementation bound its input handler inside a polling
   * callback on every dropdown open with no `.off()`, which both accumulated
   * duplicates and missed the first keystrokes of anyone typing faster than
   * the poll interval.
   *
   * No separate activation binding here any more: the button built by
   * `syncManualEntryButton` owns its own click handler directly, since it is
   * a real element outside the results list rather than a pseudo-option the
   * picker's `select2:selecting` event had to be intercepted for.
   *
   * @returns {void}
   */
  bindManualEntryAffordance() {
    const helper = twoincSelectWooHelper;

    // Delegated on <body> rather than bound to the search field: that field
    // is destroyed and rebuilt on every open, and delegation means the
    // handler exists before the buyer's first keystroke rather than after a
    // poll notices the field appeared.
    jQuery(document.body)
      .off("input.twoincManualEntry")
      .on("input.twoincManualEntry", helper.companySearchInputSelector, function () {
        helper.syncManualEntryButton();
      });

    // Open, as well as input (TWO-25326 §2). The button's visibility rule is
    // no longer "the buyer has typed enough", so an `input` handler alone can
    // never place it: a buyer who opens the dropdown and types nothing fires
    // no input event at all, and that is precisely the case the requirement
    // is about.
    //
    // Delegated on <body> keyed on the SELECT, not bound to the select2
    // instance, for the same reason the two handlers above are: the instance
    // is thrown away and rebuilt by `clearSelectedCompany` and by every
    // return out of manual entry, and a handler bound to an instance dies
    // with it. `select2:open` is a jQuery event triggered on the original
    // <select>, so it bubbles to <body> like any other.
    //
    // Deferred a tick: `select2:open` fires while the open is still
    // unwinding, and `syncManualEntryButton` needs the results list to be its
    // post-open self before it anchors anything after it.
    jQuery(document.body)
      .off("select2:open.twoincManualEntry")
      .on("select2:open.twoincManualEntry", "#billing_company_display", function () {
        setTimeout(helper.syncManualEntryButton, 0);
      });

    // Tab-to-button shortcut (#30.x.6).
    //
    // Delegated the same way and for the same reason as the input handler
    // above, which is also what scopes this correctly: a delegated handler on
    // the search-field selector only ever fires while THAT field is the
    // keydown target, i.e. while the dropdown is open and the search field
    // itself has focus. That is deliberately narrower than #416's
    // `focusStillWithinCompanySearch` (which also had to cover option rows and
    // the collapsed combobox for a poll running on a timer regardless of
    // focus) — a keydown listener only ever runs when its target already has
    // focus, so there is nothing to check beyond "is this Tab".
    //
    // Only plain Tab is hijacked. Doug asked for Tab to reach the "not on the
    // list" button directly instead of arrowing down through every result;
    // Shift+Tab is left alone on purpose so reverse-tab keeps its ordinary
    // browser behaviour (move to the previous natural tab-stop) rather than
    // also being routed somewhere non-standard.
    //
    // No-op, not a fallback to default Tab, when the button is not currently
    // in the DOM (below the search threshold): `preventDefault` only fires
    // once a target to focus is confirmed, so a buyer who has not typed
    // enough yet still gets plain browser Tab.
    //
    // `e.which` rather than `e.key`, matching the vendored selectWoo bundle's
    // own convention (its `KEYS` module and every keydown branch in
    // selectWoo.full.js read `evt.which`) — one key-reading convention on
    // this shared event chain rather than two, and immune to the (rare) cases
    // where `.key` comes back blank/"Unidentified" on a real keydown while
    // `.which` still resolves.
    //
    // `stopPropagation` is load-bearing, not belt-and-braces. selectWoo's own
    // core binds a `$(document).on('keydown', ...)` handler (see
    // select2/core.js `bindContainerEvents`) that treats a bare Tab exactly
    // like Enter while the dropdown is open: it fires `results:select` on the
    // highlighted row, THEN unconditionally calls `$searchField.focus()` in
    // the same handler, with no check of `evt.isDefaultPrevented()` first.
    // `document` is above `document.body` in the bubble chain, so without
    // stopping propagation here that handler still runs right after this one
    // and yanks focus straight back onto the search field — `preventDefault`
    // alone was proven insufficient (it does not stop the bubble, only the
    // browser's own native Tab action, which select2's handler does not
    // consult). A side effect, and an intentional one: this also means Tab no
    // longer doubles as "accept the highlighted result" the way selectWoo's
    // own Tab-as-Enter branch otherwise would. That is the point of this
    // change — Doug asked for Tab to be a dedicated shortcut to the button,
    // not a second Enter — and Enter itself is untouched.
    //
    // One more of selectWoo's own timers has to be defended against
    // separately, and `stopPropagation` cannot reach it: the SAME document
    // handler also runs on every ordinary typing keystroke (not just Tab) and
    // schedules `focusOnActiveElement()` — which refocuses whatever result
    // row is currently marked `.select2-results__option--highlighted`, and
    // every fresh result render auto-highlights the first row — 1000ms later.
    // That timer is scheduled from the buyer's PREVIOUS keystroke, before
    // this Tab handler ever runs, so stopping propagation on the Tab event
    // itself does nothing to it. A buyer who types quickly and then hits Tab
    // within that ~1s window (the normal case — fast typers are exactly who
    // this shortcut is for) gets focus yanked back onto the highlighted
    // company row shortly after landing on the button. Confirmed
    // reproducible with fake timers before this comment was written.
    // Re-assert focus on the button once, just past that window, but ONLY if
    // selectWoo's timer actually won (`document.activeElement` is a
    // highlighted result row) and the button is still there — so a buyer who
    // has since moved on deliberately (closed the dropdown, tabbed away,
    // clicked the button) is never fought.
    jQuery(document.body)
      .off("keydown.twoincManualEntry")
      .on("keydown.twoincManualEntry", helper.companySearchInputSelector, function (e) {
        if (e.which !== 9 || e.shiftKey) return;

        // No button to shortcut to — a brand overlay that drops the
        // affordance, or any future gating — must NOT fall through to the
        // browser's own Tab. Measured live 2026-08-02, in exactly that state:
        // selectWoo's document-level handler swallows the keystroke whole
        // (`preventDefault` + refocus the search field), so focus never left
        // the query field and the dropdown never closed. That is a keyboard
        // trap, which §4 forbids outright, and it is what the removed capture
        // gate above was producing. Close and move on instead, the same way
        // Tab from the button does.
        const btn = jQuery("#" + helper.manualEntryRowId).get(0);
        if (!btn) {
          const onwards = helper.tabbablesAfterCompanyField();
          e.preventDefault();
          e.stopPropagation();
          helper.closeCompanySearchDropdown();
          if (!helper.focusFirstThatTakes(onwards)) helper.releaseFocusFromCompanyField();
          setTimeout(function () {
            if (!helper.focusIsBackOnCompanyField()) return;
            if (!helper.focusFirstThatTakes(onwards)) helper.releaseFocusFromCompanyField();
          }, 20);
          return;
        }

        // `.focus()` on a button that is hidden or mid-transition silently
        // no-ops per the HTML spec, so confirm it landed rather than assume —
        // same lesson as the Tab-out handler below, which shipped broken for
        // exactly this reason. If the button will not take focus, fall
        // through to closing and moving on rather than stranding the buyer.
        e.preventDefault();
        e.stopPropagation();
        btn.focus();
        if (document.activeElement !== btn) {
          const onwards = helper.tabbablesAfterCompanyField();
          helper.closeCompanySearchDropdown();
          if (!helper.focusFirstThatTakes(onwards)) helper.releaseFocusFromCompanyField();
          return;
        }

        setTimeout(function () {
          const stillThere = jQuery("#" + helper.manualEntryRowId).get(0);
          const stolenByHighlightedRow = jQuery(document.activeElement).is(
            ".select2-results__option--highlighted"
          );
          if (stillThere && stolenByHighlightedRow) stillThere.focus();
        }, 1100);
      });

    // Second Tab press, this time FROM the button (#30.x.6 follow-up, found
    // under adversarial review before merge — reproduced with a real
    // `select2:select` listener before this fix was written).
    //
    // selectWoo's `isOpen()` (the gate its own document-level Tab-as-Enter
    // handler checks) is purely a CSS class on the container — entirely
    // independent of where DOM focus actually is. Moving focus onto the
    // button above does not close the dropdown or clear that class. So a
    // buyer who lands on the button via the shortcut above and then presses
    // Tab AGAIN — the entirely ordinary next step, trying to move on to the
    // next real page field — has that keydown bubble straight past the
    // button (our other handler is scoped to the search field, not this
    // button) to selectWoo's still-live document handler, which still sees
    // `isOpen() === true` and treats this Tab exactly like Enter: silently
    // fires `results:select` on whatever row is currently highlighted (a
    // company the buyer never chose), `preventDefault`s the buyer's actual
    // Tab-away, then unconditionally refocuses the search field. Net effect:
    // the buyer is trapped AND a wrong company gets silently selected
    // underneath them.
    //
    // `stopPropagation` keeps selectWoo's document handler from ever seeing
    // this keydown. That alone is not enough, and the previous revision of
    // this handler stopped there — which left the two defects TWO-25326 §1
    // and §4 record against WC, both confirmed live 2026-08-02:
    //
    //   1. The dropdown stayed open. selectWoo never clears `isOpen()` on
    //      keyboard-only focus-away — nothing but Escape, a result pick, or a
    //      `mousedown` outside the widget closes it (`_attachCloseHandler` in
    //      the vendored bundle) — so every later Tab/Enter/Escape ANYWHERE on
    //      the page, including Enter on the checkout submit button, kept
    //      getting caught by selectWoo's unscoped document handler until a
    //      stray click finally closed it.
    //   2. Native Tab from here does not reach the next form field. The
    //      dropdown is attached to the END of <body> by selectWoo's AttachBody
    //      decorator, so this button is the last tabbable element in the
    //      document: plain Tab fell off the end of the page and landed on
    //      <body>. Measured, not assumed.
    //
    // Both are fixed together, because fixing either alone cannot work. Tab
    // is now `preventDefault`ed and driven by hand: resolve the next real
    // tab-stop after the company-name control FIRST (while the dropdown is
    // still up and the anchor is still in the document), then close, then
    // focus it.
    //
    // The re-assert on a timer is the part that earns its keep. Closing fires
    // selectWoo's own `container.on('close', ...)`, which schedules
    // `self.$selection.focus()` ~1ms later UNCONDITIONALLY — the exact
    // behaviour the previous revision cited as its reason not to close at all,
    // since it yanks focus back from wherever the buyer legitimately went.
    // Rather than avoid the close, outlast the steal: re-focus the intended
    // target just past that window, and only if the steal actually won, so a
    // buyer who has moved on under their own steam is never fought. That
    // "only if it won" guard is the same shape as the one the search-field
    // Tab shortcut above already uses against selectWoo's other timer.
    //
    // Shift+Tab is deliberately untouched (beyond `stopPropagation`): reverse
    // Tab from here should go back to the query field, which sits immediately
    // before this button inside the same dropdown, and native traversal
    // already does exactly that. Hijacking it would close the dropdown the
    // buyer is trying to move back into.
    // Enter and Space, pressed while the button itself has focus, need the
    // exact same protection as Tab above and for the exact same reason
    // (#30.x.6, round 3) — found live: Doug reported Enter and Space both
    // routing to the search field instead of activating the button.
    //
    // selectWoo's document-level handler (see the long comment above) is
    // gated purely on `isOpen()` — a CSS class on the container, entirely
    // independent of which element currently has focus. Landing on this
    // button via the Tab shortcut does not close the dropdown, so with the
    // dropdown still "open" that SAME handler still sees Enter and Space
    // arriving ANYWHERE on the page, including on this button — but NOT
    // identically to Tab. Checked directly against the vendored bundle
    // (`Select2.prototype._registerEvents`): only Enter and Tab hit the
    // `results:select` branch (silently selecting whatever row is currently
    // highlighted, a company the buyer never chose); plain Space (without
    // Ctrl) matches none of that handler's `if`/`else if` branches at all.
    // Every one of these keys — selected branch or not — falls through to
    // the SAME unconditional tail, though: `$searchField.focus()`
    // immediately, then `focusOnActiveElement()` ~1s later. That fallthrough
    // is what "Enter/Space routes to the search field" actually is for
    // Space; for Enter it is both the silent wrong-row selection AND the
    // same refocus. This button's own `keydown.twoincManualEntryButton`
    // handler only ever intercepted Tab, so Enter and Space kept bubbling
    // straight past it to selectWoo's handler unhindered either way.
    //
    // `stopPropagation`, deliberately WITHOUT `preventDefault`, for Enter and
    // Space too — same reasoning as Tab: the browser's own native "activate a
    // focused <button>" default action for both keys must still run so this
    // button's own `click` handler (bound in `buildManualEntryButton`) fires.
    // Calling `preventDefault` here would suppress that native activation
    // right alongside selectWoo's handler, trading one broken key for
    // another rather than fixing it.
    jQuery(document.body)
      .off("keydown.twoincManualEntryButton")
      .on("keydown.twoincManualEntryButton", "#" + helper.manualEntryRowId, function (e) {
        if (e.which !== 9 && e.which !== 13 && e.which !== 32) return;
        e.stopPropagation();

        // Enter and Space stop here: their native "activate a focused
        // <button>" default action must still run so this button's own click
        // handler fires. Shift+Tab stops here too — see above.
        if (e.which !== 9 || e.shiftKey) return;

        // Resolved BEFORE the close, while the company-name control this is
        // measured from is still the one on screen.
        const candidates = helper.tabbablesAfterCompanyField();

        e.preventDefault();
        helper.closeCompanySearchDropdown();

        // Walk the candidates until one actually takes focus, rather than
        // focusing one and hoping. This is the fix for what Doug found live on
        // the first attempt (PR #427): the dropdown closed correctly but focus
        // stayed on company-name, because the single resolved target could not
        // take focus, `.focus()` said nothing about it, and selectWoo's own
        // post-close refocus was left to win by default.
        //
        // Falling all the way through means nothing after the company field
        // can be focused at all. `<body>` is then the honest answer — Tab
        // again resumes from the top of the document — and it is strictly
        // better than being dumped back on company-name, which is
        // indistinguishable from Tab having done nothing.
        if (!helper.focusFirstThatTakes(candidates)) helper.releaseFocusFromCompanyField();

        // selectWoo schedules `$selection.focus()` 1ms after close,
        // unconditionally (vendored bundle, `container.on('close')`). 20ms
        // clears that comfortably. Re-checked rather than re-applied blindly:
        // only take focus back if the steal actually happened, so a buyer who
        // clicked somewhere else inside the window is never fought.
        setTimeout(function () {
          if (!helper.focusIsBackOnCompanyField()) return;
          if (!helper.focusFirstThatTakes(candidates)) helper.releaseFocusFromCompanyField();
        }, 20);
      });
    // NOTE: #search_company_btn's equivalent Enter/Space fix (round 4,
    // #30.x.7, in getSearchCompanyBtnNode) looks different on purpose — it
    // binds directly on the element and calls preventDefault() +
    // exitManualCompanyEntry() rather than stopPropagation()-and-let-native-
    // activation-proceed like this one does. The two buttons have different
    // interferers (selectWoo's document handler here; something unconfirmed
    // and external there, since selectWoo isn't even alive at that point),
    // so the fix shape differs — see that function's own comment.
  }

  /**
   * Close the company-search dropdown, if one is open (TWO-25326).
   *
   * Goes through the instance rather than `.select2('close')` so it is a
   * no-op — not a thrown "select2 is not a function" — on a page where the
   * widget was never attached, which is every page the buyer reaches with
   * company search disabled.
   *
   * @returns {void}
   */
  closeCompanySearchDropdown() {
    const picker = jQuery("#billing_company_display").data("select2");
    if (picker && typeof picker.close === "function") picker.close();
  }

  /**
   * Is this element hidden, for the purpose of choosing a Tab target?
   *
   * A cheap pre-filter, NOT the guarantee. It reads the ways this checkout
   * actually hides a field — the `hidden` class on the field or an ancestor
   * (the plugin's and WooCommerce's own convention, and how both company
   * inputs are hidden behind the picker in search mode), the `hidden`
   * attribute, and an inline `display: none` — all of which are readable
   * without layout.
   *
   * Deliberately NOT jQuery's `:visible`, which is a layout query
   * (`offsetWidth || offsetHeight || getClientRects().length`). jsdom
   * implements no layout, so under Jest `:visible` reports every element in
   * the document as hidden and a filter built on it would find no tab target
   * ever — the test proving the fix works would pass against a function that
   * always returns nothing.
   *
   * What this cannot see is a field hidden by a stylesheet rule that is none
   * of the above. That is why the caller no longer trusts this: it walks the
   * candidates in order and CHECKS that focus actually landed, because
   * `.focus()` on a non-rendered element silently no-ops per the HTML spec.
   * See `focusFirstThatTakes`.
   *
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  isHiddenForTabbing(el) {
    const $el = jQuery(el);
    if ($el.closest(".hidden, [hidden]").length) return true;
    return Boolean(el.style && el.style.display === "none");
  }

  /**
   * Every real tab-stop after the company-name control, in tab order
   * (TWO-25326 §4).
   *
   * Needed because the dropdown is not where the buyer thinks it is: selectWoo
   * attaches it to the END of `<body>`, so native Tab out of anything inside
   * it walks off the end of the document instead of continuing through the
   * address form. To put focus where the buyer expects it, the traversal has
   * to be recomputed from the control's position in the FORM, not from the
   * focused element's position in the document.
   *
   * Returns a LIST, not just the first hit, and that is the fix for the defect
   * Doug found on the merged first attempt (PR #427, live-tested 2026-08-02):
   * Tab closed the dropdown but left focus sitting on company-name. The old
   * version resolved exactly one element and the caller focused it and assumed
   * it worked. Any reason that one element could not take focus — chiefly a
   * theme hiding it by a stylesheet rule this cannot detect, where `.focus()`
   * silently no-ops — degraded to "nothing focused", which handed the race to
   * selectWoo's own unconditional post-close `$selection.focus()`. Losing that
   * race puts focus back on company-name, which is precisely the symptom. With
   * a list the caller can keep walking until one actually takes.
   *
   * Anchored on the select2 combobox in search mode, falling through to the
   * field wrapper and then the plain input, so the same function answers in
   * both capture modes and survives the combobox not being where it is
   * expected. A missing anchor now yields an empty list rather than a null the
   * caller has to remember to handle.
   *
   * Everything inside an open select2 is excluded. Without that the answer
   * would be the query field or the manual-entry button — both of which follow
   * the anchor in document order, both of which are about to be detached by
   * the close, and neither of which is "the next control in the tab order" in
   * any sense the buyer would recognise.
   *
   * Uses `compareDocumentPosition` rather than an index into the candidate
   * list on purpose: selectWoo flips the combobox's own `tabindex` while the
   * dropdown is open, so the anchor is not reliably a member of the list it is
   * being located within, and an index lookup would return -1 exactly when
   * this is called.
   *
   * @returns {Array<HTMLElement>} in document order, possibly empty
   */
  tabbablesAfterCompanyField() {
    const anchor = twoincSelectWooHelper.companyFieldTabAnchor();
    if (!anchor) return [];

    const found = [];

    // jQuery returns a grouped selector's matches in document order, so
    // appending in iteration order gives the list in tab order.
    jQuery(twoincSelectWooHelper.tabbableSelector).each(function () {
      if (this.tabIndex < 0) return;
      if (jQuery(this).closest(".select2-container--open, .select2-dropdown").length) return;
      if (twoincSelectWooHelper.isHiddenForTabbing(this)) return;
      if (!((anchor.compareDocumentPosition(this) & 4) /* DOCUMENT_POSITION_FOLLOWING */)) return;
      found.push(this);
    });

    return found;
  }

  /**
   * The element the Tab traversal is measured from (TWO-25326 §4).
   *
   * Three candidates rather than the two the first attempt used, in order of
   * how precisely they locate the control the buyer is actually tabbing out
   * of: the rendered combobox, then its `.form-row` wrapper, then the plain
   * input that manual entry uses. The wrapper is the new middle rung — it is
   * present whether or not select2 has rendered, and whether or not the
   * plugin's own field reordering has moved the container, so the anchor no
   * longer disappears just because the combobox is not where it was looked
   * for.
   *
   * @returns {HTMLElement|null}
   */
  companyFieldTabAnchor() {
    const selectors = [
      "#billing_company_display_field .select2-selection",
      "#billing_company_display_field",
      "#billing_company"
    ];

    for (let i = 0; i < selectors.length; i++) {
      const el = jQuery(selectors[i]).get(0);
      if (el) return el;
    }

    return null;
  }

  /**
   * Focus the first candidate that will actually accept focus (TWO-25326 §4).
   *
   * `.focus()` is not a request that can be relied on to succeed: per the HTML
   * spec it silently does nothing on an element that is not being rendered,
   * and returns nothing to say so. A caller that focuses one element and moves
   * on cannot tell "focused" from "no-op", which is the whole reason the first
   * attempt at this fix shipped broken.
   *
   * So: try, then read `document.activeElement` back, and keep walking on
   * failure. The verification is what makes the visibility pre-filter in
   * `isHiddenForTabbing` an optimisation rather than a correctness
   * requirement — a field hidden in a way this plugin cannot detect costs one
   * wasted `.focus()` call and nothing else.
   *
   * @param {Array<HTMLElement>} candidates in tab order
   * @returns {HTMLElement|null} the element that took focus, or null
   */
  focusFirstThatTakes(candidates) {
    for (let i = 0; i < candidates.length; i++) {
      candidates[i].focus();
      if (document.activeElement === candidates[i]) return candidates[i];
    }

    return null;
  }

  /**
   * Is focus back on the company-name control? (TWO-25326 §4)
   *
   * Asked after the dropdown closes, to tell selectWoo's unconditional
   * post-close `$selection.focus()` — scheduled 1ms out, in the vendored
   * bundle's `container.on('close')` — apart from the buyer having deliberately
   * gone somewhere themselves in the meantime. Only the former is worth
   * fighting.
   *
   * Nothing focused (`<body>`) counts as yes. Either the traversal found no
   * target and released focus deliberately, or the browser dropped it when the
   * dropdown was torn out from under it; both are worth one more attempt at
   * the candidates now that the dropdown is gone. What must NOT count is focus
   * sitting on some other real control, which only the buyer can have caused.
   *
   * @returns {boolean}
   */
  focusIsBackOnCompanyField() {
    const active = document.activeElement;
    if (!active || active === document.body) return true;

    return (
      jQuery(active).closest("#billing_company_display_field").length > 0 ||
      active === jQuery("#billing_company").get(0)
    );
  }

  /**
   * Give up on finding a tab target, but do not let the buyer be dumped back
   * where they started (TWO-25326 §4).
   *
   * If nothing after the company field can take focus, `<body>` is the honest
   * answer — the buyer presses Tab again and the browser resumes from the top
   * of the document. Leaving focus on the company-name control instead is
   * strictly worse: it is indistinguishable from Tab having done nothing at
   * all, which is exactly what was reported live.
   *
   * @returns {void}
   */
  releaseFocusFromCompanyField() {
    const active = document.activeElement;
    if (!active || typeof active.blur !== "function") return;
    if (!twoincSelectWooHelper.focusIsBackOnCompanyField()) return;
    if (active === document.body) return;

    active.blur();
  }

  /**
   * The dropdown's query-field wrapper — where the spinner belongs
   * (TWO-25326).
   *
   * Two lookups, because the primary one is conditional on widget state in a
   * way that is easy to miss: selectWoo sets `aria-owns` on the query field
   * in its `container.on('open')` handler and REMOVES it again on close, so
   * `companySearchInputSelector` matches nothing whenever the dropdown is
   * shut. That is correct for the spinner (there is nothing to paint on a
   * closed dropdown) but it makes the selector a state check masquerading as
   * an element lookup, and a caller that runs a tick early or a tick late
   * gets a silent no-op rather than a spinner.
   *
   * The fallback is anchored on the results list's id instead, which is
   * static markup: it identifies THIS field's dropdown specifically, so it
   * can never pick up the country picker's search field, which sits in an
   * identically-classed wrapper whenever that dropdown happens to be open.
   *
   * @returns {Object} jQuery-wrapped wrapper, empty if there is no dropdown
   */
  getCompanySearchFieldContainer() {
    const $byAria = jQuery(twoincSelectWooHelper.companySearchInputSelector).parent();
    if ($byAria.length) return $byAria;

    return jQuery("#select2-billing_company_display-results")
      .closest(".select2-dropdown")
      .find(".select2-search--dropdown")
      .first();
  }

  /**
   * Toggle the in-field search spinner (TWO-25288).
   *
   * The spinner is a single childless element: the stylesheet paints an
   * animated loading GIF onto it as a background-image, so there is no inner
   * markup and no asset URL for this function to keep in step with the
   * stylesheet. aria-hidden keeps it out of the accessibility tree — it is
   * decoration, and select2 already announces search state through the
   * results list.
   *
   * Removed rather than hidden when the search ends. The search input lives
   * inside the dropdown, which select2 tears down and rebuilds on every
   * open, so add-then-remove keeps at most one node alive and leaves no
   * animating element running behind a closed dropdown.
   *
   * The COMPANY-SEARCH request is the only thing that ever paints here. The
   * sole-trader round trip used to share this node — through a two-owner
   * arbiter, so neither could take it down under the other — and now paints
   * over the company-NAME field instead (`syncSoleTraderSpinner`), which is
   * the field that flow is actually filling in. Nothing arbitrates between
   * the two any more because they are two nodes in two places, and
   * `companySearchSeq` already decides which of two overlapping searches owns
   * this one.
   */
  toggleCompanySearchSpinner(isSearching) {
    const $search = twoincSelectWooHelper.getCompanySearchFieldContainer();
    if ($search.length === 0) return;
    $search.find(".twoinc-search-spinner").remove();
    if (isSearching) {
      $search.append('<span class="twoinc-search-spinner" aria-hidden="true"></span>');
    }
    $search.toggleClass("twoinc-searching", !!isSearching);
  }

  /**
   * Hide the dropdown's own free-text query row while sole-trader mode owns
   * the company field (item 2.1, TWO-40).
   *
   * A pure function of MODE, and of nothing else (Doug 2026-08-20). It used
   * to be ANDed with `soleTraderAdopted` and stood down again while
   * `isBusy()`, which made the row visible for the whole stretch between the
   * chip click and the adoption it leads to — the buyer clicked "Sole trader"
   * and was left looking at a company-search box that no longer searches for
   * their company. Both extra terms existed for the same one reason: the
   * in-flight spinner used to paint inside this row (see
   * `toggleCompanySearchSpinner`), so the row had to be on screen for any
   * flight to be visible. `syncSoleTraderSpinner` moved that spinner to the
   * company-NAME field, which is what lets this collapse to the one term it
   * was always meant to be.
   *
   * HIDDEN, not merely `readonly` (Doug live-test finding: an earlier round
   * made it readonly and left it painted, which reads as a search box that
   * has stopped working). `display: none` plus the `hidden` attribute rather
   * than `visibility`/`opacity`, so the input leaves the tab order with it —
   * a keyboard-only buyer must not land on a field they cannot see. The
   * readonly stays on top of the hide: selectWoo's own `container.on('open')`
   * focuses this input unconditionally, and a hidden-but-typable field is
   * exactly the state the readonly was added for.
   *
   * The whole SEARCH ROW goes, not just the input: hiding the input alone
   * leaves an empty painted row where a search box was.
   *
   * Both directions, every open AND every mode write, deliberately: selectWoo
   * renders this row ONCE per widget instance and re-attaches the same node on
   * every open (its `dropdown/search` adapter's `render`), so a suppression
   * applied on one open outlives that open. Leaving sole-trader mode by
   * picking a different company straight off the live widget is the path that
   * proves it — that one deliberately does not destroy the widget, so nothing
   * else would ever give the row back.
   *
   * @returns {void}
   */
  syncQueryFieldSuppression() {
    const $row = twoincSelectWooHelper.getCompanySearchFieldContainer();
    if ($row.length === 0) return;
    const $query = $row.find(".select2-search__field");
    const suppressed = twoincSoleTrader.mode === "sole_trader";

    $query.prop("readonly", suppressed);
    if (suppressed) {
      // A term typed before switching describes a company the buyer then did
      // not pick; restoring it would sit above results that no longer match.
      $query.val("");
      $row.hide().attr("hidden", "hidden");
    } else {
      $row.removeAttr("hidden").show();
    }
  }

  /**
   * (Re-)initialise selectWoo on the company field, with the two bits of
   * post-init wiring every init path owes (Doug 2026-08-20).
   *
   * Both wirings act on nodes selectWoo creates in its own constructor — the
   * dropdown's query input, and the results list a message row is appended to
   * — so they can only be applied per widget INSTANCE, which is what makes
   * them this function rather than two more entries in `genSelectWooParams`.
   * There are two init sites (`attach()` and `clearSelectedCompany()`, see the
   * latter's own comment for why it does not go through the former) and this
   * file's history is mostly the story of two such sites drifting apart.
   *
   * @param {Object} $field jQuery-wrapped `<select>`
   * @returns {Object} the jQuery-wrapped selectWoo widget
   */
  initCompanySearchWidget($field) {
    const helper = twoincSelectWooHelper;
    const widget = $field.selectWoo(helper.genSelectWooParams());
    helper.applyQueryFieldPlaceholder($field);
    helper.suppressQueryTooShortMessage($field);
    return widget;
  }

  /**
   * Put the length requirement in the query field's own watermark (Doug
   * 2026-08-20), a plain `placeholder` attribute, matching how PrestaShop
   * presents the same rule.
   *
   * Read off the INSTANCE rather than the document: selectWoo renders the
   * query row once, in its constructor, but its AttachBody decorator keeps the
   * whole dropdown detached from the document until the first open — so the
   * document-scoped `getCompanySearchFieldContainer()` finds nothing at the
   * only moment this needs to run. `$dropdown` holds the same node open or
   * closed, which is also why applying this once per instance is enough
   * (`syncQueryFieldSuppression`'s own comment documents that persistence).
   *
   * @param {Object} $field jQuery-wrapped `<select>`
   * @returns {void}
   */
  applyQueryFieldPlaceholder($field) {
    const picker = $field.data("select2");
    if (!picker || !picker.$dropdown) return;
    picker.$dropdown
      .find(".select2-search__field")
      .attr("placeholder", twoincSelectWooHelper.companySearchTooShortText());
  }

  /**
   * Stop select2 painting its own "input too short" row under the query field
   * (Doug 2026-08-20).
   *
   * The requirement is now the field's watermark
   * (`applyQueryFieldPlaceholder`), and two hints for one rule — the second of
   * them a row inside the results panel, directly beneath the field the first
   * one is in — is the noise this removes.
   *
   * Bound on the instance, not the element: `results:message` is internal to
   * select2 and is not one of the events it relays to the DOM node. Removing
   * the row rather than blanking the message via `language.inputTooShort`,
   * which still appends an empty `<li>` (`Results.displayMessage` appends
   * unconditionally) and so still leaves a painted strip. Runs in the same
   * turn as the append, our handler being bound after the one Results itself
   * installs, so nothing is ever rendered in between.
   *
   * @param {Object} $field jQuery-wrapped `<select>`
   * @returns {void}
   */
  suppressQueryTooShortMessage($field) {
    const picker = $field.data("select2");
    if (!picker || typeof picker.on !== "function") return;
    picker.on("results:message", function (params) {
      if (!params || params.message !== "inputTooShort") return;
      if (picker.$results) picker.$results.find(".select2-results__message").remove();
    });
  }

  /**
   * Class of the sole-trader in-flight spinner (TWO-40, Doug 2026-08-20).
   *
   * A class, not an id, for the same reason `modeChipsWrapperClass` is one: a
   * checkout fragment swap can orphan a whole dropdown/field wrapper with our
   * nodes inside it (see `syncManualEntryButton`), and an id selector finds
   * only ONE of two — leaving the other animating forever behind a settled
   * flow.
   */
  soleTraderSpinnerClass = "twoinc-sole-trader-spinner";

  /** Marker class on whichever element currently hosts that spinner. */
  soleTraderSpinnerHostClass = "twoinc-name-searching";

  /**
   * The element the sole-trader spinner paints over: the box of whichever of
   * the two company-NAME surfaces is currently the visible one (Doug
   * 2026-08-20).
   *
   * Same "whichever is showing" question `getCompanySummaryNode()` answers for
   * the number label, and answered the same way — the search control wins
   * while it is showing (it is the name surface in sole-trader mode, see
   * `toggleBusinessFields`), the native field takes over when it is not, and
   * both are handled because mode can be `sole_trader` while a capture-mode or
   * country switch has the other one on screen.
   *
   * The INPUT BOX, not the field row: `.select2-selection` and
   * `.woocommerce-input-wrapper` bound the control itself, whereas the row
   * wraps the label too — so vertically centring in the row would float the
   * spinner over the label. Same reason `companyFieldAffordanceSlot()` (reused
   * here, self-heal and all) exists rather than appending on
   * `#billing_company_field`.
   *
   * @returns {Object} jQuery-wrapped host, empty if there is no name field
   */
  soleTraderSpinnerHost() {
    const $picker = jQuery("#billing_company_display_field");
    if ($picker.length && !$picker.hasClass("hidden")) {
      const $selection = $picker.find(".select2-selection").first();
      return $selection.length ? $selection : $picker;
    }
    return twoincSelectWooHelper.companyFieldAffordanceSlot();
  }

  /**
   * Show the sole-trader spinner for exactly as long as the flow is running
   * (Doug 2026-08-20).
   *
   * DERIVED from state on every call rather than held between two calls: the
   * two inputs — mode and `flightDepth` — move independently. A chip click
   * landing on top of an email-change prefetch that is already in flight
   * starts no new flight of its own (`onModeChipClick`), so a hold taken at
   * `beginFlight` would have missed the very wait the buyer is watching; and
   * the host itself moves when the visible name surface does. Called from both
   * flight edges and from every write to `mode`.
   *
   * `mode === "sole_trader"` is what keeps it off the buyer's screen during
   * the background prefetch an email edit fires in business mode — a request
   * they never asked for, over a field they are not waiting on.
   *
   * Remove-then-add, same as `toggleCompanySearchSpinner`: at most one node
   * exists, wherever the host has moved to, and nothing animates on behind a
   * settled flow.
   *
   * @returns {void}
   */
  syncSoleTraderSpinner() {
    const helper = twoincSelectWooHelper;
    jQuery("." + helper.soleTraderSpinnerClass).remove();
    jQuery("." + helper.soleTraderSpinnerHostClass).removeClass(helper.soleTraderSpinnerHostClass);

    if (twoincSoleTrader.mode !== "sole_trader" || twoincSoleTrader.flightDepth === 0) return;

    const $host = helper.soleTraderSpinnerHost();
    if ($host.length === 0) return;
    $host
      .addClass(helper.soleTraderSpinnerHostClass)
      .append(
        '<span class="twoinc-search-spinner ' +
          helper.soleTraderSpinnerClass +
          '" aria-hidden="true"></span>'
      );
  }

  /**
   * Everything the sole-trader flow's two dropdown/field surfaces derive from
   * `mode` and `flightDepth` (Doug 2026-08-20).
   *
   * One call site per state change rather than two, so the query row and the
   * spinner cannot be re-synced by different sets of callers and drift apart —
   * which is exactly how the row ended up ANDed with `soleTraderAdopted` while
   * the spinner was held on flight edges alone.
   *
   * @returns {void}
   */
  syncSoleTraderSurfaces() {
    twoincSelectWooHelper.syncQueryFieldSuppression();
    twoincSelectWooHelper.syncSoleTraderSpinner();
  }

  /**
   * Close the company-search dropdown if — and only if — it is open (Doug
   * 2026-08-20).
   *
   * The one difference between the sole-trader flow's two entry points: the
   * mode chip is clicked from inside an open dropdown and leaves it open for
   * the whole flow, while the "select a different sole trader" link is clicked
   * with no dropdown on screen at all. Asking "is it open" at the end, instead
   * of remembering which entry point started the flow, is what lets both share
   * one sequence — spinner up, wait for the flow to complete, close the
   * dropdown, spinner down — with this call a no-op for the link.
   *
   * @returns {void}
   */
  closeCompanySearchDropdownIfOpen() {
    if (!twoincSelectWooHelper.companySearchDropdownIsOpen()) return;
    jQuery("#billing_company_display").select2("close");
  }

  /**
   * Is the company-search dropdown currently on screen (Doug 2026-08-20)?
   *
   * Asked by two callers with opposite intentions — the settle sequence
   * above, which only closes what is open, and the Business chip, which only
   * REOPENS what was open before `setMode()` tore the widget down — so it is
   * one predicate rather than the same three-clause guard written twice.
   *
   * @returns {boolean}
   */
  companySearchDropdownIsOpen() {
    const select2 = jQuery("#billing_company_display").data("select2");
    return !!select2 && typeof select2.isOpen === "function" && select2.isOpen();
  }

  /**
   * Replace the results list with the "search unavailable" message. Goes
   * through select2's own results:message channel (the results adapter
   * listens on the container for it) so the message is cleared on the next
   * query like any other, instead of us hand-managing dropdown DOM.
   */
  showCompanySearchUnavailable() {
    const select2 = jQuery("#billing_company_display").data("select2");
    if (select2 && typeof select2.trigger === "function") {
      select2.trigger("results:message", { message: "errorLoading" });
    }
  }

  /**
   * The billing country the checkout form currently holds, upper-cased, or
   * "" when the field is absent or unset (TWO-24867).
   *
   * The reader for the three country-sensitive paths added or changed by
   * TWO-24867 — the search request, the change guard and the address-lookup
   * supersession check — so those three can never disagree about what "the
   * current country" is.
   *
   * `twoincSoleTrader.currentCountry()` delegates to this one, so the
   * per-country availability cache cannot be keyed on a different answer.
   *
   * THE only country reader in the file as of TWO-40 §1: `getCompanyData()`
   * and `isCountrySupported()` used to read `.val()` raw and uncased, so the
   * `country_prefix` this file's handler writes upper-cased was replaced with
   * the raw value by `clearSelectedCompany`'s deferred re-read. Both go
   * through here now — §1's "resolve country ONE way and reuse it everywhere"
   * is the whole point, and a second resolver that agrees today is exactly
   * the shape that stopped agreeing on the platform this ports from.
   *
   * Reads the INVOICE-role form explicitly (`twoincAddressRoles`), not
   * "whichever address form is on screen" — see that object's doc comment.
   */
  currentCountry() {
    return twoincAddressRoles.value(twoincAddressRoles.invoice(), "country").toUpperCase();
  }

  /**
   * Whether a `change` event on #billing_country represents a REAL country
   * change, as opposed to WooCommerce re-emitting one during its own
   * re-render (TWO-25326).
   *
   * The handler this gates destroys the captured company — #billing_company,
   * #company_id, the picker's selection and the registry address behind it.
   * WooCommerce fires `change` on #billing_country for reasons that are not
   * the buyer changing country: `updated_checkout` re-renders the billing
   * fields and core's address-i18n.js re-triggers the field on
   * `country_to_state_changing` at init, not only on a user gesture. Bound
   * delegated on document.body, this handler saw all of them, so a buyer who
   * had picked a company watched it vanish on an unrelated re-render with no
   * action of their own — observed live on TWO-25326.
   *
   * Compared by value rather than by `event.originalEvent` being present:
   * WooCommerce's re-render path re-triggers through jQuery on some themes
   * and dispatches a native event on others, so an event-source test would
   * hold on the fixture and fail on the shop. The value comparison is true
   * to what the handler actually needs to know.
   *
   * Records the new value as a side effect, so the caller must invoke this
   * exactly once per event and act on its answer.
   *
   * Two flavours of "unknown" are deliberately NOT a change, and neither is
   * incidental:
   *
   *   - An empty reading. WooCommerce replaces #billing_country wholesale on
   *     some re-renders, so a poll landing mid-replacement reads "". Treated
   *     as a change that would clear the captured company for nothing. It is
   *     also not RECORDED, so a genuine switch that completes after the gap
   *     is still compared against the last real country and still acts.
   *   - The first known country, whatever this was called from. There is no
   *     previous country to have moved away from, so there is nothing to
   *     invalidate: on a checkout restored from a saved address the company
   *     and the country arrive together.
   *
   * @param {string} country upper-cased ISO code currently in the field
   * @returns {boolean}
   */
  countryDidChange(country) {
    if (!country) {
      return false;
    }
    const previous = twoincSelectWooHelper.lastObservedCountry;
    twoincSelectWooHelper.lastObservedCountry = country;
    return !!previous && country !== previous;
  }

  /**
   * Generate parameters for selectwoo
   */
  genSelectWooParams() {
    let twoincSearchLimit = 50;
    return {
      minimumInputLength: twoincSelectWooHelper.companySearchMinLength,
      // Empty-field hint (TWO-25288). select2 renders this through
      // templateSelection below, and only while the current selection's id
      // matches the placeholder's — which is why the field's empty option has
      // to carry value="" rather than only a non-breaking space.
      placeholder: twoincSelectWooHelper.companySearchPlaceholderText(),
      width: "100%",
      escapeMarkup: function (markup) {
        return markup;
      },
      templateResult: function (data) {
        return data.html;
      },
      templateSelection: function (data) {
        return data.text;
      },
      language: {
        errorLoading: function () {
          // Only ever reached deliberately now: the custom ajax transport
          // below suppresses the cancelled-request case (which is why this
          // used to masquerade as "searching…") and raises this message
          // only for a timeout, a transport error, or a degraded response.
          return twoincSelectWooHelper.companySearchUnavailableText();
        },
        // No `inputTooShort` (Doug 2026-08-20): the threshold is the query
        // field's watermark now, and select2's row for it is suppressed
        // outright — see `applyQueryFieldPlaceholder` /
        // `suppressQueryTooShortMessage`.
        noResults: function () {
          return wc_country_select_params.i18n_no_matches;
        },
        searching: function () {
          return wc_country_select_params.i18n_searching;
        }
      },
      ajax: {
        dataType: "json",
        // 300ms across all three plugin checkouts (was 200 here).
        delay: 300,
        /**
         * Replaces select2's default transport so the request carries a
         * timeout and so failures can be told apart. select2's own failure
         * handler cannot make that distinction — it treats any jqXHR with
         * status 0 as a cancellation, and a jQuery timeout also reports
         * status 0 — which is why failure() is not called from here at all
         * and this code owns the messaging.
         */
        transport: function (params, success) {
          const seq = ++twoincSelectWooHelper.companySearchSeq;
          twoincSelectWooHelper.toggleCompanySearchSpinner(true);

          const request = jQuery.ajax(
            jQuery.extend({}, params, {
              timeout: twoincSelectWooHelper.companySearchTimeoutMs
            })
          );

          request.done(function (data) {
            // Same supersession rule as the failure path: a stale response
            // must not repopulate the list under a newer search.
            if (seq !== twoincSelectWooHelper.companySearchSeq) return;
            // `degraded` marks an HTTP 200 whose (near-empty) result set is
            // unreliable because the upstream provider lookup timed out.
            // The field may not be deployed yet, so absent must read as not
            // degraded — hence the explicit === true rather than truthiness.
            if (data && data.degraded === true) {
              success({ items: [] });
              twoincSelectWooHelper.showCompanySearchUnavailable();
              return;
            }
            success(data);
          });

          request.fail(function (jqXHR, textStatus) {
            // A cancelled request is routine: select2 aborts the in-flight
            // search on every keystroke, and the widget is re-created on
            // country change. Those must stay silent. A timeout or a real
            // transport error must not — left silent it renders as "no
            // companies found", which is a wrong answer, not a missing one.
            if (textStatus === "abort") return;
            // A superseded request must not paint over a newer one's results.
            if (seq !== twoincSelectWooHelper.companySearchSeq) return;
            twoincSelectWooHelper.showCompanySearchUnavailable();
          });

          request.always(function () {
            // Only the newest request owns the spinner (see companySearchSeq).
            if (seq !== twoincSelectWooHelper.companySearchSeq) return;
            twoincSelectWooHelper.toggleCompanySearchSpinner(false);
          });

          return request;
        },
        url: function (params) {
          // Read live, per request — NOT captured when the widget was built
          // (TWO-24867). The widget outlives a country change on any path
          // that does not rebuild it: WooCommerce replaces #billing_country
          // wholesale on some `updated_checkout` re-renders, address-i18n.js
          // rewrites the field without a user gesture, and a programmatic
          // `.val()` fires no `change` at all. A captured value made the
          // search query the PREVIOUS country's register while the form said
          // otherwise — the buyer saw "no companies found" for a company that
          // exists, which reads as a broken registry rather than stale state.
          const searchParams = new URLSearchParams({
            country: twoincSelectWooHelper.currentCountry(),
            limit: twoincSearchLimit,
            offset: (params.page || 0) * twoincSearchLimit,
            q: decodeURIComponent(params.term)
          });
          return twoincUtilHelper.constructTwoincUrl("/companies/v2/company", searchParams);
        },
        data: function () {
          return {};
        },
        processResults: function (response, params) {
          const items = [];
          // A degraded response is fed through here with a synthesised
          // empty payload, and a malformed body must not throw either.
          const rawItems = response && Array.isArray(response.items) ? response.items : [];
          for (let i = 0; i < rawItems.length; i++) {
            const item = rawItems[i];
            // `national_identifier` is optional in the search response — the
            // company may have none in its home registry, and its `id` may be
            // null or empty. Reading it unguarded threw here, and a throw in
            // this callback happens inside select2's query pipeline: it kills
            // the whole result list, not just this hit, leaving the dropdown
            // stuck on "Searching…". So render the company with whatever it
            // has: the identifier is the buyer's disambiguator between two
            // similarly-named companies, but dropping the hit entirely would
            // remove a selectable company. Without one the buyer sees the
            // company name alone and types the organisation number into the
            // (still required) company_id field themselves.
            const identifier =
              item.national_identifier && item.national_identifier.id
                ? String(item.national_identifier.id)
                : "";
            items.push({
              id: item.name,
              text: item.name,
              // TWO-25326 §12: `identifier` stays raw on `company_id` below —
              // that is the value the picker writes to the submitted field and
              // sends to the API — while what the buyer READS goes through the
              // shared composer, which drops an internally minted number along
              // with the brackets that would otherwise be left empty around it.
              // `item.highlight` is the response's pre-highlighted HTML, so it
              // is passed through as an already-marked-up fragment rather than
              // being re-encoded (composeCompanyLabel does not touch its label).
              //
              // Falling back to the plain name for the same reason the
              // identifier is read defensively above: `highlight` is the
              // server's presentation of the match and this loop is written to
              // survive a response that omits a field. Without the fallback a
              // hit missing `highlight` composes to `undefined`, and select2
              // renders a blank-but-selectable row.
              html: twoincUtilHelper.composeCompanyLabel(
                item.highlight || item.name || "",
                identifier
              ),
              company_id: identifier,
              lookup_id: item.lookup_id,
              approved: false
            });
          }

          return {
            results: items,
            pagination: {
              more: false
            }
          };
        }
      }
    };
  }

  /**
   * Fix the position bug
   * https://github.com/select2/select2/issues/4614
   */
  fixSelectWooPositionCompanyName() {
    if (twoincCompanyCapture.mode === "search") {
      const billingCompanyDisplay = jQuery("#billing_company_display").data("select2");

      if (billingCompanyDisplay) {
        billingCompanyDisplay.on("open", function (e) {
          this.results.clear();
          this.dropdown._positionDropdown();
        });
        billingCompanyDisplay.on("results:message", function (e) {
          this.dropdown._resizeDropdown();
          this.dropdown._positionDropdown();
        });

        // Spinner, driven off the widget's own query lifecycle as well as off
        // the ajax transport (TWO-25326 §1).
        //
        // The transport hooks in genSelectWooParams stay — they are the
        // accurate signal, and they are what the supersession guard is built
        // around. These are additive, and they buy two things the transport
        // cannot:
        //
        //   - Coverage of the debounce. `query` fires on the keystroke;
        //     the transport does not run until 300ms later. To the buyer, the
        //     search is "in progress" for that whole time — this bullet asks
        //     for a spinner "while a search query is in progress", and a third
        //     of a second of dead field before it appears is the visible part
        //     of the wait.
        //   - Independence from the transport actually being reached. Live
        //     verification on 2026-08-02 found no spinner during a real
        //     search on staging, while the identical path driven through the
        //     real selectWoo widget under Jest shows it correctly — so the
        //     transport hook demonstrably does not always land in a real
        //     browser, and the root cause is not yet established. Hanging the
        //     spinner off the widget's own events as well means it no longer
        //     depends on which of the two paths runs.
        //
        // `results:all` and `results:message` are the two terminal states of a
        // query — a rendered result set, or a message row ("No matches found",
        // "search unavailable"). Both mean the search is over.
        //
        // The threshold check is load-bearing, not a tidy-up. Handlers run in
        // registration order and the widget registered its own `query`
        // handler at construction, so by the time this one runs the data
        // adapter has ALREADY been asked for results — and for a below-minimum
        // term the minimumInputLength decorator answers it synchronously with
        // `results:message`, meaning the hide below has already fired before
        // this show would run. Without the guard, every keystroke under three
        // characters would leave a spinner running forever over a "Please
        // enter 3 or more characters" hint with no request in flight.
        billingCompanyDisplay.on("query", function (params) {
          const term = (params && params.term) || "";
          if (term.length < twoincSelectWooHelper.companySearchMinLength) return;
          twoincSelectWooHelper.toggleCompanySearchSpinner(true);
        });
        billingCompanyDisplay.on("results:all", function () {
          twoincSelectWooHelper.toggleCompanySearchSpinner(false);
        });
        billingCompanyDisplay.on("results:message", function () {
          twoincSelectWooHelper.toggleCompanySearchSpinner(false);
        });
      }
    }
  }

  /**
   * Whether focus is still somewhere this poll is allowed to touch.
   *
   * `waitToFocus` exists because the picker's own focus-on-open does not land
   * reliably on every host theme, so it polls to nudge focus into the search
   * field. Left unchecked, that poll kept nudging for its whole window (up to
   * ~4.8s from `select2:open`, ~12.8s per re-render from
   * `addSelectWooFocusFixHandler`) with no regard for what happened after it
   * was scheduled — including the buyer deliberately Tabbing to a completely
   * different field, which got yanked back into the dropdown until the poll's
   * hit count ran out or the buyer hit Esc (which tears the dropdown down,
   * so the search-field selector this poll uses stops matching anything).
   *
   * "Still allowed" covers every state the poll's job actually needs to work
   * through: nothing focused yet (`<body>`, select2's own state before its
   * first focus attempt), the search field itself, an option row inside the
   * open results list (the picker focuses those on arrow-key navigation), or
   * the still-collapsed combobox trigger. Anything else means the buyer's own
   * navigation has taken them elsewhere, and that must win.
   *
   * @param {string} selectWooElemId the select's element id
   * @returns {boolean}
   */
  focusStillWithinCompanySearch(selectWooElemId) {
    const active = document.activeElement;
    if (!active || active === document.body) return true;

    const $active = jQuery(active);
    if ($active.is('input[aria-owns="select2-' + selectWooElemId + '-results"]')) return true;

    return (
      $active.closest(
        "#select2-" + selectWooElemId + "-results, #select2-" + selectWooElemId + "-container"
      ).length > 0
    );
  }

  /**
   * Wait until element appear and focus
   */
  waitToFocus(selectWooElemId, hitsRequired, intervalDuration, callbackFunc) {
    if (isNaN(intervalDuration)) intervalDuration = 300;
    if (isNaN(hitsRequired)) hitsRequired = 2;
    let attemptsLeft = hitsRequired * 8;

    let focusInterval = setInterval(function () {
      // The buyer's own navigation always wins over this poll's nudging.
      if (!twoincSelectWooHelper.focusStillWithinCompanySearch(selectWooElemId)) {
        clearInterval(focusInterval);
        return;
      }

      let inpElem = jQuery('input[aria-owns="select2-' + selectWooElemId + '-results"]').get(0);
      if (inpElem) {
        // Focus on the element if not already focused
        if (inpElem != document.activeElement) inpElem.focus();
        // Mark this as a hit attempt
        hitsRequired--;
        // If reached number of required hits, do not attempt again
        if (hitsRequired <= 0) attemptsLeft = 0;
      }

      attemptsLeft--;
      if (attemptsLeft <= 0) {
        clearInterval(focusInterval);
        if (inpElem && callbackFunc) callbackFunc();
      }
    }, intervalDuration);
  }

  /**
   * Wait until element appear and focus
   */
  addSelectWooFocusFixHandler(selectWooElemId) {
    let billingCompanyDisplayResult = jQuery("#select2-" + selectWooElemId + "-results");

    // Ensure the element exists and the handler hasn't been added already
    if (
      billingCompanyDisplayResult.length &&
      !billingCompanyDisplayResult.attr("two-focused-handler")
    ) {
      billingCompanyDisplayResult.attr("two-focused-handler", true);

      // Create a new MutationObserver
      let observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          for (let addedNode of mutation.addedNodes) {
            // Ensure the node has a parent and check for the correct parentNode ID
            if (
              addedNode.parentNode &&
              addedNode.parentNode.id === "select2-" + selectWooElemId + "-results"
            ) {
              twoincSelectWooHelper.waitToFocus("billing_company_display", 80, 20);
            }
          }
        });
      });

      // Observe changes to the childList of the raw DOM element
      observer.observe(billingCompanyDisplayResult[0], {
        childList: true // Monitor when child nodes are added or removed
      });
    }
  }

  /**
   * DOM id of the safe holding pen the wrapper sits in whenever it is NOT
   * currently inside the live `.twoinc-company-search-tile-slot` (TWO-25326
   * §7.1, hardened round 2026-08-03 after adversarial review).
   *
   * Exists as a direct child of `<form name="checkout">` — stable across
   * every WooCommerce checkout AJAX refresh (the form element itself is
   * never one of the fragments `update_order_review` replaces) — rather than
   * `document.body`, so a buyer who manages to submit the form during the
   * brief detached window still posts real, still-attached inputs.
   *
   * @returns {Object} jQuery-wrapped holding pen, created on first use
   */
  getCompanySearchTileHoldingPen() {
    let $pen = jQuery("#twoinc-company-search-tile-holding-pen");
    if (!$pen.length) {
      $pen = jQuery('<div id="twoinc-company-search-tile-holding-pen" class="hidden"></div>');
      const $form = jQuery('form[name="checkout"]');
      // Falls through to <body> only on a page with no checkout form at all
      // (never expected in production; keeps this a no-op rather than a
      // throw on such a page).
      (($form.length && $form) || jQuery("body")).append($pen);
    }
    return $pen;
  }

  /**
   * Detach the company-search tile wrapper to the safe holding pen, BEFORE
   * any WooCommerce checkout AJAX refresh can destroy it (TWO-25326 §7.1,
   * hardened round 2026-08-03).
   *
   * The bug this closes (found independently by every reviewer in the
   * TWO-25326 adversarial round): WooCommerce's `update_order_review` AJAX
   * — fired on a shipping-method change, a coupon apply, a quantity change,
   * not only a payment-method or country switch — replaces the WHOLE
   * `.woocommerce-checkout-payment` fragment wholesale
   * (`$(key).replaceWith(fragments[key])` in WC core's checkout.js). The
   * payment tile's slot lives inside that fragment. A real, live
   * `<select>`/`<input>` re-parented into the slot is therefore a
   * descendant of a subtree WooCommerce can destroy at any moment with no
   * warning — `replaceWith` removes the old nodes outright; nothing
   * resurrects them, and no later re-sync call can recover a node jQuery
   * already tore down.
   *
   * The fix is to never leave the wrapper sitting inside that fragment for
   * longer than it has to: bound to WooCommerce's OWN `update_checkout`
   * trigger (the past-tense `updated_checkout` fires only after the
   * fragments are already swapped in — this is the PRESENT-tense trigger
   * that starts an update, fired synchronously before the async AJAX call
   * begins). jQuery dispatches every handler bound to a trigger
   * synchronously, in the same tick, before any of them can kick off async
   * work — so this handler is guaranteed to run and complete before the
   * fragment swap it is defending against, regardless of registration order
   * against WooCommerce's own handler on the same event.
   *
   * A no-op on 'address_area' (nothing was ever moved into the fragment) and
   * a no-op if the wrapper doesn't exist yet (nothing captured, no company
   * fields ever relocated) or is already in the pen.
   *
   * @returns {void}
   */
  detachCompanySearchTileWrapperToSafety() {
    if (window.twoinc.company_search_location !== "payment_tile") return;

    const $wrapper = jQuery("#" + twoincSelectWooHelper.companySearchTileWrapperId);
    if (!$wrapper.length) return;

    const $pen = twoincSelectWooHelper.getCompanySearchTileHoldingPen();
    if ($wrapper.parent()[0] !== $pen[0]) {
      $wrapper.appendTo($pen);
    }
  }

  /**
   * Close the company-search dropdown before WooCommerce's checkout AJAX can
   * discard the field it is attached to (TWO-40, live-reported by Doug: two
   * `.select2-results` panels, each with its own `#company_mode_chips`,
   * visible at once).
   *
   * Paired on `update_checkout` the same way, and for the same ordering
   * reason, as `detachCompanySearchTileWrapperToSafety` above — and gated
   * the SAME way too, on `company_search_location`. WooCommerce's own
   * `update_checkout` AJAX only ever replaces the `.woocommerce-checkout-payment`
   * fragment; `#billing_company_display` is a descendant of that fragment
   * only when the search control has been moved into the payment tile —
   * `'address_area'`, the default, renders it in the ordinary billing
   * fields, which this AJAX never touches. Closing unconditionally would
   * slam the buyer's open dropdown shut on every unrelated `update_checkout`
   * (a coupon apply, a shipping-method change, a quantity edit) for every
   * merchant on the default config, for a danger that config was never
   * exposed to.
   *
   * Where it IS exposed: a live widget whose `<select>` is torn out from
   * under it by a fragment replace (`replaceWith`, never
   * `select2("destroy")`) never runs selectWoo's own AttachBody cleanup, so
   * its dropdown — appended straight to `<body>`, never a child of the
   * replaced element — is orphaned there, still visible, forever (TWO-40,
   * live-reported by Doug: two `.select2-results` panels, each with its own
   * `#company_mode_chips`, visible at once). `close()` while the widget can
   * still do it properly detaches that dropdown itself, so there is nothing
   * left standing for the fragment swap moments later to orphan. A no-op if
   * nothing is open.
   *
   * Goes through `closeCompanySearchDropdown()` rather than
   * `.select2("close")` directly, matching this file's own established
   * idiom for the same reason that helper's doc comment gives: the plugin
   * dispatch throws on a page where the widget was never attached.
   *
   * selectWoo's `close()` schedules an unconditional `$selection.focus()`
   * 1ms later (vendored bundle, `container.on('close')` — the same quirk
   * `focusIsBackOnCompanyField()`'s own comment documents). This handler
   * fires for `update_checkout` triggers that have nothing to do with the
   * company field — a coupon apply, a shipping-method change — so unlike
   * the Tab-shortcut fix elsewhere in this file, there is no new target to
   * fight for: whatever legitimately had focus before this ran gets it
   * back if selectWoo steals it away.
   *
   * Refused while `twoincSoleTrader.isBusy()` — same restraint
   * `onEmailChanged`/`reopenSearch`/the Business chip already give this
   * exact widget elsewhere in the file. `beginFlight()`'s own comment is
   * explicit that the dropdown (and its busy spinner) are deliberately
   * left open through a sole-trader autofill/popup round trip; `close()`
   * here mid-flight would silently swap that spinner out from under the
   * buyer for no reason tied to this fix.
   *
   * Checked AGAIN inside the deferred focus-restore below, not only at
   * entry (round-2 review — Han): a flight can start in the gap between
   * this synchronous close and that timer firing, and the restore would
   * otherwise yank focus straight back off whatever that flight's own UI
   * just gave it — the exact harm the entry guard exists to prevent,
   * arriving 20ms late instead of at call time.
   *
   * The restore's own "did selectWoo steal it" check is deliberately NOT
   * `focusIsBackOnCompanyField()` (round-2 review — Yoda): that helper
   * counts nothing-focused (`<body>`) as "yes", which is correct for ITS
   * caller — paired with attempting a NEW target, so `<body>` and a real
   * steal both warrant one more try — but wrong here, where a restore of
   * the OLD element runs instead. `update_checkout` fires for a fragment
   * replace that can remove the previously-focused node entirely (a
   * coupon apply, a shipping-method change), which also leaves focus on
   * `<body>` with nothing to fight — reusing the wider predicate would
   * fire the restore then anyway. Only a focus landing literally back on
   * the company field is the steal this guards against.
   *
   * @returns {void}
   */
  closeCompanySearchBeforeCheckoutUpdate() {
    if (window.twoinc.company_search_location !== "payment_tile") return;
    if (twoincSoleTrader.isBusy()) return;

    const $previouslyFocused = jQuery(document.activeElement);
    twoincSelectWooHelper.closeCompanySearchDropdown();

    setTimeout(function () {
      if (twoincSoleTrader.isBusy()) return;
      const $active = jQuery(document.activeElement);
      const stolenBackToCompanyField =
        $active.closest("#billing_company_display_field").length > 0 ||
        $active.is("#billing_company, #company_id");
      if (!stolenBackToCompanyField) return;
      if ($previouslyFocused.is(document.activeElement)) return;
      $previouslyFocused.trigger("focus");
    }, 20);
  }

  /**
   * Relocate the ONE company-search control into the payment tile, or leave
   * it in the address area, per `window.twoinc.company_search_location`
   * (TWO-25326 §7.1, ruling 2026-08-03; hardened round 2026-08-03 after
   * adversarial review — see `detachCompanySearchTileWrapperToSafety` for
   * the AJAX-destruction bug this pairs with).
   *
   * As of the 2026-08-04 correction, this value is DERIVED from the
   * `enable_company_search` checkbox admin field — checked means address
   * area, unchecked means payment tile (never "off": the control never
   * disappears, it only moves) — rather than a location setting of its own.
   * See WC_Twoinc_Checkout::prepare_twoinc_object() and
   * WC_Twoinc::get_enable_company_search()'s doc comment for the source.
   *
   * This is the same control both ways — `#billing_company_display_field`
   * (plus the read-only number label, `getCompanySummaryNode()`), MOVED with
   * `appendTo()`, never cloned and never a second implementation. Whatever
   * JS already targets those ids/classes (selectWoo init, keyboard
   * handling, tab-order fixes, `getCompanyName()`/`getCompanyData()`, the
   * manual-entry affordances) keeps working unchanged, because it all
   * selects by id or class rather than by position in the DOM.
   *
   * `#billing_company_field` — WooCommerce's OWN native company field, not
   * part of this plugin's search control at all — is deliberately NEVER
   * moved (bug found by Doug 2026-08-04, live-verified against the
   * checkbox-off state this correction introduces): it is the plain,
   * unenhanced fallback the buyer types into directly when the checkbox is
   * unchecked (`toggleBusinessFields()`'s disabled branch), mirroring the
   * Hyvä companyName.phtml pattern of degrading to a plain field for the
   * same entity attribute rather than removing it. Moving it into the tile
   * alongside the search control would pull the buyer's ONLY way to enter a
   * company name out of the address form entirely, which is exactly the bug
   * this comment documents.
   *
   * `#company_id_field` is ALSO excluded, but for a different reason than
   * `#billing_company_field` above: it is a plain hidden input
   * (`class: hidden`, never shown to the buyer) that just carries the
   * org-number value the search widget writes into it on selection — moving
   * a hidden field has no visible effect, and it is still submitted with
   * the rest of `form[name="checkout"]` regardless of where inside that
   * form it physically sits. Leaving it in the address form alongside
   * `#billing_company_field` (its manual-entry partner) is simplest and
   * costs nothing.
   *
   * 2026-08-04 correction, round 2 (Doug, live-verified): an earlier version
   * of this fix left `WC_Twoinc_Checkout::update_company_fields()` gating
   * `billing_company_display`'s registration on
   * `get_enable_company_search() === 'yes'` — the exact state that reaches
   * this function's 'payment_tile' branch is checkbox-unchecked, so the
   * field never existed server-side there, this function's move loop was a
   * genuine no-op, and the tile rendered empty. That gate is gone now — the
   * control is ALWAYS registered (see `update_company_fields()`) — so this
   * branch has real work to do: a functional selectWoo search, live inside
   * the tile, exactly matching this field's own admin description
   * ("company search will be visible within the payment method").
   *
   * Default is 'address_area' (checkbox checked): this function is then a
   * no-op and the control renders exactly where WooCommerce always put it —
   * zero behavioural change for every merchant who leaves the checkbox at
   * its default.
   *
   * 'payment_tile': the fields move into `.twoinc-company-search-tile-slot`,
   * the empty slot `get_pay_box_description()` server-renders between the
   * sole-trader toggle and the intent loader/notice (the same position the
   * now-removed `.twoinc-company-tile-label` used to occupy). A single
   * wrapper (`#twoinc-company-search-tile-wrapper`) is created once and holds
   * all the moved rows in address-form order, so the slot only ever has one
   * child to manage. This function only ever pulls the wrapper INTO the
   * slot — pulling it back OUT, before it can be destroyed, is
   * `detachCompanySearchTileWrapperToSafety`'s job, called from the
   * `update_checkout` trigger paired with this one on `updated_checkout`.
   *
   * Every move below is guarded on the node's CURRENT parent — the same
   * `$x.parent()[0] !== $y[0]` idempotency check `getCompanySummaryNode()`
   * already relies on elsewhere in this file, for the same reason (round 1
   * review — Leia): an unconditional `appendTo()` on every call physically
   * detaches and reattaches a live `<select>` even when nothing has moved,
   * which would silently close an open selectWoo dropdown and collapse any
   * in-progress text selection on every payment-method/country switch.
   *
   * Called directly from `onUpdatedCheckout()` (bound to `updated_checkout`)
   * and from `toggleBusinessFields()` (payment-method switch, gestured
   * country change) — the two paths that can re-decide which company fields
   * are even visible, and so the two that must re-decide where they live.
   *
   * @returns {void}
   */
  syncCompanySearchTileLocation() {
    const $slot = jQuery("." + twoincSelectWooHelper.companySearchTileSlotClass);
    if (!$slot.length) return;

    if (window.twoinc.company_search_location !== "payment_tile") {
      // Address area (default): nothing to move. `window.twoinc` is written
      // once per page load (see WC_Twoinc_Checkout::prepare_twoinc_object),
      // so this value cannot flip mid-session — every call on this branch,
      // for the lifetime of the page, is a genuine no-op.
      if (!$slot.hasClass("hidden")) $slot.addClass("hidden");
      return;
    }

    let $wrapper = jQuery("#" + twoincSelectWooHelper.companySearchTileWrapperId);
    if (!$wrapper.length) {
      $wrapper = jQuery(
        '<div id="' + twoincSelectWooHelper.companySearchTileWrapperId + '"></div>'
      );
      $slot.append($wrapper);
    } else if ($wrapper.parent()[0] !== $slot[0]) {
      $slot.append($wrapper);
    }

    // Ends up in address-form order (search control, then the hidden
    // org-number field) because that already IS each one's document order in
    // the address form before this runs — jQuery's multi-selector returns
    // matches in document order, not the order the selector string lists
    // them in (round 1 review — Leia: a prior version of this comment
    // credited the selector string's own argument order, which is not what
    // jQuery actually guarantees). `.appendTo()` on an already-attached node
    // MOVES it (never clones), same as `getCompanySummaryNode()` relies on
    // elsewhere in this file — but only when it isn't already there, so a
    // stale selectWoo dropdown or text selection survives a re-render that
    // changed nothing.
    //
    // `#billing_company_field` and `#company_id_field` are deliberately
    // EXCLUDED from this selector (2026-08-04 correction, see the doc
    // comment above) — both stay in the address form no matter which
    // branch this function takes.
    jQuery("#billing_company_display_field").each(function () {
      const $field = jQuery(this);
      if ($field.parent()[0] !== $wrapper[0]) $field.appendTo($wrapper);
    });

    // The read-only company summary is NOT appended here directly — no
    // second implementation of "where does the summary live". It follows
    // the search control on its own, because `getCompanySummaryNode()`
    // (called from the `renderCompanySummary()` that always runs right
    // after this function — see toggleBusinessFields/onUpdatedCheckout)
    // anchors the summary against `#billing_company_display_field` itself,
    // the same field this function just relocated above. By the time that
    // anchor lookup runs, the field is already inside `$wrapper` (or still
    // in the address form, in 'address_area' mode), so the summary lands
    // right there too, with no separate move call needed and no risk of the
    // tug-of-war a duplicate append here used to cause (round 2026-08-04,
    // fixed by anchoring on the field that actually relocates instead of
    // `#company_id_field`, which never does — see the doc comment on
    // `getCompanySummaryNode()`).
    //
    // Unhidden only when the wrapper actually gained a VISIBLE child (bug
    // found in adversarial review round 2, Han, 2026-08-04; widened
    // 2026-08-04 correction round 3 — the field now always exists
    // server-side, so checking mere presence in the wrapper is no longer
    // enough). Manual entry, and any billing country with no registry to
    // search, hide `#billing_company_display_field` with the `hidden` class
    // rather than removing it (see toggleBusinessFields; sole-trader mode used
    // to be a third such case and is not one any more — the adopted company
    // renders THROUGH this control now) — it still gets moved into the
    // wrapper by the loop above, so `$wrapper.children().length` alone
    // would unhide the slot around a `display: none` field, leaving the
    // buyer a bare, unexplained gap (`.twoinc-company-search-tile-slot`'s
    // own `margin: 12px 0`, assets/css/twoinc.css) between the sole-trader
    // toggle and the intent message — the exact "confusing empty box" state
    // this guard exists to prevent. Checking for a child that is not itself
    // `.hidden` closes that gap.
    if ($wrapper.children(":not(.hidden)").length) {
      if ($slot.hasClass("hidden")) $slot.removeClass("hidden");
    } else if (!$slot.hasClass("hidden")) {
      $slot.addClass("hidden");
    }
  }

  /**
   * Get company name string
   *
   * The native `#billing_company` is read ONLY in manual entry (#486, Doug).
   * Sole-trader mode reads the picker's display span exactly like an ordinary
   * search pick does, because that is where the adopted name is rendered
   * (`lockCapturedFields()` seeds the widget with it, TWO-40 §7 direction (a)).
   * Branching on `enable_company_search`, as this used to, sent the sole-trader
   * case down the native-field branch — and that field is not what the buyer
   * sees there, so this returned empty, `getCompanyData()` produced a
   * `customerCompany` with no `company_name`, and `isReadyApprovalCheck()`
   * never let an order intent fire at all: an adopted sole trader Two rejects
   * got the generic unavailability fallback instead of the message naming their
   * own business.
   */
  getCompanyName() {
    if (twoincCompanyCapture.mode !== "manual") {
      let companyNameObj = twoincDomHelper.getCheckoutInput(
        "SPAN",
        "select",
        "select2-billing_company_display-container"
      );
      if (companyNameObj) {
        return companyNameObj.val;
      }
    } else {
      return jQuery("#billing_company").val();
    }

    return "";
  }

  /**
   * Clear the selected selectWoo company name and id
   */
  clearSelectedCompany() {
    // Clear company inputs
    let billingCompanyDisplay = jQuery("#billing_company_display");
    billingCompanyDisplay.html("");
    // Re-inits selectWoo directly rather than through `attach()` (round-2
    // review, TWO-25469) — this can run after `onUpdatedCheckout` has
    // already seen a fragment replace discard the field's OLD `<select>`
    // (`clearCompanyIfCountryStale` → here), the exact orphan-dropdown
    // trigger `attach()`'s own sweep exists for. Without this call the
    // orphan survives this path untouched. See `sweepOrphanedDropdown()`'s
    // own comment for the full mechanism.
    twoincSelectWooHelper.sweepOrphanedDropdown(billingCompanyDisplay);
    twoincSelectWooHelper.initCompanySearchWidget(billingCompanyDisplay);
    twoincDomHelper.toggleTooltip(
      "#billing_company_display_field .select2-container",
      window.twoinc.text.tooltip_company
    );
    twoincSelectWooHelper.fixSelectWooPositionCompanyName();
    // The real company field too, matching what enterManualCompanyEntry does.
    // Without this the cleared company survives in #billing_company: it is the
    // field WooCommerce posts, so the order carried a company the buyer had
    // just been shown as cleared, and — since #billing_company is also the live
    // mirror the read-only summary reads — the summary reappeared showing it on
    // the next re-render (TWO-25288).
    //
    // Gated on PROVENANCE (TWO-40 §5), not on the capture mode. In manual entry
    // #billing_company is the buyer's own typed input, and this runs on every
    // country change: clearing unconditionally would wipe a name they typed for
    // reasons of their own. `enable_company_search === "yes"` was a proxy for
    // that question and got one case wrong — a sole-trader name is plugin-
    // written but reaches here with the flag reading "no", so the name survived
    // a country change that had already taken its organisation number, leaving
    // the two halves of one capture disagreeing. The provenance marker answers
    // the question directly instead of standing in for it.
    const plugin_wrote_name = twoincCompanyCapture.isPluginWritten(
      twoincCompanyCapture.nameField()
    );
    twoincCompanyCapture.write(plugin_wrote_name ? "" : jQuery("#billing_company").val(), "");

    // Clear the addresses, in case address get request fails.
    // `clearAddress()`, not a blank `setAddress()` payload: the latter now
    // leaves line 2 untouched by design (TWO-40 §2.6), which would strand the
    // outgoing company's registry-written line 2 on the form.
    if (window.twoinc.enable_address_lookup === "yes") {
      Twoinc.getInstance().clearAddress();
    }
    Twoinc.getInstance().registryAddressApplied = false;

    Twoinc.getInstance().customerCompany = {};
    // Re-read rather than forced empty. Forcing it disagreed with the gated
    // clear above: in manual entry the buyer's typed company is deliberately
    // kept, so the summary vanished here and reappeared 3s later when the
    // re-read below ran.
    twoincSelectWooHelper.renderCompanySummary();
    twoincDomHelper.togglePaySubtitleDesc();

    // Update again after all elements are updated.
    //
    // Guarded by the company-search counter (review round 5). Three seconds is
    // long enough for the buyer to change country again, or to pick a company —
    // and this closure then overwrote `customerCompany` from whatever the DOM
    // held at that moment and re-rendered from it, undoing the newer capture. The
    // counter is bumped by every country change and every search, so a stale
    // deferred read is exactly what it is there to catch.
    const seq = twoincSelectWooHelper.companySearchSeq;
    setTimeout(function () {
      if (seq !== twoincSelectWooHelper.companySearchSeq) return;
      Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();
      twoincSelectWooHelper.renderCompanySummary();
      // This closure touches the TILE not at all (review round 7). It re-reads the
      // company record and re-renders the summary; the verdict is not its business.
      //
      // It carried a blanket hide, then a verdicts-only clear, and both were wrong
      // for the same reason: it fires three seconds late, by which time a check
      // armed by the `getApproval()` at the end of the country handler has issued
      // (~1s) and painted (~1.5-2s). Clearing then wipes a correct, current verdict
      // — and `interval` is null and `pendingCheck` false by then, and neither a
      // country change nor `checkout_error` fires `updated_checkout`, so nothing
      // repaints it. The buyer changed country and got a blank tile.
      //
      // Nothing is lost by removing it: the synchronous `togglePaySubtitleDesc()`
      // above already retired the outgoing verdict at t=0, which is the only moment
      // at which it was the stale one.
    }, 3000);
  }

  /**
   * The read-only company-number label, built hidden on first use
   * (TWO-25288; scope narrowed TWO-25326 §7).
   *
   * ONE <span> and no <input>: the captured number is a value the buyer is
   * shown, not a field they fill in, so there is deliberately nothing here to
   * type into and no control that removes it. `readonly` inputs are this
   * plugin's convention for a field that still carries a value the buyer must
   * not change (sole-trader mode readonly-locks #billing_company and
   * #company_id) — but those are the SUBMITTED fields, and they keep that job
   * untouched. This is a display beside them, so a span is the right shape.
   *
   * It used to render the captured NAME here too, in a
   * `.twoinc-company-summary-name` span above the number. That span is gone
   * (TWO-25326 §7): the name is already on screen in the company-name control
   * immediately above, and the ticket rules out any additional company name
   * or number text in the address area beyond the company-name field itself
   * and this number label. The number stays because §5 requires exactly this
   * — the number as a plain right-aligned text label immediately below the
   * name field, never as an input — and this element is the only thing on WC
   * providing it. The name itself no longer renders anywhere in the tile
   * either, as a standalone label (TWO-25326 §7.2/§7.3, ruling 2026-08-03):
   * it is substituted directly into the intent-message sentence instead —
   * see `getCompanyLabelText` and its callers in `togglePaySubtitleDesc`.
   *
   * Anchored after the company-SEARCH field's (`#billing_company_display_field`)
   * enclosing `.twoinc-inp-container` where there is one, NOT inside it —
   * `#billing_company_field` when the search field is the hidden one of the two
   * company-name elements (see the anchor code below), and `#company_id_field`
   * only as a fallback for a page with no name field at all. The pay-for-order page wraps every
   * company input in such a container and hides the container, not just the
   * field (see syncCompanyFieldWrappers) — so a summary placed inside would be
   * invisible on that page in exactly the search mode it matters most for. The
   * checkout page has no wrappers and the anchor falls through to the field.
   *
   * Anchoring against the SEARCH field specifically (rather than
   * `#company_id_field`, which is deliberately never relocated — see
   * `syncCompanySearchTileLocation()`) is what makes the summary follow the
   * control into the payment tile (TWO-25326 bugfix, Doug 2026-08-04
   * live-verified: the summary used to stay orphaned in the address area
   * after the search control moved). `syncCompanySearchTileLocation()` runs
   * BEFORE every `renderCompanySummary()` call, so by the time this anchor
   * lookup runs, `#billing_company_display_field` is already wherever it is
   * going to be for this render — tile or address area — and the summary
   * simply follows.
   *
   * Re-anchored on EVERY call, not just on first creation (#30.x.9, found by
   * live post-merge verification — reported live: the summary rendered ABOVE
   * the company field instead of below it). Root cause is documented in
   * `WC_Twoinc_Checkout.php`, above `move_country_field()` and
   * `sync_locale_country_priority()`: WooCommerce core's own
   * `address-i18n.js` detaches and re-appends every `.form-row` in the
   * billing wrapper by priority, on EVERY checkout load — not only on
   * country change. This summary is a plain `<div>`, not a `.form-row`, so
   * it never takes part in that resort; once WC moves the real fields past
   * it, it stays stranded wherever it was first inserted, above all of
   * them. The plugin already carries two established fixes for exactly this
   * mechanism (for the country field) — this is the same class of bug for
   * the summary. `insertAfter` on an already-attached node MOVES it rather
   * than cloning, so re-checking the anchor here on every
   * `renderCompanySummary()` call (which already fires on every pick,
   * payment-method switch, country change and re-render) snaps the summary
   * back into place after any external resort.
   *
   * Guarded on `$node.prev()` (round 1 review — Han): re-running
   * `insertAfter` UNCONDITIONALLY, on every call, physically detaches and
   * re-inserts the node even when nothing has drifted — measured with a
   * MutationObserver, every "healthy" call still fires a childList removal
   * + addition. That collapses any text selection inside the summary (the
   * only interaction this read-only org-number display affords is
   * selecting it to copy), forces a reflow, and would restart any CSS
   * transition a brand overlay puts on this element (`.custom-checkout
   * .twoinc-company-summary` in twoinc.css proves overlays do style it).
   * `.prev()` is element-only (ignores text nodes), so "prev is already the
   * anchor" reliably implies "already positioned, same parent, nothing to
   * do" — the move only runs when the anchor actually changed.
   *
   * @returns {Object} jQuery-wrapped summary, or an empty set on a page with
   *   no company fields at all
   */
  getCompanySummaryNode() {
    let $node = jQuery("#" + twoincSelectWooHelper.companySummaryId);
    const isNew = !$node.length;

    let $field = jQuery("#billing_company_display_field");
    // The label belongs immediately below whichever of the two company-NAME
    // elements is currently the visible one (Doug, 2026-08-19). The search
    // control wins whenever it is showing — that is what keeps the label
    // following it into the payment tile, per the paragraph above — and the
    // native field takes over only when the search control is hidden, which is
    // exactly the state where anchoring against a `display: none` row would
    // strand the label away from the field it annotates (and, via the
    // `+ .twoinc-company-summary` gap cancellation in twoinc.css, pull it up
    // over whatever sits above).
    if ($field.hasClass("hidden")) {
      const $native = jQuery("#billing_company_field");
      if ($native.length && !$native.hasClass("hidden")) $field = $native;
    }
    if (!$field.length) $field = jQuery("#company_id_field");
    if (!$field.length) $field = jQuery("#billing_company_field");
    // Dead ternary removed (round 2 review — Vader): `isNew` is exactly
    // `!$node.length`, and `$node` is never reassigned before this line, so
    // `isNew ? jQuery() : $node` and plain `$node` are the same value in
    // both branches — an equivalent mutant proved it. Reads as if it guards
    // something it doesn't.
    if (!$field.length) return $node;

    if (isNew) {
      $node = jQuery(
        '<div id="' +
          twoincSelectWooHelper.companySummaryId +
          '" class="twoinc-company-summary hidden">' +
          '<span class="twoinc-company-summary-id"></span>' +
          "</div>"
      );
    }

    const $wrapper = $field.closest(".twoinc-inp-container");
    const $anchor = $wrapper.length ? $wrapper : $field;
    if ($node.prev()[0] !== $anchor[0]) $node.insertAfter($anchor);
    return $node;
  }

  /**
   * Render the captured company's name and number, read-only (TWO-25288).
   *
   * Supersedes the floating company-id overlay this used to be. That showed
   * the number only, and shipped an x-button that let the buyer delete a
   * registry identity from the checkout — which is the affordance this
   * reversal removes. Both values now render as text, in one place, for all
   * three capture modes:
   *
   *   - company search: name and number as picked from the registry;
   *   - sole trader: name and number as held by Two for the buyer;
   *   - manual entry: whatever name the buyer typed, and NO number — manual
   *     entry clears #company_id, so the number renders empty until the buyer
   *     supplies one in the field of its own.
   *
   * Both arguments are optional. Callers that already hold the values pass
   * them (the picker's select handler, sole-trader autofill, the user-meta
   * restore — which writes #company_id AFTER this runs, so reading the DOM
   * there would render an empty number). Everyone else omits them and the
   * current inputs are read.
   *
   * @param {string} [companyName]
   * @param {string} [companyId]
   * @returns {void}
   */
  renderCompanySummary(companyName, companyId) {
    const data =
      companyName === undefined && companyId === undefined
        ? twoincSelectWooHelper.readCapturedCompany()
        : { company_name: companyName, organization_number: companyId };

    // The empty selectWoo option's label is a non-breaking space, so an
    // unselected picker reads back as " " rather than "" — which would
    // render as a label with an invisible value in it.
    const name = twoincUtilHelper.blankToEmpty(data.company_name);
    // TWO-25326 §12: display-normalised, so an internally minted number reads
    // back as "" here. Everything below is already keyed on this being empty —
    // the element renders nothing and the block hides itself — so a sole
    // trader's captured company shows no number label rather than a protocol
    // string. The raw value is untouched on `#company_id` and in the instance
    // state, which is what gets posted.
    const number = twoincUtilHelper.formatCompanyNumber(data.organization_number);

    // The tile no longer carries a separate company label to keep in sync
    // here (TWO-25326 §7.2/§7.3, ruling 2026-08-03: `.twoinc-company-tile-label`
    // is removed — the company now lives inside the intent-message sentences
    // themselves, substituted in togglePaySubtitleDesc()).

    const $node = twoincSelectWooHelper.getCompanySummaryNode();
    if (!$node.length) return;

    $node.find(".twoinc-company-summary-id").text(number);

    // Two conditions, and only these two (Doug, 2026-08-19), now that this
    // label is the ONLY surface the captured number ever reaches the buyer
    // through — `#company_id_field` is permanently hidden in every mode (see
    // `toggleBusinessFields()`):
    //
    //  1. REGISTERED-COMPANY mode. `search` only, never `manual` (which
    //     captures a name and clears #company_id, so §5's "no company-number
    //     field or label at all" already followed from `number` being empty)
    //     and never `sole_trader` — a number Two minted during enrollment is
    //     not the buyer's own registry identifier and there is nothing useful
    //     to show them.
    //  2. A number that is not internally minted. `number` here is already
    //     `formatCompanyNumber()`'s output, which is `isSyntheticCompanyNumber()`
    //     applied as a filter — it returns "" for a `TWO:…` value (TWO-25326
    //     §12) — so this one truthiness check covers both "nothing captured
    //     yet" and "captured, but must not be displayed".
    //
    // Deliberately NOT gated on Two being the selected payment method, unlike
    // the version this replaces. Doug's spec names two conditions and neither
    // is the payment method, and the label now has to hold the same
    // payment-method-agnostic contract the name field above it does: the
    // number belongs to the company the buyer captured, not to Two's tile.
    const visible = Boolean(number && twoincCompanyCapture.mode === "search");
    $node.toggleClass("hidden", !visible);
  }

  /**
   * Read the captured company straight out of the live inputs (TWO-25288).
   *
   * Deliberately NOT getCompanyData(), which is what this used to call. In
   * search mode that reaches getCompanyName(), and getCompanyName() reads the
   * company name out of the `checkoutInputs` sessionStorage snapshot rather
   * than the document — a snapshot saveCheckoutInputs() refreshes on a 3-second
   * interval. So a summary rendered from it in search mode showed whatever the
   * name was up to three seconds ago, or nothing at all before the first save:
   * switching payment method away and back re-renders through
   * toggleBusinessFields, which would have blanked the name of a company that
   * was still very much picked, while the number — read live — stayed.
   *
   * `#billing_company` and `#company_id`, and ONLY those two. They are the
   * fields WooCommerce posts, and they are written by every capture mode: the
   * picker's select handler on each pick, manual entry, sole-trader autofill,
   * and the user-meta restore.
   *
   * The display select's value was briefly a fallback here, on the reasoning
   * that its options carry the company name as their value. It had to go: the
   * picker appends an <option> for every pick and neither select2("destroy")
   * nor twoincSoleTrader.setCompany("", "") removes it, so leaving search mode
   * left a company on that select which no longer existed in either posted
   * field — and the fallback read it back, showing a company the order did not
   * carry. Reading only what is posted is what keeps the display and the order
   * unable to disagree.
   *
   * @returns {{company_name: string, organization_number: string}}
   */
  readCapturedCompany() {
    return {
      company_name: twoincUtilHelper.blankToEmpty(jQuery("#billing_company").val()),
      organization_number: twoincUtilHelper.blankToEmpty(jQuery("#company_id").val())
    };
  }

  /**
   * Get the link back out of manual entry and into company search, building it
   * hidden on first use (TWO-25288).
   *
   * A real <button> rather than the <div> this used to be. The div had no
   * href, no role and no tabindex, so the only way out of manual entry was a
   * mouse click; type="button" is what keeps a button inside the checkout form
   * from submitting it.
   *
   * Appended into `.woocommerce-input-wrapper`, not directly into
   * `#billing_company_field` (round 3, #30.x.5.3; positioning reworked
   * #30.x.9) — see the rule comment above `#search_company_btn` in
   * twoinc.css for why: that wrapper is WooCommerce core's own box around
   * just the <input>, no label inside it, so a plain block appended as its
   * last child lands in normal flow immediately below the input regardless
   * of label height or how many lines it wraps to. If that wrapper is
   * missing (a host template not using WooCommerce core's own field markup),
   * one is built around `#billing_company` directly rather than falling back
   * to `#billing_company_field` itself, which would silently reintroduce the
   * bug this fixes (see below).
   *
   * @returns {Object} jQuery-wrapped button
   */
  getSearchCompanyBtnNode() {
    const id = twoincSelectWooHelper.searchCompanyBtnId;

    let $btn = jQuery("#" + id);
    if ($btn.length) return $btn;

    $btn = jQuery("<button></button>")
      .attr({ id: id, type: "button" })
      .text(twoincSelectWooHelper.searchCompanyText())
      .hide()
      // Both click AND Enter/Space must activate this button directly,
      // bound on the element itself rather than delegated from
      // document.body (#30.x.7, #30.x.13).
      //
      // CLICK (#30.x.13, live-reported by Doug): a `$body.on("click", "#" +
      // searchCompanyBtnId, ...)` delegated handler used to be the only
      // activation path. Live reproduction confirmed the mouse event DOES
      // reach this button (mousedown focuses it, document.activeElement
      // becomes this element, elementFromPoint at its centre resolves to
      // the button itself — no overlap, no z-index/stacking interference),
      // yet the delegated handler never ran and nothing was switched back
      // to search. The same button's OWN direct keydown handler (below)
      // fires correctly for a real Enter keypress on the same element in
      // the same session — so whatever is intercepting this is specific to
      // the bubble-phase "click" event reaching document.body, not to this
      // button or to activation in general. Binding directly here removes
      // the dependency on that bubble reaching body at all, the same
      // reasoning already applied to Enter/Space below.
      //
      // ENTER/SPACE (#30.x.7): reported live — Tab reaches this button fine
      // (it is a real, focusable <button>), but pressing Enter or Space
      // while it has focus did nothing via the browser's native "activate a
      // focused <button>" default action alone.
      //
      // A directly-bound bubble-phase listener always runs before any
      // bubble-phase listener on an ancestor, regardless of registration
      // order or where that ancestor handler lives (the one theoretical
      // exception is a capture-phase listener somewhere in the ancestor
      // chain, which jQuery never installs and nothing vendored in this
      // repo uses either) — so both of these fire regardless of whatever
      // else is bound between this element and document.body, and
      // regardless of whether some ancestor handler already called
      // `preventDefault()`/`stopPropagation()` by the time it runs.
      .on("click", function (e) {
        twoincSelectWooHelper.exitManualCompanyEntry();
      })
      .on("keydown", function (e) {
        if (e.which !== 13 && e.which !== 32) return;
        e.preventDefault();
        e.stopPropagation();
        twoincSelectWooHelper.exitManualCompanyEntry();
      });

    twoincSelectWooHelper.companyFieldAffordanceSlot().append($btn);
    return $btn;
  }

  /**
   * The slot a company-field affordance button hangs in: WooCommerce core's
   * own `.woocommerce-input-wrapper` around `#billing_company`'s input.
   *
   * Extracted so the "select a different sole trader" link (TWO-40 §7) lands
   * in the SAME visual slot as the "search for company" link, from the same
   * code, rather than growing a second near-copy of the self-heal below.
   *
   * Self-heals rather than silently degrading (found under adversarial
   * review before merge, round 3): a plain "fall back to
   * #billing_company_field" would append the button as a sibling of BOTH the
   * label and the input, rather than immediately after the input alone —
   * reintroducing the old overlap-with-the-field-label class of bug this
   * wrapper exists to avoid. Instead, build an equivalent wrapper around just
   * the <input>: the same DOM shape WooCommerce core's own
   * woocommerce_form_field() would have produced, so the button always lands
   * directly below the input regardless of which path got here. Falls through
   * to #billing_company_field only if #billing_company itself is missing — a
   * field this whole feature already depends on existing.
   *
   * @returns {Object} jQuery-wrapped slot
   */
  companyFieldAffordanceSlot() {
    let $wrapper = jQuery("#billing_company_field .woocommerce-input-wrapper");

    if (!$wrapper.length) {
      const $input = jQuery("#billing_company");
      if ($input.length) {
        $input.wrap('<span class="woocommerce-input-wrapper"></span>');
        $wrapper = jQuery("#billing_company_field .woocommerce-input-wrapper");
      }
    }

    return $wrapper.length ? $wrapper : jQuery("#billing_company_field");
  }

  /**
   * Switch the company field from search to manual entry (TWO-25288).
   *
   * Reached only from the manual-entry row's activation, keyboard or mouse.
   *
   * @returns {void}
   */
  enterManualCompanyEntry() {
    // Guard against the deferred activation (activateManualEntry's
    // `setTimeout(enterManualCompanyEntry, 0)`) landing AFTER an async
    // sole-trader switch raced in during the same tick — e.g. the
    // email-driven autofill prefetch calling
    // `twoincSoleTrader.setMode("sole_trader")` "on its own", independent of
    // what the dropdown is doing (round 2 review, Han+Vader, convergent:
    // both independently reproduced this race). Without this guard, this
    // function would still run after setMode already put the buyer into
    // sole-trader mode — forcing the capture mode back to
    // `manual` (wrong: that is the one mode whose name comes off the native
    // field rather than the picker the adopted sole trader is rendered in),
    // re-showing the search-again button setMode just hid, and
    // wiping `#billing_company`/`#company_id` out from under the synthetic
    // id sole-trader mode may have just written. That reproduces the exact
    // #30.x.13 symptom (a capture mode disagreeing with what the buyer is
    // actually looking at) via a path this PR's
    // own new flag opened up. Same shape as the existing "remove the
    // button before deferring" reentrancy guard in `activateManualEntry`,
    // one level further out.
    //
    // `isDeciding()` too (TWO-40 §7 round-3 review — Han): the same deferred
    // landing can arrive while a sole-trader autofill flight is still
    // outstanding and `mode` hasn't flipped to `sole_trader` yet — without
    // this, a match resolving afterwards fully overwrites whatever this
    // function touched anyway (`applyPrefetch` → `setCompany` →
    // `lockCapturedFields`), so today it's harmless, but only by that
    // terminal-branch-wins coincidence; guarding here directly is what every
    // other entry into/out of sole-trader mode already does. Not `isBusy()`
    // (round-3 review — Vader): once already adopted this is unreachable
    // anyway (the mode check above already returns), so the distinction is
    // moot here, but `isDeciding()` is the correct predicate for "the buyer
    // is choosing something else" and keeps every such guard consistent.
    if (twoincSoleTrader.mode === "sole_trader" || twoincSoleTrader.isDeciding()) return;

    // Reset in exitManualCompanyEntry, and snapshotted/restored around a
    // sole-trader detour by twoincSoleTrader.setMode/leaveSoleTraderMode.
    twoincCompanyCapture.mode = "manual";

    jQuery("#billing_company_display").val("");
    // The real company field too, not just the display one. Without this the
    // manual field the buyer is about to be shown is pre-filled with the
    // company they have just said is NOT theirs, while its org-number twin is
    // empty — and the exit path clears this same mirror, so leaving it here
    // would be asymmetric on top of wrong.
    jQuery("#billing_company").val("");
    jQuery("#company_id").val("");

    // The registry address too, mirroring clearSelectedCompany — but ONLY when
    // a registry lookup actually wrote it. Reaching manual entry does not
    // imply one ran: the row is live from the first keystroke, before any
    // request goes out, and clearing unconditionally would blank a logged-in
    // buyer's own account-prefilled address for no reason. `#company_id` is
    // NOT that signal — it is written by account-restore and sole-trader code
    // with no lookup behind it, and stays empty for a picked company that
    // simply carries no organisation number even though its lookup DID run —
    // so this reads `registryAddressApplied` instead, which is set only on
    // the branch that actually writes looked-up data.
    if (Twoinc.getInstance().registryAddressApplied) {
      // `clearAddress()`, for the same reason clearSelectedCompany uses it
      // (TWO-40 §2.6): a blank `setAddress()` payload now leaves line 2 alone.
      Twoinc.getInstance().clearAddress();
      Twoinc.getInstance().registryAddressApplied = false;
    }

    Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();

    // Looked up from the DOM rather than through the cached
    // billingCompanySelect: enableCompanySearch can have re-attached the
    // widget since that reference was taken, and the one to tear down is
    // whichever one is currently attached.
    const $display = jQuery("#billing_company_display");
    if ($display.data("select2")) {
      // `close()` BEFORE `destroy()` — new, #30.x.13. Reached here the
      // widget is essentially always still OPEN: this function only runs
      // from activating the manual-entry row, and that row exists only
      // INSIDE the open results list.
      //
      // CORRECTED mechanism (round 2 review, Han+Vader, both independently
      // verified directly against the real vendored selectWoo.full.js —
      // the previous version of this comment had the mechanism wrong):
      // selectWoo's document-level keydown handler (bound ONCE per widget
      // instance in `_registerEvents`, `$(document).on('keydown', ...)`,
      // see the long comment in bindManualEntryAffordance above) is never
      // unbound by anything — not by `close()`, not by `destroy()`. What
      // actually neutralizes it: that handler's dangerous branches are
      // gated on `self.isOpen()`, which just reads a CSS class
      // (`select2-container--open`) on the container. `close()`
      // synchronously flips that class off. `destroy()` alone never fires
      // the close event, so a destroyed-but-still-referenced instance's
      // container keeps that class (and therefore `isOpen() === true`)
      // forever — the handler is still bound to `document` and still
      // "live" by its own gate, just with no widget left for it to
      // reason about. That is what live reproduction (#30.x.13, Doug)
      // showed: Tab became unresponsive PAGE-WIDE, not just near the
      // company field, the moment manual entry was reached — exactly
      // what that ungated zombie handler produces. Calling `close()`
      // first is what actually fixes it, by flipping the one flag the
      // handler checks; the handler itself is still bound afterward and
      // always will be, so this is a mitigation of a permanent gap, not
      // a removal of it. Direct empirical repro (round 2, Vader): a real
      // widget destroyed WITHOUT close() first leaves a subsequent
      // synthetic document keydown{which:9} reporting
      // `defaultPrevented === true` (Tab trapped); with close() first,
      // the same dispatch reports `false` (Tab free).
      //
      // Safe to call unconditionally ahead of destroy(): `close()` on an
      // already-closed widget is a documented no-op in select2/selectWoo.
      // `close()` does schedule its own `self.$selection.focus()` ~1ms
      // later (see the same earlier comment) — by the time that timer
      // fires, `destroy()` below has already run and
      // `focusVisibleCompanyField("#billing_company")` at the end of this
      // function has already handed focus to the manual field, and
      // `toggleBusinessFields()` has hidden `#billing_company_display_field`
      // — so that stray refocus lands on a `display: none` element, which
      // is a silent no-op per the HTML focus spec, not a fight over focus.
      $display.select2("close");
      $display.select2("destroy");
    }

    jQuery("#" + twoincSelectWooHelper.manualEntryRowId).remove();
    twoincSelectWooHelper.getSearchCompanyBtnNode().show();

    twoincDomHelper.toggleBusinessFields();

    // Destroying the widget leaves focus on nothing — activeElement falls back
    // to <body> — so a keyboard or AT user loses their place mid-checkout and
    // has to tab in from the top of the document. Hand focus to the field they
    // asked to be given.
    twoincSelectWooHelper.focusVisibleCompanyField("#billing_company");
  }

  /**
   * Switch the company field back from manual entry to search (TWO-25288).
   *
   * @returns {void}
   */
  exitManualCompanyEntry() {
    twoincCompanyCapture.mode = "search";

    Twoinc.getInstance().enableCompanySearch();

    jQuery("#billing_company").val("");
    jQuery("#company_id").val("");
    Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();

    twoincSelectWooHelper.getSearchCompanyBtnNode().hide();
    twoincDomHelper.toggleBusinessFields();

    // Asking to search again is a request to search, not a request to be shown
    // a closed combobox: land the buyer in the open dropdown with the caret in
    // its search box, so the gesture costs one click rather than two.
    //
    // After toggleBusinessFields, deliberately. Opening the dropdown positions
    // it against its container, and that container is only laid out once the
    // business fields have been shown.
    if (!twoincSelectWooHelper.openCompanySearchDropdown()) {
      // Fallback for a surface with no picker attached (the pay-for-order page
      // renders a different set of fields). Mirrors the enter path: the button
      // that had focus is now hidden, so without this focus is stranded on a
      // display:none element.
      //
      // Reached ONLY when no dropdown was opened. Running it alongside an open
      // dropdown would park focus on the collapsed combobox while the picker is
      // expanded behind it — a worse state than either outcome on its own,
      // because the buyer's keystrokes would go nowhere the open list can see.
      //
      // NOT #billing_company_display — the picker hides that <select> and moves
      // its accessible role onto the rendered combobox, which is the element
      // carrying tabindex and the one a buyer can actually see.
      if (
        !twoincSelectWooHelper.focusVisibleCompanyField(
          "#billing_company_display_field .select2-selection"
        )
      ) {
        twoincSelectWooHelper.focusVisibleCompanyField("#billing_company_display");
      }
    }
  }

  /**
   * Open the company-search dropdown and put the caret in its search box
   * (TWO-25288).
   *
   * `select2("open")` is safe to call unconditionally — the picker's own `open`
   * early-returns when it is already open — so this does not need to read the
   * open state first.
   *
   * The explicit focus is not redundant with the picker's own. The picker
   * focuses its search field from a listener on its `open` event, and this
   * plugin already carries a polling focus fix (`waitToFocus`, wired to
   * `select2:open`) precisely because that focus does not reliably land on
   * every host theme. Focusing here makes the caret's arrival synchronous with
   * the buyer's click instead of dependent on a poll that may take up to
   * ~2.4s, and the poll then finds the field already focused and no-ops.
   *
   * Reports whether the DROPDOWN was opened, deliberately — not whether focus
   * landed. The caller uses it to decide whether to fall back to focusing the
   * collapsed combobox, and that fallback is only ever right when there is no
   * open dropdown to be inside. A focus that failed with the dropdown open is
   * left to the `select2:open` poll to repair.
   *
   * @returns {boolean} whether the search dropdown was opened
   */
  openCompanySearchDropdown() {
    const $display = jQuery("#billing_company_display");
    if (!$display.length || !$display.data("select2")) return false;

    $display.select2("open");

    // Looked up after opening, never cached: the picker tears the dropdown
    // down and rebuilds the search field on every open, so the node focused
    // here is the one this open just created.
    twoincSelectWooHelper.focusVisibleCompanyField(
      twoincSelectWooHelper.companySearchInputSelector
    );

    return true;
  }

  /**
   * Move focus to a company field, if it is actually focusable (TWO-25288).
   *
   * Guarded rather than a bare `.focus()`: both callers run on surfaces where
   * the target may be absent (the pay-for-order page renders a different set)
   * and `.focus()` on an empty set is a silent no-op that reads as success.
   *
   * @param {string} selector the field to focus
   * @returns {boolean} whether focus was moved
   */
  focusVisibleCompanyField(selector) {
    const $field = jQuery(selector);
    if (!$field.length || $field.prop("disabled")) return false;
    $field.trigger("focus");
    return jQuery(document.activeElement).is($field);
  }

  /**
   * Sweep away an orphaned select2 dropdown clone left behind for this
   * field before (re-)initialising selectWoo against it (TWO-25469).
   *
   * A widget can be discarded by having its underlying `<select>` replaced
   * outright — WooCommerce's checkout-AJAX fragment `replaceWith()` is the
   * documented trigger (`closeCompanySearchBeforeCheckoutUpdate`'s own
   * comment) — rather than by a `select2("destroy")` call ever reaching
   * it. Its INLINE container goes with the removed `<select>`, but
   * selectWoo's AttachBody decorator renders the actual DROPDOWN as a
   * separate node appended straight to `<body>` (vendored bundle,
   * `AttachBody.prototype.render`/`.bind`) so it survives the removal
   * untouched — nothing but that same discarded instance's own
   * `destroy()`/`close()` ever detaches it, and nothing calls either once
   * every reference to the instance is gone with the element. It sits
   * there forever, still carrying `select2-container--open` if the buyer
   * had it open at that moment (TWO-25469, confirmed live: reopening the
   * freshly re-attached widget then renders a SECOND open dropdown
   * alongside it).
   *
   * Only swept when this field has no live widget of its own right now.
   * The ordinary re-attach path (the 800ms retry, `exitManualCompanyEntry`,
   * the sole-trader mode switch) calls this while a widget is still
   * attached to THIS SAME element, and selectWoo's own reinit already
   * destroys and removes ITS dropdown clone correctly on that path (see
   * company-search-deferred-init.test.js) — sweeping while one is still
   * live would race that cleanup instead of helping it.
   *
   * Matched by the results-list id, the same idiom `syncManualEntryButton`
   * already uses for the same reason: selectWoo derives it deterministically
   * from the field's own id, the SAME id on every re-init of THIS field —
   * stale or fresh.
   *
   * Called from both places that (re-)initialise selectWoo on this field:
   * `attach()` and `clearSelectedCompany()` — the latter re-inits directly
   * rather than through `attach()`, so it needs this call of its own or the
   * same orphan survives untouched down that path.
   *
   * @param {Object} $field jQuery-wrapped company field, current DOM lookup
   * @returns {void}
   */
  sweepOrphanedDropdown($field) {
    if ($field.data("select2")) return;
    const resultsIdPrefix = "select2-" + this.companyFieldSelector.replace("#", "") + "-results";
    jQuery("[id^='" + resultsIdPrefix + "']")
      .closest(".select2-container")
      .remove();
  }

  /**
   * Attach (or re-attach) the selectWoo widget to this instance's configured
   * field and wire up the search/select/open lifecycle (TWO-25326
   * architecture rebuild).
   *
   * Called from `Twoinc#enableCompanySearch()`, which is itself called from
   * `initialize()`, from its own 800ms retry, from
   * `exitManualCompanyEntry()` and from a sole-trader mode switch back to
   * search — every one of those needs the widget RE-attached (selectWoo's
   * own re-init tears down and rebuilds its instance), not a second
   * TwoCompanySearch constructed: the class itself is still constructed
   * exactly once, at module load, below. `clearSelectedCompany()` is the
   * other caller that (re-)initialises selectWoo on this field, directly
   * rather than through here — see `sweepOrphanedDropdown()`'s own comment.
   *
   * @param {Twoinc} [twoincInstance] the singleton, so the `select2:select`
   *   handler can write the pick onto it (customerCompany, approval, address
   *   lookup). Falls back to `Twoinc.getInstance()` when omitted.
   * @returns {Object} the jQuery-wrapped selectWoo widget
   */
  attach(twoincInstance) {
    const self = this;
    const $body = jQuery(document.body);
    const $field = $body.find(self.companyFieldSelector);

    self.sweepOrphanedDropdown($field);

    const widget = self.initCompanySearchWidget($field);
    twoincDomHelper.toggleTooltip(
      "#billing_company_display_field .select2-container",
      window.twoinc.text.tooltip_company
    );

    widget.on("select2:select", function (e) {
      // The dropdown now deliberately survives a sole-trader autofill flight
      // or an open signup popup (TWO-40 §7 correction) — its spinner means
      // "wait", not "browse". Before that, sole-trader mode always destroyed
      // this widget synchronously, so an ordinary pick landing here while
      // `mode === "sole_trader"` was unreachable; it no longer is (round-1
      // review — Han).
      //
      // A pick landing while still genuinely DECIDING (an autofill flight or
      // signup popup outstanding, adoption not yet settled) is refused, same
      // guard every other exit from sole-trader mode already uses
      // (`isDeciding()`'s own comment) — acting on it here would race the
      // flow's own eventual resolution exactly the way the Business chip and
      // `reopenSearch()` are guarded against doing.
      //
      // Once adopted, a pick made directly off this same still-live widget
      // (TWO-40 §7 direction (a): the widget now shows the adopted sole
      // trader as its own selection, not a destroyed-and-hidden one) IS the
      // buyer choosing a different company outright — the same "leave sole
      // trader" decision `reopenSearch()`/the Business chip make explicitly,
      // just arriving through an ordinary select instead of a click. Mirrors
      // `setMode("business")`'s transition bookkeeping directly rather than
      // calling `setMode()` itself: that call also destroys and rebuilds
      // this exact widget (see its own comment), which would blank the very
      // pick this handler is about to write right back out.
      if (twoincSoleTrader.mode === "sole_trader") {
        if (twoincSoleTrader.isDeciding()) return;
        twoincSoleTrader.mode = "business";
        twoincSoleTrader.soleTraderAdopted = false;
        twoincSoleTrader.soleTraderReconfirmingCount = 0;
        twoincSoleTrader.updateChips();
        twoincSoleTrader.syncDifferentSoleTraderLink();
        // The other write to `mode` — this one deliberately does not go
        // through `setMode()` (see above), so it owes the same re-sync: this
        // widget survives the pick, and nothing else would give the query row
        // back.
        twoincSelectWooHelper.syncSoleTraderSurfaces();
        twoincSoleTrader.leaveSoleTraderMode();
      }

      const instance = twoincInstance || Twoinc.getInstance();

      // Get the option data
      const data = e.params.data;

      // THE single write path (TWO-40 §5): posted fields, instance record,
      // pairing tag and provenance in one call. Writing `#company_id` here
      // directly, as this used to, leaves a pair the tag does not describe —
      // and the retype guard then wipes it on the buyer's next keystroke.
      twoincCompanyCapture.write(data.id, data.company_id, { country: self.currentCountry() });

      // Display the picked company read-only, synchronously.
      self.renderCompanySummary(data.id, data.company_id);

      // Clear the previous verdict, and leave any loader alone (review round 5):
      // `getApproval()` below only ARMS a check, so the replacement request is a
      // second away, and blanket-hiding here took down the spinner for a request
      // still in flight. This is the site the helper was written for.
      twoincDomHelper.clearIntentVerdicts();

      // Get the company approval status
      instance.getApproval();

      // Address search
      if (window.twoinc.enable_address_lookup === "yes") {
        instance.addressLookup(data);
      }
    });

    self.fixSelectWooPositionCompanyName();

    // Manual-entry affordance (TWO-25288). Bound here, once per widget,
    // rather than on every dropdown open: the handlers it installs are
    // delegated and outlive the dropdown, so re-binding them per open only
    // ever accumulated duplicates.
    self.bindManualEntryAffordance();

    widget.on("select2:open", function (e) {
      // Arguments kept verbatim: waitToFocus treats an explicit null as a
      // value rather than a default, so dropping them would change the poll
      // timing of the focus fix, which is not what this change is about.
      self.waitToFocus("billing_company_display", null, null);
      self.addSelectWooFocusFixHandler("billing_company_display");

      // In sole-trader mode this dropdown's own free-text query is not one of
      // the ways to get a different company — the dedicated
      // "select a different sole trader" flow (the link, or re-clicking the
      // chip — item 4.2/4.3, Doug) is the only one. The row is hidden, not
      // just readonly-locked, and restored on the way back out: see
      // `syncQueryFieldSuppression`. Still needed alongside the sync every
      // mode write now does: selectWoo re-attaches this row on every open, so
      // a suppression decided on one open does not carry to the next.
      self.syncSoleTraderSurfaces();
    });

    return widget;
  }
}

/**
 * The one and only TwoCompanySearch instance (TWO-25326 architecture
 * rebuild). Every company-search behaviour on this checkout — search,
 * dropdown, manual entry, tile relocation — goes through this instance;
 * nothing else in this file constructs a second one.
 */
let twoincSelectWooHelper = new TwoCompanySearch({
  companyFieldSelector: "#billing_company_display"
});

let twoincDomHelper = {
  /**
   * Add a placeholder after an input, used for moving the fields in HTML DOM
   */
  addPlaceholder: function ($el, name) {
    // Get an existing placeholder
    let $placeholder = jQuery("#twoinc-" + name + "-source");

    // Stop if we already have a placeholder
    if ($placeholder.length > 0) return;

    // Create a placeholder
    $placeholder = jQuery('<div id="twoinc-' + name + '-source" class="twoinc-source"></div>');

    // Add placeholder after element
    $placeholder.insertAfter($el);
  },
  /**
   * Move a field to Twoinc template location and leave a placeholder
   */
  moveField: function (selector, name) {
    // Get the element
    const $el = jQuery("#" + selector);

    // Add a placeholder
    twoincDomHelper.addPlaceholder($el, name);

    // Get the target
    const $target = jQuery("#twoinc-" + name + "-target");

    // Move the input
    $el.insertAfter($target);
  },
  /**
   * Move a field back to its original location
   */
  revertField: function (selector, name) {
    // Get the element
    const $el = jQuery("#" + selector);

    // Get the target
    const $source = jQuery("#twoinc-" + name + "-source");

    // Move the input
    if ($source.length > 0) {
      $el.insertAfter($source);
    }
  },
  /**
   * Move the fields to their original or Twoinc template location.
   *
   * Phone and email used to be pulled up here too (into the pre-billing
   * "representative" wrapper, alongside first/last name), so a buyer would
   * see one field order on first paint and a different one ~1s later once
   * this fired. That grouping's own visual cue (an h3 heading) was commented
   * out back in 2021 and never replaced with CSS, so nothing distinguishes
   * the wrapper today — it was pure reorder with no remaining display
   * purpose. Phone/email now stay in their native WC position (#33).
   */
  positionFields: function () {
    setTimeout(function () {
      // If business account
      if (twoincDomHelper.isTwoincSelected()) {
        twoincDomHelper.moveField("billing_first_name_field", "fn");
        twoincDomHelper.moveField("billing_last_name_field", "ln");
      } else {
        twoincDomHelper.revertField("billing_first_name_field", "fn");
        twoincDomHelper.revertField("billing_last_name_field", "ln");
      }

      twoincDomHelper.toggleTooltip(
        '#billing_phone, label[for="billing_phone"]',
        window.twoinc.text.tooltip_phone
      );
      twoincDomHelper.toggleTooltip(
        '#billing_company_display_field .select2-container, label[for="billing_company_display"], #billing_company, label[for="billing_company"]',
        window.twoinc.text.tooltip_company
      );
    }, 100);
  },
  /**
   * Mark checkout inputs invalid
   */
  markFieldInvalid: function (fieldWrapperId) {
    const fieldWrapper = document.querySelector("#" + fieldWrapperId);

    if (fieldWrapper && fieldWrapper.classList) {
      fieldWrapper.classList.remove("woocommerce-validated");
      fieldWrapper.classList.add("woocommerce-invalid");
    }
  },
  /**
   * Toggle the visual cues for required fields
   */
  toggleRequiredCues: function ($targets, is_required) {
    // For each input
    $targets.find(":input").each(function () {
      // Get the input
      const $input = jQuery(this);

      // Get the input row
      const $row = $input.parents(".form-row");

      // Toggle the required property
      if (is_required) {
        $input.attr("required", true);

        // Add 'required' visual cue
        if ($row.find("label .twoinc-required, label .required").length == 0) {
          $row
            .find("label")
            .append('<abbr class="required twoinc-required" title="required">*</abbr>');
        }
        $row.find("label .optional").hide();
      } else {
        $input.attr("required", false);

        // Show the hidden optional visual cue
        $row.find("label .twoinc-required").remove();
        $row.find("label .optional").show();
      }
    });
  },
  /**
   * Toggle the custom business fields for Twoinc
   */
  toggleBusinessFields: function () {
    // Get the targets
    let allTargets = [
      ".woocommerce-company-fields",
      ".woocommerce-representative-fields",
      "#billing_phone_field",
      "#billing_company_display_field",
      "#billing_company_field",
      "#company_id_field",
      "#invoice_email_field",
      "#purchase_order_number_field",
      "#project_field",
      "#department_field"
    ];
    let requiredBusinessTargets = [];
    let visibleTargets = [
      ".woocommerce-company-fields",
      ".woocommerce-representative-fields",
      "#billing_phone_field"
    ];
    let requiredTargets = [];

    // Toggle the targets based on the account type
    const isTwoincSelected =
      twoincDomHelper.isTwoincVisible() && twoincDomHelper.isTwoincSelected();

    // The company NAME is always on screen, as exactly one of two elements —
    // this search control or WooCommerce's native `#billing_company` (Doug,
    // 2026-08-19). Never neither: a buyer with nowhere to see or enter the
    // company name is the regression this replaces (an unsupported country
    // hid the search control and left a bare "Company ID" box behind, with no
    // name capture anywhere). Never both in the same place either — the one
    // exception is `company_search_location === "payment_tile"` below, where
    // the two are not competing for the same position: the search control has
    // been relocated into the payment tile, so the native field is what the
    // address area still needs (Doug 2026-08-04, live-verified).
    //
    // The search control is the visible surface for BOTH capture modes that
    // render a name into it — an ordinary registry pick and an adopted sole
    // trader (TWO-40 §7 direction (a): `lockCapturedFields()` seeds the widget
    // with the adopted company as its own selection, the same way PrestaShop's
    // `adoptSoleTraderBuyer()` never swaps its own search field away). Two
    // things take it away, both handing the name over to the native field:
    // manual entry, and a billing country with no registry to search. Manual
    // entry is reachable ONLY via
    // `enterManualCompanyEntry` — never as a side effect of Two being
    // unavailable, and never as a side effect of the merchant's admin setting
    // (#486, Doug: the two carve-outs this replaces were
    // `enable_company_search_for_others`, an admin toggle TWO-25326 removed
    // from the UI while leaving its logic running here keyed off
    // `isTwoincSelected`, and a runtime overload of `enable_company_search`
    // itself. Between them a buyer Two rejects — e.g. an email that resolves
    // to a different business — fell through to the plain manual field the
    // moment Two stopped being the selected method, silently downgrading a
    // registered-company or sole-trader buyer into manual-entry territory they
    // never asked for). WHERE the control renders is
    // `company_search_location`'s business, below and in
    // `syncCompanySearchTileLocation()`; never whether it is active.
    const showCompanySearch =
      twoincDomHelper.isCountrySupported() && twoincCompanyCapture.mode !== "manual";

    // `#company_id_field` is never in `visibleTargets` any more, in any mode
    // (Doug, 2026-08-19): the captured number is not a field the buyer fills
    // in at all. It reaches them as the read-only label
    // `renderCompanySummary()` renders below the name field, and the input
    // itself stays in the DOM permanently hidden, still named and still
    // posted, because its value is what WooCommerce posts and what the order
    // intent is authorised against. No mode has anything to type into it: the
    // picker and sole-trader enrollment write it programmatically, and manual
    // entry has no number to give.
    if (showCompanySearch) {
      visibleTargets.push("#billing_company_display_field");

      // WooCommerce's OWN native company field is a completely separate
      // concern from where OUR search control lives (bug found by Doug
      // 2026-08-04, live-verified against the checkbox-off/payment_tile
      // state): unchecking "Enable company search in address entry" moves
      // the search control into the payment tile, but must never take
      // WooCommerce's stock field away from the address area — the two
      // coexist, search in the tile, native field where WC always puts
      // it. Left untouched (no required cue): WC owns that field's own
      // required-ness, this plugin only decides whether it is shown.
      if (window.twoinc.company_search_location === "payment_tile") {
        visibleTargets.push("#billing_company_field");
      }
    } else {
      visibleTargets.push("#billing_company_field");
    }

    if (isTwoincSelected) {
      visibleTargets.push(
        "#invoice_email_field",
        "#purchase_order_number_field",
        "#project_field",
        "#department_field"
      );
      requiredTargets.push("#billing_phone_field");

      // Required-ness stays gated on Two actually being the selected
      // method — a buyer paying another way shouldn't be forced to fill in
      // company data Two itself has no use for right now.
      requiredTargets.push(
        showCompanySearch ? "#billing_company_display_field" : "#billing_company_field"
      );
    }

    allTargets = jQuery(allTargets.join(","));
    requiredTargets = jQuery(requiredTargets.join(","));
    visibleTargets = jQuery(visibleTargets.join(","));

    allTargets.addClass("hidden");
    visibleTargets.removeClass("hidden");

    // Toggle the required fields based on the account type
    twoincDomHelper.toggleRequiredCues(allTargets, false);
    twoincDomHelper.toggleRequiredCues(requiredTargets, isTwoincSelected);

    twoincDomHelper.syncCompanyFieldWrappers();

    // Relocate the company-search control per the admin setting (TWO-25326
    // §7.1) BEFORE renderCompanySummary() below: the summary node's anchor
    // (getCompanySummaryNode()) is relative to whichever field is currently
    // its neighbour, and this call may just have moved that field's wrapper
    // into the tile.
    twoincSelectWooHelper.syncCompanySearchTileLocation();

    // Last, and unconditionally: this function runs on every payment-method,
    // country and capture-mode switch, which is exactly when the summary's own
    // visibility gate needs re-evaluating. It reads the current inputs and
    // calls nothing that re-enters here.
    twoincSelectWooHelper.renderCompanySummary();

    // And after it, in that order: the "select a different sole trader" link
    // anchors against whichever company-NAME field this function just decided
    // to show, and behind the summary above when THAT is the visible one — so
    // it has to read a visibility the line above has already decided
    // (`placeDifferentSoleTraderBtn`'s own comment). Builds nothing on a
    // checkout that never shows the link: `syncDifferentSoleTraderLink()`
    // returns before touching the DOM while the button neither exists nor is
    // wanted.
    twoincSoleTrader.syncDifferentSoleTraderLink();
  },
  /**
   * Mirror each company field's visibility onto its enclosing wrapper
   * (TWO-25288).
   *
   * The pay-for-order page lays its copy of the company inputs out in
   * per-field wrappers, each carrying its own hidden state that the function
   * above does not touch — so hiding or revealing the field inside one has no
   * visible effect there. Manual entry was unreachable on that page until now,
   * which is the only reason that has not shown up: switching to it would have
   * revealed a company field still inside a hidden wrapper, leaving the buyer
   * with nowhere to type. The checkout page has no such wrappers and this is a
   * no-op there.
   *
   * @returns {void}
   */
  syncCompanyFieldWrappers: function () {
    jQuery("#billing_company_display_field, #billing_company_field, #company_id_field").each(
      function () {
        const $field = jQuery(this);
        const $wrapper = $field.closest(".twoinc-inp-container");
        if (!$wrapper.length) return;
        $wrapper.toggleClass("hidden", $field.hasClass("hidden"));
      }
    );
  },
  /**
   * Deselect payment method and select the first available one
   */
  deselectPaymentMethod: function () {
    const paymentMethodRadioObj = jQuery(':input[value="' + window.twoinc.gateway_id + '"]');
    // Deselect the current payment method
    if (paymentMethodRadioObj) {
      paymentMethodRadioObj.prop("checked", false);
    }
  },
  /**
   * Toggle the tooltip for input fields
   */
  toggleTooltip: function (selectorStr, tooltip) {
    if (window.twoinc.display_tooltips !== "yes") return;

    jQuery(selectorStr).each(function () {
      if (twoincDomHelper.isTwoincSelected()) {
        if (!jQuery(this).attr("original-title") && tooltip !== jQuery(this).attr("title")) {
          jQuery(this).attr("original-title", jQuery(this).attr("title"));
        }
        jQuery(this).attr("title", tooltip);
      } else {
        jQuery(this).attr("title", jQuery(this).attr("original-title"));
        jQuery(this).attr("original-title", "");
      }
    });
  },
  /**
   * The captured company as the intent-message sentences want it
   * (TWO-25326 §7.3): "<name> (<number>)", or bare <name> when there is no
   * number (manual entry, which clears #company_id). Never "<name> ()" —
   * an absent number is genuinely absent, not pending.
   *
   * This is what used to build the now-removed `.twoinc-company-tile-label`
   * text. It has the same job now, just substituted into the intent
   * sentences' data-company-template token instead of a standalone element.
   *
   * @param {string} name already blank-collapsed
   * @param {string} number already blank-collapsed
   * @returns {string}
   */
  getCompanyLabelText: function (name, number) {
    // TWO-25326 §12: the bracket composition, and the suppression of an
    // internally minted number inside it, both live in twoincUtilHelper now —
    // the search dropdown needs the identical rule with a different escaping
    // contract, and the two must not drift. A sole trader's captured company
    // reaches here with a `TWO:`-prefixed number, and comes out as the bare
    // name with no empty parens after it.
    return twoincUtilHelper.formatCompanyLabel(name, number);
  },
  /**
   * Write a verdict box's sentence, but only when it is not already that
   * sentence (review round 3).
   *
   * `.text()` replaces the box's child text node whether or not the string
   * differs, and that is a DOM mutation inside a `role="status"`/`role="alert"`
   * region — so assistive technology re-announced the same verdict on every
   * `updated_checkout` and every field blur that re-ran the pass. An assertive
   * region repeating "not available for this order" each time the buyer edits a
   * field is worse than the silence this replaced.
   *
   * @param {Object} $box jQuery set, possibly empty (brand suppressed the notice)
   * @param {string} text the sentence the box should be carrying
   * @returns {void}
   */
  setPayBoxText: function ($box, text) {
    // Per ELEMENT, not per set. `.text()` on a multi-element set returns the
    // CONCATENATION of all of them, so a set whose first copy already carried the
    // sentence and whose second was empty compared unequal, and `$box.text(text)`
    // then rewrote BOTH — re-announcing on the first. Comparing `.first()`
    // instead made it deterministic but skipped the second copy entirely, leaving
    // a visibly empty verdict box. Only an element-wise walk gets both halves
    // right: every copy ends up carrying the sentence, and none of them is
    // mutated unless it has to be. Reachable if a fragment swap ever leaves two
    // copies of the gateway description live.
    $box.each(function () {
      const $one = jQuery(this);
      if ($one.text() === text) return;
      $one.text(text);
    });
  },
  /**
   * The company label a verdict should name: the snapshot taken when the request
   * was issued, or a live DOM read when there is no snapshot.
   *
   * The snapshot is what fixes a wrong-company verdict (review round 5). These
   * sentences carry the captured company since TWO-25326 §7.3, and they were
   * built by re-reading the DOM at PAINT time — but supersession only begins when
   * the next request is issued, up to a second after the buyer changes company.
   * A response for company A landing inside that window painted A's verdict with
   * B's name and number in it, which is the most misleading thing this tile can
   * do: a decline attributed to the wrong company, or an approval.
   *
   * The live read stays as the fallback, for every caller that is re-rendering
   * rather than reporting a response — `updateElements()` and the picker's own
   * handlers, where the DOM IS the current truth.
   *
   * @param {string} [snapshot] label captured when the request went out
   * @returns {string}
   */
  resolveCompanyLabel: function (snapshot) {
    // An EMPTY snapshot is honoured, deliberately — `typeof`, not truthiness.
    //
    // "" means the capture read blank when the request went out, and the served
    // no-company sentence is the right thing to print for that. Falling back to a
    // live read instead was tried and REVERTED: by paint time the buyer may have
    // moved to another company, so it substitutes a name that has nothing to do
    // with the verdict — precisely the wrong-company defect the snapshot exists to
    // prevent, reintroduced through its own fallback. A generic sentence is a small
    // loss; a decline or an approval naming the wrong company is not.
    if (typeof snapshot === "string") return snapshot;
    return twoincDomHelper.readCompanyLabelFromDom();
  },
  /**
   * `<name> (<number>)` as the intent sentences want it, read from the live DOM.
   *
   * @returns {string}
   */
  /**
   * `<name> (<number>)` from the order-intent RECORD — the same `customerCompany` the
   * request body is built from, so a verdict's sentence and the question it answers
   * can never name different companies (review round 8).
   *
   * @returns {string}
   */
  readCompanyLabelFromRecord: function () {
    const record = Twoinc.getInstance().customerCompany || {};
    return twoincDomHelper.getCompanyLabelText(
      twoincUtilHelper.blankToEmpty(record.company_name),
      twoincUtilHelper.blankToEmpty(record.organization_number)
    );
  },
  readCompanyLabelFromDom: function () {
    const captured = twoincSelectWooHelper.readCapturedCompany();
    // The `blankToEmpty()` on the NAME is redundant — `formatCompanyLabel()` applies
    // it again downstream — so removing it changes nothing, and a mutation sweep
    // will show it surviving. Kept to honour `getCompanyLabelText()`'s documented
    // "already blank-collapsed" contract for both arguments rather than only one,
    // and recorded here so the survival reads as equivalence and not as a gap. The
    // collapse itself IS pinned, on the whitespace-only-name test.
    return twoincDomHelper.getCompanyLabelText(
      twoincUtilHelper.blankToEmpty(captured.company_name),
      twoincUtilHelper.blankToEmpty(captured.organization_number)
    );
  },
  /**
   * Take any previous order-intent VERDICT off screen, and nothing else.
   *
   * The loading state is deliberately left alone (review round 5). This runs
   * when a new check is armed, and at that moment a request from an earlier
   * check may still be in flight with the loader up for it — blanket-hiding
   * every pay-box there would blink the spinner off and leave the tile empty
   * until the new request was actually issued a second later.
   *
   * This is the whole of TWO-25326's "clear the message when the buyer changes
   * company while a new search is in flight": the verdict goes, the fact that
   * something is being checked stays.
   *
   * @returns {void}
   */
  clearIntentVerdicts: function () {
    // "Every pay-box except the loading state", rather than a list of the three
    // verdict classes. Same result today — those three plus the loader are all this
    // plugin renders — but a brand overlay or a later ticket adding a fourth verdict
    // box would silently not be cleared by a list, and the symptom (one stale box
    // surviving every clear) is a long way from the cause. The loader is the only
    // pay-box that must survive, so name that instead.
    jQuery(".twoinc-pay-box").not(".twoinc-loader").addClass("hidden");
  },
  /**
   * Toggle payment text in subtitle and description
   */
  togglePaySubtitleDesc: function (action, errSelector, companyLabel) {
    jQuery(".twoinc-pay-box").addClass("hidden");
    if (["checking-intent", "intent-approved", "errored"].includes(action)) {
      if (action === "checking-intent") {
        // Suppressed by the brand => the loader div is absent too
        // (TWO-25224: the notice switch covers the whole reassurance
        // pass, loading state included), so this is a no-op on an empty
        // jQuery set. The error branches below are never suppressed.
        jQuery(".twoinc-pay-box.twoinc-loader").removeClass("hidden");
      } else if (action === "intent-approved") {
        // The notice ships the no-company sentence as its text and the
        // company variant as a template on data-company-template (only the
        // browser knows the buyer's captured company). Substitute here,
        // always from the template, so a later company change re-renders
        // and an emptied company falls back to the served sentence.
        // Suppressed by the brand => the div is absent and every call
        // below is a no-op on an empty jQuery set.
        //
        // TWO-25326 §7.3: the token now stands for the WHOLE "<name>
        // (<number>)" chunk, not the bare name — this is what replaces the
        // separate `.twoinc-company-tile-label` element.
        let intentBox = jQuery(".twoinc-pay-box.twoinc-intent-approved");
        if (intentBox.data("twoincDefaultText") === undefined) {
          intentBox.data("twoincDefaultText", intentBox.text());
        }
        // Unhidden BEFORE its text is written, not after (review round 2).
        // `role="status"`/`role="alert"` only announce a content change made
        // while the region is IN the accessibility tree, and the first line of
        // this function hides every pay-box — so writing the sentence first and
        // revealing second mutated a region that was not in the tree, then
        // revealed a region whose content had not changed. Most likely outcome:
        // no announcement at all. Both happen in the same task, so the tree is
        // computed once at the end of it and this is one announcement, not two.
        intentBox.removeClass("hidden");
        let companyTemplate = intentBox.attr("data-company-template");
        let companyText = twoincDomHelper.resolveCompanyLabel(companyLabel);
        if (companyTemplate && companyText) {
          twoincDomHelper.setPayBoxText(
            intentBox,
            companyTemplate.replace("{company}", function () {
              // Function replacer (Vader, round 1 review): a string replacer
              // honours special patterns like `$&`/`$$` inside the SECOND
              // argument, so a company literally named "Acme $& Corp" or
              // "50% Ltd $$" would come out mangled with a plain-string
              // replace. A function replacer passes companyText through
              // literally, no matter what it contains.
              return companyText;
            })
          );
        } else {
          twoincDomHelper.setPayBoxText(intentBox, intentBox.data("twoincDefaultText"));
        }
      } else if (action === "errored") {
        // TWO-25326 §7.3: the "not available" box carries the same
        // data-company-template/token mechanism as the approved notice
        // above, but ONLY on `.twoinc-err-payment-default` — the phone-number
        // box is a fixed, unrelated message and never gets one.
        let $errBox = jQuery(".twoinc-pay-box" + errSelector);
        // Unhidden first, for the announcement reason given in the approved
        // branch above (review round 2). The phone-number box has no text to
        // rewrite, so for it this is simply the reveal.
        $errBox.removeClass("hidden");
        if (errSelector === ".twoinc-err-payment-default") {
          if ($errBox.data("twoincDefaultText") === undefined) {
            $errBox.data("twoincDefaultText", $errBox.text());
          }
          let declinedTemplate = $errBox.attr("data-company-template");
          let companyText = twoincDomHelper.resolveCompanyLabel(companyLabel);
          if (declinedTemplate && companyText) {
            twoincDomHelper.setPayBoxText(
              $errBox,
              declinedTemplate.replace("{company}", function () {
                return companyText;
              })
            );
          } else {
            twoincDomHelper.setPayBoxText($errBox, $errBox.data("twoincDefaultText"));
          }
        }
      }
    }
  },
  /**
   * Get company data from current HTML inputs
   */
  getCompanyData: function () {
    return {
      company_name: twoincSelectWooHelper.getCompanyName(),
      // Through the one country resolver (TWO-40 §1). Read raw here, this
      // deferred re-read un-cased a `country_prefix` the picker had pinned
      // upper-cased, so the same capture had two spellings depending on which
      // writer got there last.
      country_prefix: twoincSelectWooHelper.currentCountry(),
      organization_number: jQuery("#company_id").val()
    };
  },
  /**
   * Get representative data from current HTML inputs
   */
  getRepresentativeData: function () {
    let representativeData = {};
    if (jQuery("#billing_email").val())
      representativeData["email"] = jQuery("#billing_email").val();
    if (jQuery("#billing_phone").val())
      representativeData["phone_number"] = jQuery("#billing_phone").val();
    representativeData["first_name"] = jQuery("#billing_first_name").val();
    representativeData["last_name"] = jQuery("#billing_last_name").val();
    return representativeData;
  },
  /**
   * Check if selected country is supported by Twoinc
   */
  isCountrySupported: function () {
    // Same one country resolver as everything else (TWO-40 §1). The brand's
    // `supported_buyer_countries` list is upper-case ISO, which is what the
    // resolver returns.
    return window.twoinc.supported_buyer_countries.includes(twoincSelectWooHelper.currentCountry());
  },
  /**
   * Check if twoinc payment is currently selected
   */
  isTwoincSelected: function () {
    return jQuery('input[name="payment_method"]:checked').val() === window.twoinc.gateway_id;
  },
  /**
   * Check if twoinc payment is currently visible
   */
  isTwoincVisible: function () {
    return (
      jQuery("li.wc_payment_method.payment_method_" + window.twoinc.gateway_id).css("display") !==
      "none"
    );
    //return jQuery('#payment_method_' + window.twoinc.gateway_id + ':visible').length !== 0
  },
  /**
   * Get price recursively from a DOM node
   */
  getPriceRecursively: function (node) {
    if (!node) return;
    if (node.classList && node.classList.contains("woocommerce-Price-currencySymbol")) return;
    if (node.childNodes) {
      for (let n of node.childNodes) {
        let val = twoincDomHelper.getPriceRecursively(n);
        if (val) {
          return val;
        }
      }
    }
    if (node.nodeName === "#text") {
      let val = node.textContent
        .replaceAll(window.twoinc.price_thousand_separator, "")
        .replaceAll(window.twoinc.price_decimal_separator, ".");
      if (!isNaN(val) && !isNaN(parseFloat(val))) {
        return parseFloat(val);
      }
    }
  },
  /**
   * Get price from DOM
   */
  getPrice: function (priceName) {
    let node =
      document.querySelector("." + priceName + " .woocommerce-Price-amount bdi") ||
      document.querySelector("." + priceName + " .woocommerce-Price-amount");
    return twoincDomHelper.getPriceRecursively(node);
  },
  /**
   * Rearrange descriptions in Twoinc payment to make it cleaner
   */
  rearrangeDescription: function () {
    let twoincPaymentBox = jQuery(".payment_box.payment_method_" + window.twoinc.gateway_id);
    if (twoincPaymentBox.length > 0) {
      twoincPaymentBox.after(jQuery(".abt-twoinc"));
    }
  },
  /**
   * Save checkout inputs
   */
  saveCheckoutInputs: function () {
    let checkoutInputs = [];
    let checkoutForm = document.querySelector('form[name="checkout"]');
    // if page is order-pay
    if (!checkoutForm)
      checkoutForm = document.querySelector("div.checkout.woocommerce-checkout.custom-checkout");
    // still not found
    if (!checkoutForm) return;

    for (let inp of checkoutForm.querySelectorAll('input:not([type="radio"],[type="checkbox"])')) {
      if (inp.getAttribute("id")) {
        checkoutInputs.push({
          htmlTag: inp.tagName,
          id: inp.getAttribute("id"),
          name: inp.getAttribute("name"),
          type: inp.getAttribute("type"),
          val: inp.value
        });
      }
    }
    for (let inp of checkoutForm.querySelectorAll(
      'input[type="radio"]:checked,input[type="checkbox"]:checked'
    )) {
      if (inp.getAttribute("id")) {
        checkoutInputs.push({
          htmlTag: inp.tagName,
          id: inp.getAttribute("id"),
          name: inp.getAttribute("name"),
          type: inp.getAttribute("type")
        });
      }
    }
    for (let inp of checkoutForm.querySelectorAll('span[id$="-container"]')) {
      if (inp.getAttribute("id")) {
        let textOnly = inp.textContent;
        let hasPlaceholder = false;
        let subs = [];
        inp.childNodes.forEach(function (val) {
          if (val.nodeType === Node.TEXT_NODE) {
            textOnly = val.nodeValue.trim();
          } else if (val.nodeType === Node.ELEMENT_NODE) {
            if (val.classList.contains("select2-selection__placeholder")) {
              // The empty-field hint (TWO-25288) is an ELEMENT child, unlike
              // the non-breaking space the empty option used to render as a
              // text node — so neither the textContent seed above nor the
              // TEXT_NODE branch would treat this container as empty, and the
              // hint would be snapshotted as though the buyer had chosen a
              // company of that name. getCompanyName() reads this value, and
              // it is written into the posted #billing_company field.
              //
              // Excluded from `subs` for the same reason it is not a
              // selection: loadStorageInputs() re-appends every sub onto a
              // container whose restored html already carries the hint, so
              // keeping it here rendered the hint twice.
              hasPlaceholder = true;
              return;
            }
            subs.push(val.outerHTML);
          }
        });
        // A rendered placeholder means, by definition, that the widget has no
        // selection.
        if (hasPlaceholder) textOnly = "";
        checkoutInputs.push({
          htmlTag: inp.tagName,
          id: inp.getAttribute("id"),
          parentLabel: inp.parentNode.getAttribute("aria-labelledby"),
          html: inp.outerHTML,
          type: "select",
          name: inp.getAttribute("id"),
          val: textOnly,
          subs: subs
        });
      }
    }
    for (let inp of checkoutForm.querySelectorAll("select")) {
      if (inp.getAttribute("id")) {
        if (inp.querySelector('option[value="' + inp.value + '"]')) {
          checkoutInputs.push({
            htmlTag: inp.tagName,
            id: inp.getAttribute("id"),
            val: inp.value,
            optionHtml: inp.querySelector('option[value="' + inp.value + '"]').outerHTML
          });
        }
      }
    }
    sessionStorage.setItem("checkoutInputs", JSON.stringify(checkoutInputs));
  },
  /**
   * Get checkout input
   */
  getCheckoutInput: function (htmlTag, inpType, inpName) {
    let checkoutInputs = sessionStorage.getItem("checkoutInputs");
    if (!checkoutInputs) return;
    checkoutInputs = JSON.parse(checkoutInputs);
    for (let inp of checkoutInputs) {
      if (inp.htmlTag === htmlTag && inp.type === inpType && inp.name === inpName) {
        return inp;
      }
    }
  },
  /**
   * Load sessionStorage checkout inputs
   */
  loadStorageInputs: function () {
    let checkoutInputs = sessionStorage.getItem("checkoutInputs");
    if (!checkoutInputs) return;
    checkoutInputs = JSON.parse(checkoutInputs);
    for (let inp of checkoutInputs) {
      // Skip load company id/name if user logged in and has Two meta set
      if (window.twoinc.user_meta_exists) {
        let skipIds = ["company_id", "billing_company", "billing_company_display"];
        if (skipIds.includes(inp.id)) continue;
      }
      // Load all other fields
      if (inp.htmlTag === "INPUT") {
        if (inp.val && ["text", "tel", "email", "hidden"].indexOf(inp.type) >= 0) {
          if (document.querySelector("#" + inp.id) && !document.querySelector("#" + inp.id).value) {
            document.querySelector("#" + inp.id).value = inp.val;
          }
        } else if (inp.type === "radio") {
          if (document.querySelector("#" + inp.id) && inp.id != "payment_method_kco") {
            document.querySelector("#" + inp.id).click();
          }
        } else if (inp.type === "checkbox") {
          if (document.querySelector("#" + inp.id)) {
            document.querySelector("#" + inp.id).click();
          }
        }
      } else if (inp.htmlTag === "SPAN") {
        if (inp.parentLabel && inp.html) {
          if (document.querySelector("#" + inp.id)) {
            document.querySelector("#" + inp.id).remove();
          }
          let parentNode = document.querySelector('[aria-labelledby="' + inp.parentLabel + '"]');
          if (parentNode) {
            parentNode.innerHTML = inp.html + parentNode.innerHTML;
          }
          if (inp.subs && inp.subs.length > 0) {
            setTimeout(
              function (inp) {
                let elem = document.querySelector("#" + inp.id);
                if (elem) {
                  for (let sub of inp.subs) {
                    elem.innerHTML += sub;
                  }
                }
              },
              1000,
              inp
            );
          }
        }
      } else if (inp.htmlTag === "SELECT") {
        if (inp.val && inp.optionHtml) {
          let selectElem = document.querySelector("#" + inp.id);
          if (selectElem) {
            if (!selectElem.querySelector('option:not([value=""])')) {
              selectElem.innerHTML = inp.optionHtml + selectElem.innerHTML;
            }
            selectElem.value = inp.val;
          }
        }
      }
    }
  },
  /**
   * Load usermeta checkout inputs
   */
  loadUserMetaInputs: function () {
    window.twoinc.user_meta_exists = window.twoinc.billing_company && window.twoinc.company_id;
    if (document.querySelector("#billing_company_display")) {
      let selectElem = document.querySelector("#billing_company_display");
      if (!selectElem.querySelector('option:not([value=""])') && window.twoinc.user_meta_exists) {
        // Append to selectWoo
        if (!selectElem.querySelector('option[value="' + window.twoinc.billing_company + '"]')) {
          selectElem.innerHTML =
            '<option value="' +
            window.twoinc.billing_company +
            '">' +
            window.twoinc.billing_company +
            "</option>" +
            selectElem.innerHTML;
        }
        selectElem.value = window.twoinc.billing_company;

        // Show the restored company read-only beside the field. Both values
        // are passed explicitly: `#company_id` is written further down this
        // function, so reading the DOM here would render an empty number.
        if (window.twoinc.user_meta_exists) {
          twoincSelectWooHelper.renderCompanySummary(
            window.twoinc.billing_company,
            window.twoinc.company_id
          );
        }
      }
    }
    if (document.querySelector("#department") && window.twoinc.department) {
      document.querySelector("#department").value = window.twoinc.department;
    }
    if (document.querySelector("#project") && window.twoinc.project) {
      document.querySelector("#project").value = window.twoinc.project;
    }

    twoincDomHelper.restoreCapturedCompany();
  },
  /**
   * Re-capture a company the page arrived already holding, through the ONE
   * capture write path (TWO-40 §5), so the restored pair carries its pairing
   * tag. Written raw, as this used to be, the pair has no tag — and the retype
   * guard reads an absent tag as "this number no longer belongs to this name"
   * and wipes a perfectly good restored capture on the buyer's first keystroke
   * anywhere in the company field.
   *
   * Called after each of initialize()'s two restore passes, because either can
   * be the one that supplies the pair: the user-meta echo exists ONLY for a
   * signed-in WordPress user (WC_Twoinc_Checkout::prepare_twoinc_object, gated
   * on wp_get_current_user()->ID), while a guest's company reaches the DOM
   * without it — WooCommerce's own rendered value, or loadStorageInputs() one
   * call later. Live-confirmed by Doug: a checkout whose `#company_id` already held
   * a restored `TWO:…` id had both echo properties `undefined`, so a guard on
   * the echo alone skipped the whole restore — including its own DOM fallback.
   *
   * @returns {void}
   */
  restoreCapturedCompany: function () {
    const metaName = window.twoinc.billing_company;
    const metaId = window.twoinc.company_id;
    const domName = twoincCompanyCapture.nameField().val();
    const domId = twoincCompanyCapture.numberField().val();

    // BOTH halves from ONE source, never a half from each: a tag composed of
    // one restore's name and another's number describes a company that never
    // existed, and the retype guard — which compares the live fields against
    // that tag — would then be reading a fiction. The source holding a NUMBER
    // wins, that being what makes a pair a capture at all, and the user-meta
    // echo breaks the tie as the more deliberate record of the two.
    const fromUserMeta = Boolean(metaId) || (Boolean(metaName) && !domId);
    const restoredName = fromUserMeta ? metaName : domName;
    const restoredId = fromUserMeta ? metaId : domId;

    // Nothing to restore without a number — unless the echo is the source, in
    // which case a name alone is still a deliberate record of a manual-entry
    // capture. A bare name in the FIELD is not: initialize() runs on the first
    // re-render that makes this gateway visible, which can be after the buyer
    // has typed, and stamping plugin provenance on their own typing would let
    // a later country switch clear it as a value this plugin had written.
    if (!restoredId && !(fromUserMeta && restoredName)) return;

    twoincCompanyCapture.write(restoredName, restoredId);

    // Seed the PICKER with the restored name too, the same synthetic-`<option>`
    // mechanism `loadUserMetaInputs()` uses for the user-meta echo — option
    // VALUE is the name, matching what the picker's own `select2:select`
    // handler reads back as the company name.
    //
    // Only that echo was ever seeded, and this function deliberately restores
    // from two further sources with no echo behind them (WooCommerce's own
    // rendered value, and `loadStorageInputs()` — see the note above). The
    // picker is the visible company-NAME surface for a restored capture, and
    // `toggleBusinessFields()` hides the native field that used to display it,
    // so an unseeded picker left a returning guest looking at a placeholder
    // over a hidden field holding their own company — and `getCompanyName()`
    // reading it back empty, which stops an order intent firing at all.
    //
    // Never over an existing selection: `initialize()` calls this a second time
    // after `loadStorageInputs()`, and both of the seeding restores run before
    // that.
    if (restoredName) {
      const $display = jQuery("#billing_company_display");
      if ($display.length && !twoincUtilHelper.blankToEmpty($display.val())) {
        if (
          !$display.find("option").filter(function () {
            return this.value === restoredName;
          }).length
        ) {
          $display.prepend(jQuery("<option></option>").val(restoredName).text(restoredName));
        }
        // `.trigger("change")` for the same reason `lockCapturedFields()` uses
        // it: select2's own documented way to make a PROGRAMMATIC selection
        // render, without firing `select2:select` and re-entering that
        // handler's write path.
        $display.val(restoredName).trigger("change");
      }
    }

    // A restored SOLE TRADER (live-reported by Doug, item 2): this restore
    // path writes straight to the capture layer above rather than through
    // `twoincSoleTrader.setCompany()` — the only place that sets
    // `mode`/`soleTraderAdopted` and syncs the "select a different sole
    // trader" link — so a returning buyer whose last order used one saw
    // the company populate correctly with no way back into a fresh
    // signup, and a click-to-reopen or re-signup completing later found
    // `mode !== "sole_trader"` and was silently dropped (see
    // `bindPopupMessageListener`'s own comment for that failure mode).
    // `isSyntheticCompanyNumber` is what tells a restored sole trader's
    // `TWO:…` id apart from an ordinary registry number.
    if (twoincUtilHelper.isSyntheticCompanyNumber(restoredId)) {
      twoincSoleTrader.mode = "sole_trader";
      twoincSoleTrader.soleTraderAdopted = true;
      twoincSoleTrader.syncDifferentSoleTraderLink();
    }

    // Re-evaluate the company fields, because the write just above changes
    // what `#company_id`'s visibility depends on (TWO-25326 §12).
    //
    // Deliberately here rather than at the initialize() call site: this is the
    // function that performs the write, so the re-toggle cannot be separated
    // from it by a later reordering. A restored sole trader's identifier is a
    // minted `TWO:…` one, and initialize() has already toggled the fields once
    // by this point — against an empty input — so without this the identifier
    // is restored into a visible field on every page load.
    twoincDomHelper.toggleBusinessFields();
  },
  /**
   * Get id of current or parent theme, return null if not found
   */
  getThemeBase: function () {
    if (jQuery("#webtron-css-css").length > 0) {
      return "webtron";
    } else if (jQuery("#biagiotti-mikado-default-style-css").length > 0) {
      return "biagiotti-mikado";
    } else if (jQuery("#kava-theme-style-css").length > 0) {
      return "kava";
    } else if (jQuery("#storefront-style-inline-css").length > 0) {
      return "storefront";
    } else if (jQuery("#divi-style-css").length > 0) {
      return "divi";
    } else if (jQuery("#kalium-style-css-css").length > 0) {
      return "kalium";
    } else if (jQuery("#flatsome-style-css").length > 0) {
      return "flatsome";
    } else if (jQuery("#shopkeeper-styles-css").length > 0) {
      return "shopkeeper";
    }
  },
  /**
   * Get id of current or parent theme, return null if not found
   */
  insertCustomCss: function () {
    let themeBase = twoincDomHelper.getThemeBase();
    if (themeBase) {
      jQuery("head").append(
        '<link href="' +
          window.twoinc.twoinc_plugin_url +
          "assets/css/c-" +
          themeBase +
          '.css" type="text/css" rel="stylesheet" />'
      );
    }
  }
};

/**
 * Payment terms chip selector — presentation only (TWO-24751).
 *
 * All business logic (term availability, fee quoting, selection
 * validation) lives in WC_Twoinc_Payment_Terms; this module renders the
 * data the wc-ajax endpoints return and posts the buyer's selection back.
 */
let twoincTermChips = {
  fees: {},
  feesLoaded: false,

  config: function () {
    return (window.twoinc && window.twoinc.payment_terms) || { enabled: false };
  },

  /**
   * Re-render the chips after every checkout update (cart changes move
   * the fee quotes, so re-fetch then re-render).
   */
  refresh: function () {
    const cfg = twoincTermChips.config();
    const $container = jQuery(".twoinc-term-chips");
    if (!cfg.enabled || !cfg.terms || cfg.terms.length === 0 || $container.length === 0) {
      // Nothing to offer: make sure a heading left over from an earlier
      // checkout update does not sit above an empty container.
      jQuery(".twoinc-term-chips-heading").addClass("hidden").text("");
      return;
    }
    $container.removeClass("hidden");

    const willFetchFees = Boolean(cfg.offset_pricing_enabled && cfg.fees_url);
    // A checkout update invalidates the previous quotes, so show the
    // loading dots again until the fresh quotes arrive. When no fetch
    // will happen, skip straight to the settled (no-fee) state.
    twoincTermChips.feesLoaded = !willFetchFees;
    twoincTermChips.render(cfg.terms, cfg.selected);

    if (willFetchFees) {
      jQuery
        .post(cfg.fees_url, { nonce: cfg.nonce })
        .done(function (response) {
          twoincTermChips.feesLoaded = true;
          if (response && response.success && response.data) {
            twoincTermChips.fees = response.data.fees || {};
            twoincTermChips.render(response.data.terms, response.data.selected);
          } else {
            twoincTermChips.render(cfg.terms, cfg.selected);
          }
        })
        .fail(function () {
          // Fee labels are decorative: chips stay usable without them.
          // Re-render to settle the loading dots into the no-fee state.
          twoincTermChips.feesLoaded = true;
          twoincTermChips.render(cfg.terms, cfg.selected);
        });
    }
  },

  render: function (terms, selected) {
    const $container = jQuery(".twoinc-term-chips");
    if ($container.length === 0) return;
    $container.empty();

    const cfg = twoincTermChips.config();
    const single = terms.length === 1;

    // Heading placement mirrors Magento's Luma template: shown ABOVE the
    // chips only when the buyer has a choice to make. A single chip carries
    // its own "Payment Terms N days" label instead, so a heading there would
    // say the same thing twice.
    const $heading = jQuery(".twoinc-term-chips-heading");
    if (single || terms.length === 0) {
      $heading.addClass("hidden").text("");
    } else {
      $heading.text(cfg.heading || "").removeClass("hidden");
    }

    terms.forEach(function (days) {
      const isSelected = days === selected;
      const $chip = jQuery("<button>", {
        type: "button",
        class:
          "twoinc-term-chip" +
          (isSelected ? " twoinc-term-chip--selected" : "") +
          (single ? " twoinc-term-chip--single" : ""),
        role: "radio",
        "aria-checked": isSelected ? "true" : "false",
        "data-days": days,
        disabled: single
      });
      // A lone chip is not a choice, so it names what it is: Magento's
      // singleTermLabel ("Payment Terms N days") rather than the bare
      // "N days" used when the buyer is picking between chips.
      // Both templates come from PHP, already translated. The fallbacks
      // degrade to the SHORTER localised form rather than to an English
      // sentence: an English literal here renders as plausible copy on a
      // non-English shop and hides the fact that the label never arrived,
      // which is the failure class TWO-25270 was (heading does the same,
      // falling back to '' rather than to English).
      const labelTemplate = single
        ? cfg.single_label || cfg.days_label || "%s"
        : cfg.days_label || "%s";
      const daysLabel = labelTemplate.replace("%s", days);
      $chip.append(jQuery("<span>", { class: "twoinc-term-chip__days", text: daysLabel }));

      if (!twoincTermChips.feesLoaded) {
        // Fee quote in flight: show animated loading dots instead of a
        // blank chip. Never render the configured rate — only the real
        // quoted amount once it arrives.
        // twoinc-dots carries the shared dot-pulse styling; the BEM class stays
        // as the chip-scoped hook. Appearance is unchanged. It used to be
        // shared with the order-intent loader, which paints the spinner GIF
        // now — this is its only consumer (review round 8).
        const $loading = jQuery("<span>", {
          class: "twoinc-term-chip__loading twoinc-dots",
          "aria-hidden": "true"
        });
        for (let i = 0; i < 3; i++) {
          $loading.append(jQuery("<span>", { text: "." }));
        }
        $chip.append($loading);
      } else {
        const fee = twoincTermChips.fees[days];
        if (fee && parseFloat(fee.buyer_fee_share) > 0) {
          // buyer_fee_share_display is the amount run through the store's
          // own price format server-side, so it carries the currency SYMBOL
          // in the store's position — "+€12,50", matching Magento's
          // priceUtils.formatPrice. The raw amount + currency CODE is kept
          // only as the degraded fallback for a response that predates it.
          const feeLabel = fee.buyer_fee_share_display
            ? fee.buyer_fee_share_display
            : fee.buyer_fee_share + " " + fee.currency;
          $chip.append(
            jQuery("<span>", {
              class: "twoinc-term-chip__fee",
              text: "+" + feeLabel
            })
          );
        }
      }
      if (!single) {
        $chip.on("click", function () {
          twoincTermChips.select(days);
        });
      }
      $container.append($chip);
    });

    // The selection rides the checkout form post so process_payment can
    // validate it without depending on the session.
    let $hidden = $container.find("input[name='two_selected_term']");
    if ($hidden.length === 0) {
      $hidden = jQuery("<input>", { type: "hidden", name: "two_selected_term" });
      $container.append($hidden);
    }
    $hidden.val(selected);
  },

  select: function (days) {
    const cfg = twoincTermChips.config();
    if (!cfg.select_url) return;
    jQuery
      .post(cfg.select_url, { days: days, nonce: cfg.nonce })
      .done(function (response) {
        if (response && response.success && response.data) {
          cfg.selected = response.data.selected;
          // Recalculate totals so the offset fee follows the new term;
          // updated_checkout then re-renders the chips.
          jQuery(document.body).trigger("update_checkout");
        }
      })
      .fail(function () {
        // Keep the previous selection on failure.
      });
  }
};

/**
 * Sole trader checkout — presentation only (TWO-24754).
 *
 * All business logic (country eligibility, token minting) lives in
 * WC_Twoinc_Sole_Trader; this module renders a Business / Sole trader
 * toggle, suppresses company search in sole-trader mode, opens Two's
 * hosted signup popup, and autofills the company fields from
 * GET /autofill/v1/buyer/current. Mirrors the Magento reference flow.
 */
let twoincSoleTrader = {
  mode: "business", // 'business' | 'sole_trader'
  availabilityByCountry: {},
  tokens: null,
  // Snapshot of twoincCompanyCapture.mode, taken on the way INTO sole-trader
  // mode and put back on the way out (#30.x.13, round 1 review — Vader;
  // collapsed from a pair of snapshots into this one when the capture mode
  // replaced the `enable_company_search`/`manual_company_entry_active` pair,
  // #486). A buyer can reach sole-trader mode WHILE in manual entry — the mode
  // chip is not hidden during manual entry, and the email-driven autofill
  // prefetch can call setMode("sole_trader") unprompted — and without this they
  // come back out into `search`, with the link back to the picker never shown,
  // the number label reappearing over a company they are no longer capturing,
  // and `getCompanyName()` reading the picker instead of the field they typed
  // into. `null` means "nothing saved", distinct from every real mode value.
  savedCaptureMode: null,
  messageListenerBound: false,
  /** @type {Function|null} the bound `message` listener, so it can be removed */
  messageHandler: null,
  /** @type {Function|null} the bound window `focus` listener — see `bindWindowRefocusListener` */
  refocusHandler: null,
  /**
   * @type {Function|null} the bound capture-phase `mousedown` listener that
   * tells the refocus above WHICH gesture caused it — see
   * `bindWindowRefocusListener`
   */
  chipMousedownHandler: null,
  /**
   * @type {number|null} the pending abandon this refocus scheduled, or `null`
   * when none is outstanding. Doubles as the "is a refocus still undecided"
   * predicate the chip mousedown reads, so a mousedown made while the checkout
   * already had focus cannot be mistaken for the cause of a later refocus.
   */
  refocusAbandonTimer: null,
  /**
   * How long the abandon waits for the click that caused the refocus to
   * identify itself (Doug 2026-08-20).
   *
   * A window `focus` is dispatched BEFORE the `mousedown` of the click that
   * produced it, so the decision cannot be made in the focus handler itself —
   * it has to outlive it by long enough for that mousedown to arrive. The gap
   * is one native input event's worth of dispatch, single-digit milliseconds;
   * this is generous margin for a loaded main thread and still far below the
   * threshold at which a buyer would perceive the popup as lingering.
   */
  refocusChipGraceMs: 150,
  // Result of the most recent autofill prefetch for the entered email.
  // ready=false until the first prefetch resolves; matches=true when the
  // buyer on the Two cookie owns the email currently typed at checkout.
  prefetched: { ready: false, buyer: null, matches: false },
  // Email the prefetch last ran for, to dedupe repeated checkout re-renders
  // (and so a pre-filled email still prefetches once on first render).
  lastPrefetchEmail: null,

  /**
   * How many sole-trader round trips are outstanding (TWO-40 §7).
   *
   * A COUNT, not a boolean: the buyer can change email while a prefetch is
   * still in the air, which starts a second flight before the first settles.
   * A boolean would take the busy state down at the first settle and leave the
   * second running invisibly.
   *
   * Wired to the real async duration — every terminal branch of the call graph
   * settles its own flight — never to a fixed timeout. Adversarial review of
   * this exact feature upstream found stuck-forever spinners on two separate
   * abandon/retry paths, so every `cb(...)` below is a settle point.
   *
   * Also held by `watchPopupClose()` for as long as the signup popup itself
   * is open (TWO-40 §7 correction) — a second, later kind of "round trip
   * outstanding" sharing the same counter and the same in-field spinner,
   * not just the autofill prefetch this doc originally described.
   */
  flightDepth: 0,

  /**
   * Re-entrancy guard on the signup popup (TWO-40 §7).
   *
   * Without it a second activation — a double click on the chip, or the chip
   * click landing on top of a prefetch that has just resolved to "no matching
   * buyer" — opens a second popup over the first. Released when the popup call
   * returns, not when the popup CLOSES: the guard exists to make two
   * activations in one gesture idempotent, and holding it until the buyer
   * finishes signup would strand them if they closed the window by hand.
   */
  openingSignup: false,

  /**
   * A mode-chip click landed while the autofill prefetch it needs was still
   * in flight (TWO-40 §7 correction). Set by `onModeChipClick` to the email
   * it was raised for, consumed exactly once by `applyPrefetch` when a
   * flight settles FOR THAT SAME EMAIL — see both for why: showing the
   * manual signup link immediately, as this used to, could race the buyer
   * into opening a popup a matching autofill result was about to make
   * unnecessary.
   *
   * Keyed on email, not a bare boolean (round-1 review — Han, Vader): a
   * boolean gets consumed by whichever flight happens to settle first, which
   * is exactly the shape `flightDepth`'s own doc above says a boolean can't
   * handle — a buyer can edit the email again, or the click can outlive an
   * `isAvailable()`-gated flight that never actually started, before the
   * flight it was really waiting on lands. `null` when nothing is pending;
   * matching the CURRENTLY entered email at consume time is what makes a
   * stale decision (raised for an email no longer in the field) inert
   * rather than firing against whatever unrelated flight settles next.
   */
  pendingChipDecisionEmail: null,

  /**
   * Supersession counter for the autofill prefetch (TWO-40 §7 correction,
   * round-3 review — Vader) — same idiom as `addressLookupSeq`/
   * `orderIntentCheck.seq` elsewhere in this file. Bumped by `onEmailChanged`
   * every time it actually starts a new flight; each flight's `applyPrefetch`
   * call is stamped with the value at ITS start.
   *
   * `flightDepth > 0` cannot answer "is this response still the latest
   * word" — by the time a flight's own callback runs, `settleFlight()` has
   * already decremented depth for THAT flight, so depth alone looks
   * identical whether one flight is settling alone or is the second of two.
   * Two flights for two different emails, the newer started before the
   * older settled: if the older's stale response lands after the newer
   * already adopted a match, only a per-flight sequence number distinguishes
   * "the newest word" from "a stale one" — `flightDepth` reads the same
   * (zero) either way once both have settled.
   */
  prefetchSeq: 0,

  /**
   * The stamp of the most recently STARTED flight. Equal to `prefetchSeq`
   * while that flight is still the latest word, and behind it once
   * `abandonSoleTraderFlow()` has invalidated it — which is how a chip click
   * tells "a flight is running that will decide for me" from "a flight is
   * running whose answer will be thrown away" (`onModeChipClick`). Deferring
   * onto the latter resolves the click to NOTHING AT ALL, which TWO-40 §14
   * names as the failure to design out rather than re-tune.
   */
  startedPrefetchSeq: 0,

  /**
   * True once `setCompany()` has actually adopted a company while in
   * sole-trader mode THIS time through (TWO-40 §7 correction, round-1
   * review — Vader). Reset by every `setMode()` call, so it never reads a
   * value left over from before the current switch.
   *
   * `watchPopupClose()`'s "did the buyer abandon this popup with nothing
   * captured" check reads this instead of `#company_id`'s raw DOM value —
   * that field can already hold an unrelated id from an earlier manual
   * entry or registry pick, and `setMode("sole_trader")` never clears it on
   * entry, so the DOM alone can't tell "adopted THIS session" from "still
   * has old data lying around".
   */
  soleTraderAdopted: false,

  /**
   * How many "select a different sole trader" re-signups are outstanding
   * (TWO-40 §7 correction, round-4 review — Han/Vader; made a COUNT round-5
   * — Han/Vader).
   *
   * `soleTraderAdopted` is a one-way latch set by the FIRST adoption and
   * never cleared except by `setMode()` — which a re-signup never calls,
   * mode stays `sole_trader` throughout. Without this, `isDeciding()`
   * (`isBusy() && !soleTraderAdopted`) read the stale `true` from the first
   * adoption as "already settled" during a re-signup's own flight too, so
   * `reopenSearch()` and the Business chip refused nothing — a buyer
   * clicking a captured field WHILE that popup was still open could revert
   * to business mode and clear the fields, and the popup's own later
   * "ACCEPTED" then landed with `mode !== "sole_trader"` and was silently
   * dropped by `bindPopupMessageListener`.
   *
   * A COUNT, not a boolean (round-5 review — Han/Vader; same shape as
   * `flightDepth`'s own doc comment, and found the same way — nothing
   * disables the "select a different sole trader" link while a re-signup
   * for it is already in flight, so a buyer closing one popup and
   * re-clicking within the SAME 300ms poll window opens a second, genuinely
   * concurrent re-signup: the first popup's own stale poll then clears a
   * bare boolean while the second is still very much open and undecided).
   * Incremented by `launchSignup` for every re-signup it opens; decremented
   * exactly once per popup, by that popup's own decrement owner — the
   * ACCEPTED handler for a decided popup, `watchPopupClose`'s poll for an
   * abandoned one (see the watcher record's `decided` flag). Clamped at
   * zero, same reason `settleFlight` is.
   */
  soleTraderReconfirmingCount: 0,

  /**
   * True while the ACCEPTED-postMessage handler's own `fetchCurrentBuyer()`
   * is in flight (TWO-40 §7 correction, round-1 review — Han). Popup-close
   * detection is a poll with no cooperation from the popup — the buyer (or
   * the hosted flow itself) can close the window the instant "ACCEPTED" is
   * posted, well before this fetch resolves and writes `#company_id`.
   * Without this, `watchPopupClose()`'s poll could see mode still
   * `sole_trader` and nothing captured YET and revert to business out from
   * under a signup that was in fact about to complete.
   */
  signupConfirming: false,

  /**
   * One record per live `watchPopupClose` poll: `{ id, win, isReconfirming,
   * decided }`. `id` is the `setInterval` handle, so tests (and any other
   * caller needing a clean slate) can stop every outstanding poll; `win` is
   * the popup itself, which is what lets an inbound message be attributed to
   * the record that actually sent it.
   *
   * `decided` is the popup's OWN outcome — set when the hosted flow posts
   * "ACCEPTED" for it — as distinct from the global `soleTraderAdopted`/
   * `soleTraderReconfirmingCount` state, which other actors (an autofill
   * prefetch matching mid-popup, a second popup) can move while this popup
   * is still open. `launchSignup`'s stacking guard and both
   * `soleTraderReconfirmingCount` decrements read the record, so an
   * accepted-then-closed popup cannot spend two decrements against its one
   * increment, and a still-undecided popup cannot be mistaken for settled
   * just because something ELSE adopted a company meanwhile.
   *
   * TWO OR MORE records can be undecided at once, so nothing may pair a
   * message with "the undecided record" by search order (round-3 review):
   * `launchSignup` refuses only a LIVE undecided popup, so a hand-closed one
   * stays in this list, still undecided, until its own poll notices — up to a
   * full 300ms during which a relaunch can open alongside it.
   * `findPopupWatcher` owns the attribution.
   */
  activePopupWatchers: [],

  /**
   * A signup popup has been opened during this flow, so the company-search
   * dropdown must be closed if it is open once the flow completes (Doug
   * 2026-08-20 — see `closeCompanySearchDropdownIfOpen`).
   *
   * A flag rather than a call at popup-open time because the close belongs at
   * the END of the flow, and rather than a check inside `settleFlight` because
   * the flights an email-change prefetch runs on its own must not close a
   * dropdown the buyer opened and is still typing in. Set by every launch that
   * actually opened a window, consumed exactly once at depth zero, so both
   * entry points and any number of nested flights resolve to one close.
   */
  closeDropdownOnSettle: false,

  /** DOM id of the "select a different sole trader" link (TWO-40 §7). */
  differentSoleTraderBtnId: "select_different_sole_trader_btn",

  config: function () {
    return (window.twoinc && window.twoinc.sole_trader) || {};
  },

  // Delegated rather than a second copy of the same two lines (TWO-24867):
  // sole-trader availability is decided per country and cached per country,
  // so it disagreeing with the country the search and the change guard use
  // would be a cache keyed on one answer and read with another.
  currentCountry: function () {
    return twoincSelectWooHelper.currentCountry();
  },

  // The chip lives in the payment tile, which has no address fields of its
  // own, so every read below names the INVOICE role explicitly (TWO-40 §1
  // a.3) rather than reaching for "whichever address form is on screen".
  enteredEmail: function () {
    return twoincAddressRoles.value(twoincAddressRoles.invoice(), "email");
  },

  isAvailable: function () {
    const country = twoincSoleTrader.currentCountry();
    return twoincSoleTrader.availabilityByCountry[country] === true;
  },

  /**
   * Re-evaluate the toggle after every checkout update or country change.
   * Availability is decided server-side by the registry answer for the
   * billing country (there is no merchant toggle — TWO-25163); responses
   * are cached per country for the page's lifetime.
   */
  refresh: function () {
    const cfg = twoincSoleTrader.config();
    const $noteSlot = jQuery(".twoinc-sole-trader-note-slot");
    if (!cfg.availability_url || $noteSlot.length === 0) {
      twoincSoleTrader.hide();
      return;
    }
    const country = twoincSoleTrader.currentCountry();
    if (!country) {
      twoincSoleTrader.hide();
      return;
    }
    if (country in twoincSoleTrader.availabilityByCountry) {
      twoincSoleTrader.apply(twoincSoleTrader.availabilityByCountry[country]);
      return;
    }
    jQuery
      .get(cfg.availability_url, { country: country, nonce: cfg.nonce })
      .done(function (response) {
        const available = !!(
          response &&
          response.success &&
          response.data &&
          response.data.available
        );
        twoincSoleTrader.availabilityByCountry[country] = available;
        // The buyer may have changed country while the request was in
        // flight; only apply if the answer is still for the current one.
        if (twoincSoleTrader.currentCountry() === country) {
          twoincSoleTrader.apply(available);
        }
      })
      .fail(function () {
        // Fail-soft: no sole trader option, checkout proceeds as business.
        if (twoincSoleTrader.currentCountry() === country) {
          twoincSoleTrader.apply(false);
        }
      });
  },

  apply: function (available) {
    if (available) {
      twoincSoleTrader.render();
    } else {
      twoincSoleTrader.hide();
    }
    // The sole-trader mode CHIP lives inside the company-search dropdown
    // (TWO-40 §0), not here — re-sync it so an availability change while
    // the dropdown is already open adds/removes the chip live.
    twoincSelectWooHelper.syncManualEntryButton();
  },

  hide: function () {
    jQuery(".twoinc-sole-trader-note-slot").addClass("hidden").empty();
    jQuery("#" + twoincSoleTrader.differentSoleTraderBtnId).hide();
    // Re-show (e.g. country change) should prefetch afresh.
    twoincSoleTrader.lastPrefetchEmail = null;
    // Refused while `isBusy()` (round-2 review — Han/Vader), same as the
    // Business chip and `reopenSearch()`: this runs from `refresh()`, which
    // fires on every `updated_checkout` — a coupon apply, a shipping-method
    // change, a quantity edit, not only a country change (see `refresh()`'s
    // own comment) — so an unconditional revert here dropped a signup that
    // was still completing in the popup, the exact failure round 1 fixed for
    // `watchPopupClose`'s own poll, reopened through this wider door. The
    // flight/popup's own terminal branch (`applyPrefetch`, `watchPopupClose`)
    // re-checks availability/adoption once it actually settles, so deferring
    // here loses nothing.
    if (twoincSoleTrader.mode === "sole_trader" && !twoincSoleTrader.isBusy()) {
      twoincSoleTrader.setMode("business");
    }
  },

  render: function () {
    const cfg = twoincSoleTrader.config();
    const $container = jQuery(".twoinc-sole-trader-note-slot");
    $container.empty().removeClass("hidden");

    // Bell-icon note + signup link — shown only when sole-trader mode is
    // active and signup is needed (no matching autofill), and as the
    // fallback when an auto-launched popup is blocked.
    //
    // The mode CHIPS themselves (TWO-40 §0 — the same DOM-placement defect
    // ported wrong twice before this) are NOT built here: they render as
    // children of the company-search dropdown — see
    // twoincSelectWooHelper.syncManualEntryButton()/syncSoleTraderChip() —
    // never as part of this always-present payment-tile note slot.
    const $note = jQuery(
      '<div class="twoinc-sole-trader-note hidden">' +
        '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0M3.124 7.5A8.969 8.969 0 015.292 3m13.416 0a8.969 8.969 0 012.168 4.5"/>' +
        "</svg></div>"
    );
    jQuery("<a>", {
      href: "#",
      class: "twoinc-sole-trader-note__link",
      text: cfg.text.popup_prompt
    })
      .on("click", function (event) {
        event.preventDefault();
        twoincSoleTrader.launchSignup();
      })
      .appendTo($note);
    $container.append($note);

    // `openPopup` needs tokens, and the prefetch below only mints them once an
    // email exists — so a chip click before the buyer has typed one had no
    // tokens to open a popup with (TWO-40 §7 correction). Minted here rather
    // than at click time because `window.open()` outside the click's own
    // gesture is blocker bait.
    //
    // Skipped once an email is entered: the prefetch below mints for it anyway,
    // and two concurrent mints race each other's write to `.tokens`.
    if (!twoincSoleTrader.tokens && !twoincSoleTrader.enteredEmail()) {
      twoincSoleTrader.fetchTokens();
    }

    // Prefetch for an already-filled email (returning/logged-in buyer), so a
    // known sole trader is auto-selected without waiting for an email edit.
    twoincSoleTrader.onEmailChanged();
  },

  /**
   * Cosmetic-only selected-chip class (TWO-40 §0), delegated to the group's
   * own owner — the chips live inside the company-search dropdown, not
   * here. Kept as a thin alias so `setMode()` below needs no change.
   */
  updateChips: function () {
    twoincSelectWooHelper.updateModeChipsSelection();
  },

  showNote: function (show) {
    jQuery(".twoinc-sole-trader-note").toggleClass("hidden", !show);
  },

  /**
   * A sole-trader round trip has started (TWO-40 §7).
   *
   * The busy state is shown over the company-NAME field — the same in-field
   * spinner an ordinary company search uses, in the field this flow is
   * filling in rather than in the query row it hides (Doug 2026-08-20; see
   * `syncSoleTraderSpinner`). The search control is left open rather than
   * closed under the buyer, and the name field is on screen either way, so the
   * spinner is visible for the link-click entry point too — that one never had
   * a dropdown open to paint in.
   *
   * @returns {void}
   */
  beginFlight: function () {
    twoincSoleTrader.flightDepth += 1;
    if (twoincSoleTrader.flightDepth === 1) {
      // The note slot AND the chip group (if the dropdown happens to be
      // open) — the two places busy state is ever visible, now that the
      // chips no longer share the note slot's container (TWO-40 §0).
      jQuery(".twoinc-sole-trader-note-slot, .twoinc-mode-chips").addClass(
        "twoinc-sole-trader-toggle--busy"
      );
    }
    twoincSelectWooHelper.syncSoleTraderSurfaces();
  },

  /**
   * A sole-trader round trip has reached a terminal state — success, failure,
   * retry-exhausted or abandoned. Every branch that can end one calls this.
   *
   * Clamped at zero so an unbalanced settle cannot drive the count negative
   * and make a subsequent genuine flight invisible.
   *
   * Depth reaching zero IS "the flow is complete" in the sense the spinner and
   * the dropdown close are gated on (Doug 2026-08-20): the popup's own watcher
   * holds a flight until the window is gone, and the ACCEPTED handler holds a
   * second one across `fetchCurrentBuyer` until `setCompany()` has written the
   * company name and number. Nothing else has to be joined up for it —
   * `flightDepth` already counts both, and it is only zero once every one of
   * them has finished.
   *
   * @returns {void}
   */
  settleFlight: function () {
    twoincSoleTrader.flightDepth = Math.max(0, twoincSoleTrader.flightDepth - 1);
    if (twoincSoleTrader.flightDepth === 0) {
      jQuery(".twoinc-sole-trader-note-slot, .twoinc-mode-chips").removeClass(
        "twoinc-sole-trader-toggle--busy"
      );
      if (twoincSoleTrader.closeDropdownOnSettle) {
        // Consumed once, before the surfaces below re-sync: this is the
        // shared sequence's third step — see
        // `closeCompanySearchDropdownIfOpen`.
        twoincSoleTrader.closeDropdownOnSettle = false;
        twoincSelectWooHelper.closeCompanySearchDropdownIfOpen();
      }
    }
    twoincSelectWooHelper.syncSoleTraderSurfaces();
  },

  /**
   * The "select a different sole trader" link, built hidden on first use
   * (TWO-40 §7).
   *
   * Same visual slot and the same shape as the "search for company" link that
   * manual-entry mode already offers — one affordance pattern for "the
   * identity I captured is not the one I want", whichever capture mode
   * produced it.
   *
   * ONE link covers both "pick a different existing registration" and
   * "register a new one": that choice happens inside the hosted signup's own
   * UI once the popup is open, so the plugin does not distinguish the two.
   *
   * @returns {Object} jQuery-wrapped button
   */
  getDifferentSoleTraderBtnNode: function () {
    const id = twoincSoleTrader.differentSoleTraderBtnId;
    let $btn = jQuery("#" + id);
    if ($btn.length) {
      twoincSoleTrader.placeDifferentSoleTraderBtn($btn);
      return $btn;
    }

    $btn = jQuery("<button></button>")
      .attr({ id: id, type: "button" })
      .text(
        (twoincSoleTrader.config().text && twoincSoleTrader.config().text.select_different) ||
          "Select a different sole trader"
      )
      .hide()
      // Bound directly on the element, click AND Enter/Space, for the same
      // reasons documented on getSearchCompanyBtnNode — a delegated click on
      // document.body was proven not to reach that button live.
      .on("click", function (event) {
        event.preventDefault();
        twoincSoleTrader.launchSignup({ autoselect: false });
      })
      .on("keydown", function (event) {
        if (event.which !== 13 && event.which !== 32) return;
        event.preventDefault();
        event.stopPropagation();
        twoincSoleTrader.launchSignup({ autoselect: false });
      });

    twoincSoleTrader.placeDifferentSoleTraderBtn($btn);
    return $btn;
  },

  /**
   * Where the "select a different sole trader" link currently belongs.
   *
   * Its default home is `companyFieldAffordanceSlot()` — the same slot as
   * the "search for company" link, inside `#billing_company_field` — which
   * is correct for every merchant this link predates: manual entry and an
   * ordinary registered-company pick both leave that field the visible one.
   *
   * TWO-40 §7 direction (a) makes an adopted sole trader show through the
   * live SEARCH widget instead (`twoincCompanyCapture.mode === "sole_trader"`,
   * `toggleBusinessFields()`'s own comment), which hides
   * `#billing_company_field` outright to do it — a button appended inside a
   * hidden field never renders, however its own `.toggle(show)` reads (the
   * bug this exists to fix, live-reported by Doug: `#company_id` and
   * `tokens` were never the problem, `syncDifferentSoleTraderLink()`'s own
   * gate was right — the button just had nowhere visible to render). Follow
   * the search field itself whenever it — not the native field — is what's
   * actually shown, re-anchoring on every call the same way
   * `getCompanySummaryNode()` already does for the same reason.
   *
   * @param {Object} $btn jQuery-wrapped button
   * @returns {void}
   */
  placeDifferentSoleTraderBtn: function ($btn) {
    const $searchField = jQuery("#billing_company_display_field");
    if (jQuery("#billing_company_field").hasClass("hidden") && $searchField.length) {
      const $wrapper = $searchField.closest(".twoinc-inp-container");
      let $anchor = $wrapper.length ? $wrapper : $searchField;
      // Behind the number label while THAT is the visible one, in front of it
      // otherwise (defect found reviewing #486 as a whole). Both this link and
      // `getCompanySummaryNode()`'s label follow the same anchor, and both move
      // only when they are not already sitting on it, so they compete for the
      // one slot directly after the field — and `toggleBusinessFields()` calls
      // the label's placement on every payment-method, country and mode switch,
      // so the label took the slot back every time. Whichever loses it also
      // loses its own `+`-selector gap cancellation in twoinc.css, which is how
      // an adopted sole trader's link grew a ~33px gap above it on the buyer's
      // first payment-method switch. Exactly one of the two is ever visible
      // (the label renders in registered-search mode only, this link in
      // sole-trader mode only), so ordering by visibility gives the slot to
      // the one that can actually use it.
      const $summary = jQuery("#" + twoincSelectWooHelper.companySummaryId);
      if ($summary.length && !$summary.hasClass("hidden") && $summary.prev()[0] === $anchor[0]) {
        $anchor = $summary;
      }
      if ($btn.prev()[0] !== $anchor[0]) $btn.insertAfter($anchor);
      return;
    }
    // Same "only move when it isn't already there" guard as the branch above,
    // for the same reason `getCompanySummaryNode()` has one: this now runs on
    // every `toggleBusinessFields()`, and an unconditional `append()` re-homes
    // a node that had not drifted on each one.
    const $slot = twoincSelectWooHelper.companyFieldAffordanceSlot();
    if ($btn.parent()[0] !== $slot[0]) $slot.append($btn);
  },

  /**
   * Show the "select a different sole trader" link only where it means
   * something: sole-trader mode (TWO-40 §7).
   *
   * Mode and tokens only (Doug's ruling, TWO-40 §7 correction) — no
   * `#company_id`-content check: there is no real UX state where sole-trader
   * mode is engaged with nothing captured, except while the dropdown itself
   * is still open/rendered deciding what to show, and that already visually
   * obscures this link. Probing a DOM field for "is a company adopted" was
   * also the wrong source of truth once `#company_id_field` stopped being a
   * field the buyer ever sees at all (Doug 2026-08-19: permanently hidden in
   * every mode) — the value still gets written there
   * (`twoincCompanyCapture.write()` is unconditional), but there is no
   * reason to lean on that DOM detail here when mode + tokens already say
   * everything this gate needs.
   *
   * @returns {void}
   */
  syncDifferentSoleTraderLink: function () {
    const show = twoincSoleTrader.mode === "sole_trader" && !!twoincSoleTrader.tokens;
    // Built lazily, and only when it is about to be shown. This runs on every
    // mode switch — including the setMode("business") a checkout with no
    // sole-trader option ever reaches — and building it there would insert a
    // hidden button (and, via the slot's self-heal, a wrapper element) into
    // the address form of every merchant who never sees this feature.
    if (!show && !jQuery("#" + twoincSoleTrader.differentSoleTraderBtnId).length) return;
    twoincSoleTrader.getDifferentSoleTraderBtnNode().toggle(show);
  },

  /**
   * A mode chip was clicked. Business is immediate; Sole trader switches
   * mode then acts on the prefetched autofill result so the signup popup
   * (when needed) opens in the same synchronous gesture as the click.
   */
  onModeChipClick: function (mode) {
    if (mode === "business") {
      // Not the real Business chip's own wiring today — that binds
      // `setMode` directly with its own `isDeciding()` guard
      // (`buildBusinessChip`) — but this branch is part of the same public
      // entry point, so it gets the same guard rather than silently
      // regressing the moment something else calls it (round-2 review —
      // Vader; predicate corrected to `isDeciding()` round-3 — Vader).
      if (!twoincSoleTrader.isDeciding()) twoincSoleTrader.setMode("business");
      return;
    }
    // A signup the buyer has not finished is still on screen, so this click is
    // asking for it BACK, not for anything new (Doug 2026-08-20, item 6.1):
    // raise it and stop. Before every branch below, because each of them is
    // wrong while that popup is live — `launchSignup` would be refused by its
    // own live-popup guard and do nothing visible at all, and the prefetch
    // branch is worse, adopting a company behind a window the buyer is still
    // deciding in (TWO-40 §14).
    //
    // Here, on the CHIP, rather than on the refocus that usually precedes it,
    // even though item 6.1 was reported as a refocus symptom. A chip activated
    // from the keyboard fires `click` with no `mousedown` at all, so a raise
    // hung off the refocus's mousedown would leave Enter/Space on this chip as
    // the one route that cannot get the buyer back to their own popup. The
    // refocus decides only whether the popup is CLOSED; what a live popup means
    // for a Sole trader click is the same question however focus got here.
    if (twoincSoleTrader.refocusOpenPopups()) return;
    // Re-clicking once already adopted is the SAME re-signup the "select a
    // different sole trader" link launches — NOT the Business chip's
    // already-selected no-op (Doug's explicit override, item 4.3: an
    // earlier round made this a no-op on the theory that the link should be
    // the one deliberate re-signup entry point, which Doug has now ruled
    // wrong — the chip is a second, equally deliberate way to ask for the
    // same thing). Routed through `launchSignup` directly rather than
    // `setMode`+the `pf` branches below: those exist to decide sole-trader
    // mode for the FIRST time, and re-running them here could re-adopt the
    // SAME prefetched match with no popup at all, which is not what
    // "select a different" means.
    if (twoincSoleTrader.mode === "sole_trader" && twoincSoleTrader.soleTraderAdopted) {
      twoincSoleTrader.launchSignup({ autoselect: false });
      return;
    }
    twoincSoleTrader.setMode("sole_trader");
    const pf = twoincSoleTrader.prefetched;
    if (pf.ready && pf.matches && pf.buyer) {
      twoincSoleTrader.setCompany(pf.buyer.organization_number, pf.buyer.company_name, pf.buyer);
      twoincSoleTrader.showNote(false);
      return;
    }
    if (pf.ready) {
      // Prefetch resolved with no matching buyer → signup. Opening here keeps
      // the user gesture intact so the popup is not blocker-killed.
      twoincSoleTrader.launchSignup();
      return;
    }
    if (!twoincSoleTrader.enteredEmail()) {
      // No email, so nothing autofill could match: the outcome is already
      // signup (TWO-40 §7 correction — a chip click resolves to populated or
      // popup, never to a note). Synchronous, on the tokens `render()` minted
      // up front — see the mint's own comment.
      twoincSoleTrader.launchSignup();
      return;
    }
    // An email is entered but the prefetch has not settled (live-reported by
    // Doug, TWO-40 §7 correction): showing the manual "click here to sign up"
    // link here raced the buyer against their own in-flight autofill result —
    // clicking it opened a popup, and the prefetch landing moments later then
    // ALSO silently populated the fields behind it. Wait for the flight
    // instead and decide exactly once, from whatever it resolves to (see
    // applyPrefetch). The search dropdown/spinner is left alone here — see
    // setMode's own comment — so it stays visible for the whole wait.
    twoincSoleTrader.pendingChipDecisionEmail = twoincSoleTrader.enteredEmail();
    // A flight `abandonSoleTraderFlow()` has invalidated is not a flight to
    // wait for: its `applyPrefetch` returns early, so this click would resolve
    // to nothing at all. Reachable inside one flight's lifetime — the buyer
    // leaves sole-trader mode (which abandons it) and clicks the chip straight
    // back. `onEmailChanged`'s same-email dedupe would refuse to replace the
    // dead flight, so it is dropped for exactly this case, and only here: a
    // blanket clear would let the next `updated_checkout` re-run the lookup
    // and re-adopt behind a buyer who had left.
    const awaitedFlightIsStale =
      twoincSoleTrader.startedPrefetchSeq !== twoincSoleTrader.prefetchSeq;
    if (awaitedFlightIsStale) {
      twoincSoleTrader.lastPrefetchEmail = null;
    }
    if (twoincSoleTrader.flightDepth === 0 || awaitedFlightIsStale) {
      twoincSoleTrader.onEmailChanged();
    }
  },

  /**
   * Is a sole-trader autofill flight or a signup popup currently
   * outstanding (TWO-40 §7 correction, round-1 review — Han/Vader)?
   *
   * The one guard every OTHER way to leave/interrupt sole-trader mode needs
   * to check before acting: the widget/mode chips now deliberately survive
   * this whole window (see `setMode`'s own comment), so paths that used to
   * be unreachable while `mode === "sole_trader"` — the Business chip,
   * `reopenSearch()`, an ordinary company pick — are reachable now, and
   * acting on them mid-wait races the flow's own eventual resolution.
   *
   * @returns {boolean}
   */
  isBusy: function () {
    return twoincSoleTrader.flightDepth > 0 || twoincSoleTrader.activePopupWatchers.length > 0;
  },

  /**
   * Is sole-trader mode still DECIDING what it is — as opposed to already
   * adopted, with `activePopupWatchers` only nonzero because the poll hasn't
   * yet noticed the popup window closed (TWO-40 §7 correction, round-3
   * review — Vader)?
   *
   * `isBusy()` alone over-blocks a direct, explicit buyer action to LEAVE
   * sole-trader mode (the Business chip, `reopenSearch()`, manual entry):
   * once `soleTraderAdopted` is true the outcome is already settled — the
   * captured fields are locked and showing — and refusing the click for
   * that last stretch of the popup-close poll is a real UX regression, not
   * a safety guard. `watchPopupClose()`'s own revert already reads
   * `soleTraderAdopted` directly rather than this, since its question is
   * the opposite one ("did THIS wait end with nothing captured").
   *
   * ORed with `soleTraderReconfirming` (round-4 review — Han/Vader):
   * `soleTraderAdopted` is a one-way latch from the FIRST adoption and does
   * not turn back off for a "select a different sole trader" re-signup — a
   * genuinely new decision this flag alone can't tell apart from "already
   * settled".
   *
   * @returns {boolean}
   */
  isDeciding: function () {
    return (
      twoincSoleTrader.isBusy() &&
      (!twoincSoleTrader.soleTraderAdopted || twoincSoleTrader.soleTraderReconfirmingCount > 0)
    );
  },

  /**
   * Switch mode and toggle the company-search suppression. No token/buyer
   * work happens here — that is owned by the email-driven prefetch and the
   * chip-click handler.
   */
  setMode: function (mode) {
    // Only an actual TRANSITION resets adoption/reconfirmation state
    // (round-6 review — Han/Vader): `applyPrefetch`'s match branch calls
    // `setMode("sole_trader")` unconditionally whenever a flight resolves
    // with a match — including while mode is ALREADY `sole_trader`, e.g. the
    // buyer edits `#billing_email` (never locked, unlike the captured
    // fields) while a "select a different sole trader" popup is genuinely
    // still open. Resetting on that redundant same-mode call zeroed the
    // re-signup's own `soleTraderReconfirmingCount` mid-flight — the exact
    // bug rounds 4/5 fixed via the link's click handler, reopened here via a
    // completely different path neither of them touched.
    const isTransition = mode !== twoincSoleTrader.mode;
    twoincSoleTrader.mode = mode;
    if (isTransition) {
      // Every REAL switch starts a fresh determination of whether THIS time
      // through sole-trader mode ends in an adopted company (TWO-40 §7
      // correction, round-1 review — Vader) — see the flag's own comment.
      twoincSoleTrader.soleTraderAdopted = false;
      // Same reset, for the same reason (round-4 review — Han/Vader): a REAL
      // switch away from (or back into) sole-trader mode means whatever
      // re-signup(s) it interrupted have nothing left to reconfirm.
      twoincSoleTrader.soleTraderReconfirmingCount = 0;
    }
    twoincSoleTrader.updateChips();
    twoincSoleTrader.syncDifferentSoleTraderLink();
    // BEFORE the branch below, so a chip click made while the dropdown is
    // already open hides the query row in the click's own gesture (Doug
    // 2026-08-20: it used to take effect only on the next open, because
    // nothing re-synced on a mode write and the `select2:open` handler was
    // the only caller). The business branch destroys this dropdown a few
    // lines down, so the restore has to happen while the row still exists.
    twoincSelectWooHelper.syncSoleTraderSurfaces();

    if (mode === "sole_trader") {
      // Sole trader is its own company-capture mode, not manual entry and not
      // an ordinary registry pick — it renders through the picker but carries a
      // synthetic id, so neither of the other two modes' surfaces is right for
      // it. Snapshotted first so it can be put back on the way out, in case
      // the buyer really was mid manual entry.
      if (twoincSoleTrader.savedCaptureMode === null) {
        twoincSoleTrader.savedCaptureMode = twoincCompanyCapture.mode;
      }
      twoincCompanyCapture.mode = "sole_trader";
      // The search widget itself, and the swap to the plain captured fields,
      // are deliberately NOT done here (TWO-40 §7 correction, live-reported
      // by Doug). Tearing them down the instant the mode switches — as this
      // used to, unconditionally — destroys the dropdown before the autofill
      // round trip (or the signup popup it can lead to) has had a chance to
      // run, which is exactly the window `beginFlight()`'s own comment says
      // the dropdown+spinner are supposed to survive. `lockCapturedFields()`
      // does this instead, once `setCompany()` actually has a company to
      // show — the only moment there is nothing left to search for.
    } else {
      twoincSoleTrader.leaveSoleTraderMode();
      const $display = jQuery("#billing_company_display");
      if ($display.data("select2")) {
        // Alive on every switch back to business now (TWO-40 §7 direction
        // (a)): `lockCapturedFields()` stopped destroying it on adoption, so
        // this is no longer only the pre-adoption edge case (the buyer
        // abandons the popup, or types a non-matching email while
        // sole-trader mode is still waiting on a flight) — it is the ONE
        // teardown this whole switch does, covering both. Destroy it here so
        // `enableCompanySearch()` below does not re-initialise an
        // already-live widget. close() before destroy() — same fix, same
        // reason, as enterManualCompanyEntry (#30.x.13): destroy() alone on
        // an open widget skips selectWoo's own close cleanup.
        $display.select2("close");
        $display.select2("destroy");
      }
      twoincSoleTrader.setCompany("", "");
      twoincDomHelper.toggleBusinessFields();
      Twoinc.getInstance().enableCompanySearch();
      // The buyer may have been in MANUAL entry when they switched to sole
      // trader, in which case the mode restored above is `manual` and
      // enableCompanySearch has just early-returned. Without this the link
      // back to search stays hidden and business mode has no route back to
      // the picker at all (TWO-25288).
      //
      // The capture mode answers this directly. The pair of flags it replaces
      // (#486) could not: `enable_company_search !== "yes"` was also the
      // merchant's own stable "search lives in the payment tile" configuration,
      // so a buyer reachable via `onEmailChanged`'s automatic sole-trader detour
      // on such a merchant saw this button, and clicking it flipped that admin
      // setting to "yes" for the rest of the session (bug found in adversarial
      // review, TWO-25326 correction, 2026-08-04 — Han).
      if (twoincCompanyCapture.mode === "manual") {
        twoincSelectWooHelper.getSearchCompanyBtnNode().show();
      }
    }
  },

  /**
   * The state/DOM bookkeeping every real exit from sole-trader mode needs,
   * regardless of what happens to the search widget on the way out (TWO-40
   * §7 direction (a)): `setMode`'s own business branch tears the widget down
   * and lands the buyer in a fresh one — see its own comment — but a pick
   * made directly off the STILL-LIVE widget (the `select2:select` handler's
   * `mode === "sole_trader"` branch, once the widget shows an adopted sole
   * trader as its own selection rather than being hidden behind the native
   * fields) must not also go through that teardown: the widget already
   * shows the pick the buyer just made, and destroying/rebuilding it here
   * would blank that pick right back out before `write()` ever runs. Split
   * out so both paths share identical "leaving" semantics — readonly
   * unlock, the note, the capture mode the buyer was in before restored —
   * rather than drifting out of sync with each other the way this file's
   * history warns against.
   *
   * @returns {void}
   */
  leaveSoleTraderMode: function () {
    twoincSoleTrader.showNote(false);
    jQuery("#billing_company, #company_id").prop("readonly", false);
    if (twoincSoleTrader.savedCaptureMode !== null) {
      twoincCompanyCapture.mode = twoincSoleTrader.savedCaptureMode;
      twoincSoleTrader.savedCaptureMode = null;
    }
    // A popup-close poll left over from a resolved adoption/re-signup keeps
    // `isBusy()` (and therefore `isDeciding()`) true purely on its own
    // 300ms cadence — this call is the one place every caller has already
    // committed to leaving sole-trader mode, so whatever that poll was
    // still going to decide (settle the flight, decrement
    // `soleTraderReconfirmingCount`, maybe revert to business) is moot.
    // Left running, it raced `activateManualEntry()`'s deferred
    // `enterManualCompanyEntry()` call: `setMode("business")` resets
    // `soleTraderAdopted` right above (transition bookkeeping), which
    // un-neutralises the stale `isBusy()` for `isDeciding()`'s very next
    // read — wrongly refusing the manual-entry switch this function's own
    // caller had already decided on, and leaving the search widget showing
    // instead (live-reported by Doug, TWO-40 §7 correction). The popup
    // WINDOWS and the autofill lookup are moot for the same reason, and go
    // with it in one operation — see `abandonSoleTraderFlow()`.
    twoincSoleTrader.abandonSoleTraderFlow();
  },

  /**
   * Give up on everything the sole-trader flow still has outstanding, as ONE
   * operation: the popup windows, the records tracking them, and the autofill
   * lookup whose only possible outcome is to put the buyer back into
   * sole-trader mode (Doug 2026-08-20, ported from the two PrestaShop bugs of
   * this shape — TWO-40 §14).
   *
   * Called only from `leaveSoleTraderMode()`, the single point every exit from
   * sole-trader mode already funnels through, precisely so "close the popup"
   * and "cancel the lookup" cannot drift into two separate things each exit
   * site has to remember to do together, in the right order, every time.
   *
   * Closing comes BEFORE dropping the records, because the records hold the
   * only handles there are: a close attempted after them has nothing left to
   * close, and the window stays on screen with nothing tracking it — which is
   * how the next chip click opens a SECOND popup over the first. Every tracked
   * window is closed, not just the undecided ones `closeAbandonedPopups()`
   * acts on: a decided popup is spared there so a retry inside it can post a
   * second ACCEPTED, and mode has left `sole_trader` by the time this runs, so
   * the message listener drops that ACCEPTED anyway — sparing the window would
   * leave exactly the orphan above.
   *
   * The lookup is invalidated by a `prefetchSeq` bump, the same supersession
   * the newer-flight case already uses (see that counter's own comment), so
   * `applyPrefetch` needs no second predicate. Without it, a match landing
   * after the buyer left re-entered sole-trader mode and re-adopted behind
   * them — overwriting what they had done since and running the credit check
   * against the identity they had just walked away from.
   *
   * @returns {void}
   */
  abandonSoleTraderFlow: function () {
    twoincSoleTrader.activePopupWatchers.forEach(function (watcher) {
      if (watcher.win.closed || typeof watcher.win.close !== "function") return;
      watcher.win.close();
    });
    twoincSoleTrader.stopAllPopupWatchers();
    twoincSoleTrader.prefetchSeq += 1;
    // A chip decision deferred onto a flight this has just invalidated can
    // never be served by it — `onModeChipClick` starts a fresh flight for a
    // re-click instead, see its own `startedPrefetchSeq` check.
    twoincSoleTrader.pendingChipDecisionEmail = null;
  },

  /**
   * Close the company-search widget (left alive, not destroyed — TWO-40 §7
   * direction (a): a sole trader, once adopted, is meant to look like a
   * registered company that was just searched and picked, the same way
   * PrestaShop's `adoptSoleTraderBuyer()` never destroys its own search
   * field) and lock the captured fields, once a sole trader is actually
   * adopted. Split out of `setMode()` — see its comment — so switching mode
   * alone leaves the dropdown and its spinner alone; this is the only moment
   * there is nothing left to search for.
   *
   * Not destroyed (TWO-40 §7 direction (a), PR 1 of 2): `reopenSearch()` used
   * to rebuild the widget from scratch via `attach()` every time it left
   * sole-trader mode, going through a destroy-then-reinit round trip that
   * every OTHER re-attach path in this file (the 800ms retry,
   * `exitManualCompanyEntry`, this same switch-back-to-search) already
   * relies on `attach()` itself to do safely (see its own doc comment) —
   * leaving the live instance in place here removes one extra, redundant
   * destroy/rebuild from the most fragile path in the file. Any fragment
   * replace that discards the underlying `<select>` without ever calling
   * destroy is still covered by `attach()`'s own orphan sweep
   * (`sweepOrphanedDropdown`, TWO-25469) regardless of which path left the
   * widget referenceless, so this is not a new failure mode, just one fewer
   * teardown in the sequence.
   *
   * Seeds the widget's own underlying `<select>` with an option for the
   * adopted sole trader and selects it (TWO-40 §7 direction (a)), the same
   * synthetic-`<option>` mechanism `loadUserMetaInputs()` already uses to
   * restore a returning buyer's pick before select2 ever attaches — so the
   * widget's rendered selection reads "A Sole Trader" exactly the way it
   * would read a registered pick's name, rather than the buyer seeing an
   * adopted sole trader only in the readonly native field. It is also what
   * `getCompanyName()` reads in this mode (#486), so seeding it is what lets an
   * order intent fire for an adopted sole trader at all. On a merchant whose
   * setting puts the control in the payment tile the seeded selection simply
   * renders there instead — the control is never off, only relocated.
   *
   * `.trigger("change")`, not `select2:select` — this is select2's own
   * documented mechanism for a PROGRAMMATIC selection to update its
   * rendered display, and deliberately does not fire `select2:select`
   * itself, so it does not re-enter that handler's own write path
   * (`setCompany()`, right above this call, already is that write).
   *
   * @param {string} companyId
   * @param {string} companyName
   * @returns {void}
   */
  lockCapturedFields: function (companyId, companyName) {
    const $display = jQuery("#billing_company_display");
    if ($display.data("select2")) {
      $display.select2("close");
    } else if ($display.length) {
      // Attached BEFORE the seed below, so that seed's own closing
      // `.trigger("change")` is what renders the selection (defect found
      // reviewing #486 as a whole):
      // manual entry destroys this widget (`enterManualCompanyEntry`), and
      // `applyPrefetch()`'s match branch then adopts a sole trader with no
      // guard in that direction — the email field is never locked, so
      // correcting an email while in manual entry is enough. Adoption's own
      // `toggleBusinessFields()` makes `#billing_company_display_field` the
      // visible company-NAME surface for this mode and hides the native field,
      // and `getCompanyName()` reads the picker's rendered container: with no
      // picker attached the buyer got a bare unstyled `<select>` and the name
      // read EMPTY, so `getCompanyData()` carried no `company_name` and
      // `isReadyApprovalCheck()` never fired an order intent at all — the exact
      // defect `getCompanyName()`'s own comment describes, reached by a route
      // neither the capture-mode refactor nor the field-visibility redesign
      // owns alone.
      //
      // The duplicated `select2:select`/`select2:open` handlers this leaves
      // behind are the pre-existing ones TWO-25338 owns (see `initialize()`'s
      // 800ms retry comment for the full accounting); this handler's own
      // sole-trader branch is idempotent under it — the second entry finds
      // `mode === "business"` and skips.
      twoincSelectWooHelper.attach(Twoinc.getInstance());
    }
    if (
      !$display.find("option").filter(function () {
        return this.value === companyId;
      }).length
    ) {
      $display.prepend(jQuery("<option></option>").val(companyId).text(companyName));
    }
    $display.val(companyId).trigger("change");

    // Only the link back to search: the manual-entry row lives inside the
    // dropdown, which stays alive but hidden behind the captured fields
    // rather than going with a destroyed widget (TWO-25288).
    jQuery("#" + twoincSelectWooHelper.searchCompanyBtnId).hide();
    jQuery("#billing_company, #company_id").prop("readonly", true);
  },

  /**
   * Click-to-reopen (TWO-40 §7 correction, live-reported by Doug): once a
   * sole trader is adopted, `lockCapturedFields()` readonly-locks the
   * captured fields, and the dropdown's own free-text query row is suppressed
   * (`syncQueryFieldSuppression`), leaving no way back to an ordinary company
   * search except the "select a different sole trader"
   * link — which only ever leads back into the SAME hosted signup, never
   * away from sole trader entirely. Clicking into either captured field does
   * that instead: revert to business mode (restoring whatever search/
   * manual-entry state was saved) and land the buyer straight in the
   * reopened dropdown, the same landing `exitManualCompanyEntry()` gives a
   * buyer leaving manual entry.
   *
   * Refused while `isDeciding()` (round-1 review — Han/Vader; predicate
   * corrected round-3 — Vader): a captured field only readonly-locks once
   * `lockCapturedFields()` runs, which is deferred for the whole autofill/
   * popup wait (see `setMode`'s comment) — reverting mode out from under
   * that wait is what dropped a completed signup on the floor, because
   * `bindPopupMessageListener`'s ACCEPTED handler also gates on
   * `mode === "sole_trader"`. Not the wider `isBusy()`: once adopted, this
   * is exactly the state Doug's bug 3 describes ("once a sole trader is
   * selected... click into the field again") — refusing the click just
   * because the popup-close poll hasn't caught up yet would silently
   * reintroduce that bug for the whole length of the poll.
   *
   * @returns {void}
   */
  reopenSearch: function () {
    if (twoincSoleTrader.mode !== "sole_trader" || twoincSoleTrader.isDeciding()) return;
    twoincSoleTrader.setMode("business");
    if (
      !twoincSelectWooHelper.openCompanySearchDropdown() &&
      !twoincSelectWooHelper.focusVisibleCompanyField(
        "#billing_company_display_field .select2-selection"
      )
    ) {
      twoincSelectWooHelper.focusVisibleCompanyField("#billing_company_display");
    }
  },

  /**
   * Prefetch the autofill buyer for the entered email. Runs on every email
   * change so the chip click can resolve synchronously. Mints tokens (needed
   * for the signup popup) then reads the buyer on the Two cookie; a match is
   * when that buyer owns the email currently typed at checkout.
   */
  onEmailChanged: function () {
    if (!twoincSoleTrader.isAvailable()) {
      // No flight is starting FROM THIS CALL, so nothing this call does will
      // ever consume a pending chip decision (round-1 review — Vader): a
      // country change can leave availability false right as
      // `onModeChipClick`'s own call lands here. Only dropped when nothing
      // else is outstanding either (round-2 review — Han): an ALREADY
      // in-flight request for the same email is still the intended consumer,
      // and this early return must not pull the decision out from under it.
      if (twoincSoleTrader.flightDepth === 0) {
        twoincSoleTrader.pendingChipDecisionEmail = null;
      }
      return;
    }
    const email = twoincSoleTrader.enteredEmail();
    // Dedupe repeated checkout re-renders firing for an unchanged email.
    if (email === twoincSoleTrader.lastPrefetchEmail) {
      // Same reasoning as the `isAvailable()` guard above (round-2 review —
      // Han): WooCommerce fires this redundantly for an unchanged email, and
      // a redundant call landing WHILE the real flight for this same email is
      // still outstanding must not clear the decision that flight's own
      // `applyPrefetch()` is about to serve.
      if (twoincSoleTrader.flightDepth === 0) {
        twoincSoleTrader.pendingChipDecisionEmail = null;
      }
      return;
    }
    twoincSoleTrader.lastPrefetchEmail = email;
    twoincSoleTrader.prefetched = { ready: false, buyer: null, matches: false };
    if (!email) {
      // No email to match → cannot be a known sole trader; leave business.
      twoincSoleTrader.pendingChipDecisionEmail = null;
      // Refused while `isBusy()` (round-2 review — Han/Vader), same as
      // `hide()` just above — a flight or popup for the email the buyer just
      // cleared may still be outstanding, and its own terminal branch is
      // what settles mode once it actually resolves.
      if (twoincSoleTrader.mode === "sole_trader" && !twoincSoleTrader.isBusy()) {
        twoincSoleTrader.setMode("business");
      }
      return;
    }
    // One flight for the whole token-mint + buyer-lookup round trip, settled
    // on EVERY terminal branch below (TWO-40 §7). Stamped with the CURRENT
    // seq before starting (round-3 review — Vader) — see `prefetchSeq`'s own
    // comment — so `applyPrefetch` can tell whether this is still the
    // latest flight by the time it settles.
    const seq = ++twoincSoleTrader.prefetchSeq;
    twoincSoleTrader.startedPrefetchSeq = seq;
    twoincSoleTrader.beginFlight();
    twoincSoleTrader.fetchTokens(function (ok) {
      if (!ok) {
        twoincSoleTrader.prefetched = { ready: true, buyer: null, matches: false };
        twoincSoleTrader.settleFlight();
        twoincSoleTrader.applyPrefetch(seq);
        return;
      }
      twoincSoleTrader.fetchCurrentBuyer(function (buyer) {
        twoincSoleTrader.prefetched = {
          ready: true,
          buyer: buyer,
          matches: twoincSoleTrader.buyerOwnsCheckoutEmail(buyer)
        };
        twoincSoleTrader.settleFlight();
        twoincSoleTrader.applyPrefetch(seq);
      });
    });
  },

  /**
   * Does the buyer on the Two cookie own the email currently typed at
   * checkout?
   *
   * A PASSIVE, pre-authentication check, and correct only there: nothing has
   * proved who the browser belongs to yet, so the cookie's buyer is trusted
   * only as far as it agrees with what the buyer has typed.
   *
   * It must NOT be reused on a post-authentication path (TWO-40 §8) — see
   * `bindPopupMessageListener`.
   *
   * @param {Object|null} buyer
   * @returns {boolean}
   */
  buyerOwnsCheckoutEmail: function (buyer) {
    const entered = twoincSoleTrader.enteredEmail().toLowerCase();
    return !!(buyer && buyer.email && String(buyer.email).toLowerCase() === entered);
  },

  /**
   * React to a resolved prefetch: a matching buyer auto-selects Sole trader
   * and prefills the company; a non-match reverts an active Sole-trader
   * selection back to Registered business (re-clicking then starts signup).
   *
   * @param {number} [seq] this flight's `prefetchSeq` snapshot, from
   *   `onEmailChanged` — see that flag's own comment. Omitted only by direct
   *   test calls; every real caller passes it.
   */
  applyPrefetch: function (seq) {
    if (seq !== undefined && seq !== twoincSoleTrader.prefetchSeq) {
      // Superseded by a newer flight for a different email (round-3 review
      // — Vader): a second flight can start and settle entirely before this
      // one's stale response lands (see `prefetchSeq`'s own comment for why
      // `flightDepth` alone can't tell). Acting on it now — either branch,
      // match or revert — would stomp whatever the newer flight already
      // decided.
      return;
    }
    const pf = twoincSoleTrader.prefetched;
    // Keyed on the CURRENTLY entered email, not just "was something
    // pending" (round-1 review — Han/Vader) — see the flag's own comment for
    // why a bare boolean gets consumed by whichever flight settles first.
    const pendingEmail = twoincSoleTrader.pendingChipDecisionEmail;
    const hadPendingClick =
      pendingEmail !== null && pendingEmail === twoincSoleTrader.enteredEmail();
    twoincSoleTrader.pendingChipDecisionEmail = null;
    // `isAvailable()` too (round-1 review — Vader): a country change can
    // call `hide()` — which reverts mode to business synchronously — while
    // this flight is still in flight for the country the buyer just left.
    // Without this, a match landing after that would force sole-trader mode
    // back on for a country it is no longer offered in.
    if (pf.matches && pf.buyer && twoincSoleTrader.isAvailable()) {
      twoincSoleTrader.setMode("sole_trader");
      twoincSoleTrader.setCompany(pf.buyer.organization_number, pf.buyer.company_name, pf.buyer);
      twoincSoleTrader.showNote(false);
    } else if (hadPendingClick && twoincSoleTrader.mode === "sole_trader") {
      // The buyer explicitly asked for sole trader (TWO-40 §7 correction) and
      // the autofill this settles just came back with no match — open the
      // popup now, the moment the wait `onModeChipClick` deferred is over,
      // rather than reflexively at click time.
      twoincSoleTrader.launchSignup();
    } else if (
      twoincSoleTrader.mode === "sole_trader" &&
      !twoincSoleTrader.isBusy() &&
      !twoincSoleTrader.soleTraderAdopted
    ) {
      // `isBusy()` too (round-3 review — Vader): `flightDepth` is a COUNT
      // specifically because a second flight for a newer email can start
      // before an earlier one settles (see its own doc comment). Without
      // this, a stale flight for an email the buyer has since moved on from
      // — one that settles AFTER a second, later flight already matched and
      // adopted a company — reverted that just-adopted state to business,
      // tearing the widget back down under it. The later flight's own
      // settle (or an open popup's own close) is what's actually authoritative
      // here, so deferring loses nothing.
      //
      // `!soleTraderAdopted` too (live-reported by Doug, item 2): a buyer
      // who is ALREADY adopted can still edit `#billing_email` — it is
      // deliberately never locked, unlike the captured fields — and that
      // re-fires this same flight for the new address. A non-match there is
      // not "abandon sole trader", it is "the autofill cookie disagrees
      // with an already-settled adoption"; the one-way latch is the
      // authority once set, same as `isDeciding()` already treats it.
      twoincSoleTrader.setMode("business");
    }
    // Re-synced unconditionally, even on the branch above that changes
    // nothing else (live-reported by Doug, item 2): tokens are minted by
    // THIS SAME flight (`onEmailChanged`'s `fetchTokens` call), so a sole
    // trader already adopted BEFORE this flight ever ran — restored from a
    // previous order by `loadUserMetaInputs()`, which has no tokens yet at
    // that early point — only has a real `tokens` value to show the link
    // against once a flight like this one actually settles. `setCompany()`
    // already does this on the match branch above; this covers the other
    // two, where nothing else in this function touches the link.
    twoincSoleTrader.syncDifferentSoleTraderLink();
  },

  /**
   * Open the hosted signup popup, falling back to the visible link if the
   * browser blocks the window (e.g. gesture lost after a slow prefetch).
   *
   * Re-entrancy-guarded (TWO-40 §7): a second activation while one is already
   * being opened is dropped rather than stacking a second popup. A second,
   * LATER activation is likewise dropped for as long as an already-open
   * popup's outcome is still undecided — see the guard's own comment for why
   * that predicate is popup-scoped rather than `isDeciding()`.
   *
   * A re-signup (`options.autoselect === false`) is ALSO refused while a
   * different one is already outstanding (round-6 review — Han/Vader,
   * structural hardening): `openingSignup` only guards a second click
   * landing in the SAME synchronous gesture, not a later, sequential one —
   * closing one re-signup popup and clicking "select a different sole
   * trader" again is exactly the retry that made
   * `soleTraderReconfirmingCount` a count rather than a boolean in the first
   * place. Refusing a second one here removes that whole scenario rather
   * than continuing to patch the counter for it.
   *
   * @param {Object} [options] passed through to openPopup
   * @returns {void}
   */
  launchSignup: function (options) {
    if (twoincSoleTrader.openingSignup) return;
    // One LIVE undecided popup at a time: `openingSignup` above only makes
    // two activations in the SAME gesture idempotent, so a second, later click
    // while the first popup was still open stacked a second window over it.
    // LIVE is load-bearing — a hand-closed record stays undecided until its
    // own poll notices, and this guard deliberately lets a relaunch open
    // alongside it, so "undecided" alone is NOT an array-wide invariant. Read
    // as one, it mis-attributes an inbound ACCEPTED; see `findPopupWatcher`.
    // Scoped to each open popup's OWN outcome (`watcher.decided`, plus the
    // ACCEPTED fetch still resolving), deliberately narrower than either
    // obvious predicate: a bare watcher count refuses the "select a
    // different sole trader" launch from an accepted popup's remaining
    // close poll (that popup has already decided), and the flight-inclusive
    // `isDeciding()` refuses a launch when NO popup exists and only a stale
    // prefetch flight is outstanding — stranding the chip click with
    // neither populate nor popup, the exact defect TWO-40 §7 removes. Not
    // the global `soleTraderAdopted` either: an autofill prefetch matching
    // while a first-time popup is still open sets it, and that popup is
    // still undecided. A browser-blocked popup creates no watcher, so
    // retries stay open.
    if (
      twoincSoleTrader.signupConfirming ||
      twoincSoleTrader.activePopupWatchers.some(function (watcher) {
        // `win.closed` too: a record outlives its window by up to one 300ms
        // poll cycle, and a hand-closed popup is not an undecided one — the
        // buyer already decided against it, so a fresh click must get a
        // fresh popup, not a refusal.
        return !watcher.decided && !watcher.win.closed;
      })
    ) {
      return;
    }
    if (
      options &&
      options.autoselect === false &&
      twoincSoleTrader.soleTraderReconfirmingCount > 0
    ) {
      return;
    }
    twoincSoleTrader.openingSignup = true;
    try {
      const win = twoincSoleTrader.openPopup(options);
      twoincSoleTrader.showNote(!win);
      if (win) {
        // Both callers passing `autoselect: false` — the "select a
        // different sole trader" link, and (item 4.3, Doug's override) a
        // re-click of the Sole Trader chip once already adopted — are a
        // genuinely new decision, launched from an already-adopted state
        // where `soleTraderAdopted` is stale-true for the whole duration.
        // See `soleTraderReconfirmingCount`'s own comment for why
        // `isDeciding()` needs this to tell the two apart.
        //
        // Incremented only once a popup has actually opened (round-5 review
        // — Han/Vader): a BLOCKED re-signup popup calls neither
        // `watchPopupClose` nor the ACCEPTED handler, so incrementing
        // unconditionally at the top of this function — as this used to —
        // stranded the count above zero until the next unrelated
        // `setMode()` call reset it, wrongly refusing every direct "leave
        // sole-trader mode" action in the meantime.
        const isReconfirming = !!(options && options.autoselect === false);
        if (isReconfirming) {
          twoincSoleTrader.soleTraderReconfirmingCount += 1;
        }
        // Both entry points, and the first-time enrolment too: the close is
        // conditional on the dropdown actually being open, which is the one
        // thing that differs between them.
        twoincSoleTrader.closeDropdownOnSettle = true;
        twoincSoleTrader.watchPopupClose(win, isReconfirming);
      }
    } finally {
      // Released once the synchronous open has returned, blocked or not — see
      // the guard's own comment. Held any longer and a blocked popup would
      // lock the buyer out of retrying via the fallback link.
      twoincSoleTrader.openingSignup = false;
    }
  },

  /**
   * Keep the search dropdown's spinner up for as long as the signup popup is
   * open, and settle it the moment the buyer closes the window (TWO-40 §7
   * correction, live-reported by Doug: the dropdown used to vanish the
   * instant the popup opened, whether or not autofill had found anything).
   *
   * `window.closed` polling is the only signal a same-origin opener has for
   * "the popup went away" with no cooperation from the popup itself — there
   * is no event for it. If nothing was ever adopted by the time it closes
   * (the buyer backed out without finishing signup), hand the checkout back
   * to an ordinary company search rather than leaving it stuck mid-switch.
   *
   * Reads `soleTraderAdopted`, not `#company_id`'s raw value (round-1 review
   * — Vader): that field can already hold an unrelated id from an earlier
   * manual entry or registry pick, predating this sole-trader session
   * entirely, which would wrongly read as "already adopted" and suppress
   * the revert. Also skips the revert while `signupConfirming` is true
   * (round-1 review — Han): the ACCEPTED-postMessage handler's own
   * `fetchCurrentBuyer()` can still be resolving when this poll notices the
   * window closed — the popup can go away the instant "ACCEPTED" is posted,
   * before that fetch has had a chance to write anything — and that handler
   * is the sole authority once a signup has actually completed.
   *
   * @param {Window} win the popup returned by `window.open`
   * @param {boolean} [isReconfirming] whether THIS popup was a "select a
   *   different sole trader" re-signup — round-5 review (Han/Vader): only
   *   decrement `soleTraderReconfirmingCount` for the popup that actually
   *   incremented it. A bare "decrement on every close" would let an
   *   unrelated popup's poll steal a decrement meant for a DIFFERENT,
   *   still-open re-signup — the exact cross-contamination the counter
   *   exists to avoid (same shape as `flightDepth`'s own COUNT-not-boolean
   *   reasoning, one level deeper).
   * @returns {void}
   */
  watchPopupClose: function (win, isReconfirming) {
    twoincSoleTrader.bindWindowRefocusListener();
    twoincSoleTrader.beginFlight();
    const watcher = { id: null, win: win, isReconfirming: !!isReconfirming, decided: false };
    watcher.id = setInterval(function () {
      if (!win.closed) return;
      twoincSoleTrader.settleClosedPopup(watcher, false);
    }, 300);
    twoincSoleTrader.activePopupWatchers.push(watcher);
  },

  /**
   * Everything one popup's window going away settles. Called by that popup's
   * own poll above, and — only on the mode-chip abandon path — synchronously
   * by `abandonPopupsForChipClick()`.
   *
   * Factored out rather than duplicated so the settle keeps ONE owner
   * (TWO-40 §14) with no second copy to agree with this one about
   * `flightDepth`, `soleTraderReconfirmingCount` and `closeDropdownOnSettle`.
   * Calling it early is safe because `stopWatchingPopup` both clears the
   * interval and drops the record, so the poll cannot run it a second time.
   *
   * @param {Object} watcher the record whose window has gone
   * @param {boolean} chipOwnsOutcome a mode-chip click is mid-gesture and owns
   *   the mode and the dropdown from here — see `abandonPopupsForChipClick`
   * @returns {void}
   */
  settleClosedPopup: function (watcher, chipOwnsOutcome) {
    twoincSoleTrader.stopWatchingPopup(watcher.id);
    if (chipOwnsOutcome) {
      // Consumed, not honoured: the chip decides what happens to the dropdown
      // (Registered company reopens it, Enter manually tears it down), and
      // closing it from here would destroy the very button whose `click` has
      // not been dispatched yet — a chip removed between `mousedown` and
      // `mouseup` produces no `click` at all.
      twoincSoleTrader.closeDropdownOnSettle = false;
    }
    twoincSoleTrader.settleFlight();
    if (watcher.isReconfirming && !watcher.decided) {
      // Abandoned without a decision — this settle owns the decrement. A
      // DECIDED popup's decrement belongs to the ACCEPTED handler that
      // marked it: an accepted re-signup closed inside this poll's own
      // 300ms window would otherwise spend two decrements against its one
      // increment, letting a later, genuinely undecided re-signup read as
      // settled. Clamped, same reason `settleFlight` is, so an unbalanced
      // count can't go negative.
      twoincSoleTrader.soleTraderReconfirmingCount = Math.max(
        0,
        twoincSoleTrader.soleTraderReconfirmingCount - 1
      );
    }
    if (
      // Skipped on the chip path for the same reason as the dropdown close
      // above, plus one more: `setMode`'s business branch destroys the
      // dropdown the chip lives in, AND reverting to business here would make
      // the Registered company chip's own "already in business mode" no-op
      // swallow the click. Both chips set the mode themselves.
      !chipOwnsOutcome &&
      twoincSoleTrader.mode === "sole_trader" &&
      !twoincSoleTrader.soleTraderAdopted &&
      !twoincSoleTrader.signupConfirming &&
      // A popup relaunched inside this poll's stale window (the buyer
      // closed this one by hand, then clicked again before the poll
      // noticed) owns the mode now — reverting under it would drop its
      // eventual ACCEPTED on the `mode !== "sole_trader"` gate. Its own
      // terminal branch settles mode, same deferral as `hide()`'s.
      //
      // Still ON SCREEN is the question, not still undecided (round-3
      // review): a popup whose ACCEPTED resolved to no buyer is decided yet
      // very much still open, and the buyer's retry inside it posts a second
      // ACCEPTED that a revert here would drop on that same gate. Any record
      // whose window HAS closed settles the mode from its own poll instead.
      !twoincSoleTrader.activePopupWatchers.some(function (other) {
        return !other.win.closed;
      })
    ) {
      twoincSoleTrader.setMode("business");
    }
  },

  /**
   * Close an abandoned signup popup when the buyer comes back to the checkout
   * (Doug 2026-08-20, live: the popup stayed up, the dropdown stayed open and
   * the spinner kept animating over a flow the buyer had walked away from).
   *
   * A window `focus` listener, NOT `visibilitychange`: the hosted signup is a
   * separate WINDOW, so the checkout's own tab never leaves `visible` for the
   * whole round trip and that event never fires. Bound lazily from
   * `watchPopupClose` — the only thing that creates the state this acts on —
   * and left bound for the window's lifetime, same as the `message` listener.
   *
   * The target check is not defensive noise. A native `focus` on an element
   * never reaches a non-capturing window listener, but jQuery's
   * `.trigger("focus")` does not dispatch natively — it walks the propagation
   * path itself, window included, regardless of the event type's `bubbles`
   * flag. This file triggers focus that way on the company fields all over
   * (`focusVisibleCompanyField`, `releaseFocusFromCompanyField`), so without
   * the check, opening the dropdown would close the popup.
   *
   * The refocus does not decide anything itself, it only SCHEDULES the abandon
   * (Doug 2026-08-20, spec revision). Which of three things the buyer meant
   * depends on what they clicked, and the window `focus` is dispatched before
   * the `mousedown` of that click — so the decision has to outlive the focus
   * handler by `refocusChipGraceMs`, and the capture-phase `mousedown` below is
   * what resolves it:
   *
   *  - the Sole trader chip → cancel the abandon outright. Re-clicking the chip
   *    that launched the popup asks for that popup BACK, and `onModeChipClick`
   *    raises it. Cancelling here is the whole job; the click owns the rest.
   *  - any other mode chip → abandon NOW, in the mousedown, so the chip's own
   *    `click` handler runs a moment later against fully settled state. Left to
   *    the timer instead it would land after that click, and the chip's
   *    `isDeciding()` guard would have refused the click for a popup that was
   *    already on its way out — the gesture reading as "the dropdown just
   *    closed" with the chip's own action never happening.
   *  - anything else, including no click at all (alt-tab back, a click on the
   *    page) → the timer fires and abandons, as it always did.
   *
   * Capture phase, and on `document` rather than on the chips: the chips are
   * rebuilt on every dropdown open, and capture reaches them whether or not
   * something between them and here stops propagation.
   *
   * @returns {void}
   */
  bindWindowRefocusListener: function () {
    if (twoincSoleTrader.refocusHandler) return;
    twoincSoleTrader.refocusHandler = function (event) {
      if (event && event.target && event.target !== window && event.target !== document) return;
      // Coalesced onto the FIRST focus, never rescheduled onto a later one.
      // The grace belongs to the gesture that brought the buyer back, and
      // window-targeted `focus` events arrive in bursts for reasons that are
      // not that gesture — blurring an element fires one, so select2 closing
      // its own dropdown produces a stream of them. Restarting the clock on
      // each would let a busy panel postpone the abandon indefinitely.
      if (twoincSoleTrader.refocusAbandonTimer !== null) return;
      twoincSoleTrader.refocusAbandonTimer = setTimeout(function () {
        twoincSoleTrader.refocusAbandonTimer = null;
        twoincSoleTrader.closeAbandonedPopups();
      }, twoincSoleTrader.refocusChipGraceMs);
    };
    window.addEventListener("focus", twoincSoleTrader.refocusHandler);

    twoincSoleTrader.chipMousedownHandler = function (event) {
      // Only a mousedown that a still-undecided refocus is waiting on can be
      // the click that CAUSED that refocus. Every other chip click — the
      // checkout already had focus — is left entirely alone, popup included.
      if (twoincSoleTrader.refocusAbandonTimer === null) return;
      const target = event && event.target;
      const chip =
        target && typeof target.closest === "function"
          ? target.closest("." + twoincSelectWooHelper.modeChipClass)
          : null;
      if (!chip) return;
      clearTimeout(twoincSoleTrader.refocusAbandonTimer);
      twoincSoleTrader.refocusAbandonTimer = null;
      if (chip.getAttribute("data-mode") === "sole_trader") return;
      twoincSoleTrader.abandonPopupsForChipClick();
    };
    document.addEventListener("mousedown", twoincSoleTrader.chipMousedownHandler, true);
  },

  /** Test seam / teardown: drop the window `focus` listener, the mousedown
   * listener that resolves it, and any abandon still scheduled.
   * @returns {void}
   */
  unbindWindowRefocusListener: function () {
    clearTimeout(twoincSoleTrader.refocusAbandonTimer);
    twoincSoleTrader.refocusAbandonTimer = null;
    if (twoincSoleTrader.chipMousedownHandler) {
      document.removeEventListener("mousedown", twoincSoleTrader.chipMousedownHandler, true);
      twoincSoleTrader.chipMousedownHandler = null;
    }
    if (!twoincSoleTrader.refocusHandler) return;
    window.removeEventListener("focus", twoincSoleTrader.refocusHandler);
    twoincSoleTrader.refocusHandler = null;
  },

  /**
   * Close every signup popup whose outcome is still open, and nothing else
   * (Doug 2026-08-20).
   *
   * `window.close()` on a handle this page's own `window.open()` returned is
   * permitted regardless of the popup's origin — the opener may always close
   * what it opened — which is why this can be a real close rather than a
   * request the hosted flow has to cooperate with.
   *
   * Closing the window is the WHOLE action. The spinner, the mode revert and
   * the dropdown close then happen exactly as they do for a popup the buyer
   * closed by hand: `watchPopupClose`'s poll sees `.closed` within its next
   * 300ms tick and runs its own terminal branch. That keeps ONE owner for the
   * settle (TWO-40 §14) rather than
   * adding a second path that has to agree with it about `flightDepth`,
   * `soleTraderReconfirmingCount` and `closeDropdownOnSettle`.
   *
   * DECIDED popups are left alone deliberately. A popup whose ACCEPTED
   * resolved to no buyer is decided yet still very much on screen, and the
   * buyer's retry inside it posts a second ACCEPTED (see `watchPopupClose`'s
   * own comment) — closing that window would take the retry with it.
   *
   * This is the NO-CHIP refocus only — alt-tab back, or a click anywhere on the
   * page that is not a mode chip. A chip click is resolved before this ever
   * runs; see `bindWindowRefocusListener` and `abandonPopupsForChipClick`.
   *
   * @returns {void}
   */
  closeAbandonedPopups: function () {
    twoincSoleTrader.abandonablePopups().forEach(function (watcher) {
      if (typeof watcher.win.close !== "function") return;
      watcher.win.close();
    });
  },

  /**
   * Abandon the signup popups because the buyer came back to the checkout by
   * clicking a mode chip other than Sole trader (Doug 2026-08-20).
   *
   * The close is the same one `closeAbandonedPopups` does. What differs is the
   * TIMING and the ownership: this runs in the chip's own `mousedown`, and
   * drains each popup's settle synchronously rather than leaving it to the
   * 300ms poll, so the chip's `click` handler a moment later sees no
   * outstanding flight and no live popup — which is the whole of what its
   * `isDeciding()` guard was refusing the click for.
   *
   * Draining early is only safe because `chipOwnsOutcome` holds back the two
   * steps that would touch the dropdown: see `settleClosedPopup`.
   *
   * The list is snapshotted because settling a popup removes its own record.
   *
   * @returns {void}
   */
  abandonPopupsForChipClick: function () {
    twoincSoleTrader.abandonablePopups().forEach(function (watcher) {
      if (typeof watcher.win.close === "function") watcher.win.close();
      twoincSoleTrader.settleClosedPopup(watcher, true);
    });
  },

  /**
   * Bring the still-undecided signup popups back to the front (Doug
   * 2026-08-20, item 6.1).
   *
   * `focus()` on a window handle is how a popup is raised — the browser brings
   * a window to the front when it is focused — and it needs no cooperation from
   * the hosted flow however cross-origin it is.
   *
   * @returns {boolean} whether there was a popup to raise, which is also the
   *   answer to "is the buyer's outstanding signup still on screen"
   */
  refocusOpenPopups: function () {
    const abandonable = twoincSoleTrader.abandonablePopups();
    abandonable.forEach(function (watcher) {
      if (typeof watcher.win.focus === "function") watcher.win.focus();
    });
    return abandonable.length > 0;
  },

  /**
   * The popups a refocus is entitled to act on: still undecided, and their
   * window still there.
   *
   * DECIDED popups are excluded deliberately. A popup whose ACCEPTED resolved
   * to no buyer is decided yet still very much on screen, and the buyer's retry
   * inside it posts a second ACCEPTED (see `watchPopupClose`'s own comment) —
   * closing that window would take the retry with it. A record whose window has
   * already gone is excluded because it outlives that window by up to one poll
   * cycle, exactly as `launchSignup`'s own guard reads it.
   *
   * One predicate, shared by all three refocus outcomes, so the case that
   * REFUSES to close a popup covers precisely the set the other two close.
   *
   * @returns {Array} a snapshot, safe to iterate while records are removed
   */
  abandonablePopups: function () {
    return twoincSoleTrader.activePopupWatchers.filter(function (watcher) {
      return !watcher.decided && !watcher.win.closed;
    });
  },

  /** Stop one popup-close poll (its own terminal branch, or a test tearing
   * down early) without touching any other outstanding one.
   * @param {number} id the interval id returned by `watchPopupClose`
   * @returns {void}
   */
  stopWatchingPopup: function (id) {
    clearInterval(id);
    twoincSoleTrader.activePopupWatchers = twoincSoleTrader.activePopupWatchers.filter(
      function (existing) {
        return existing.id !== id;
      }
    );
  },

  /**
   * The watcher record an inbound hosted-signup message belongs to.
   *
   * `event.source` is the authoritative answer: the browser names the window
   * that posted, and a WindowProxy stays reference-comparable across origins,
   * so pairing needs no cooperation from the popup and no property access on
   * it. An exact match wins even when already `decided`, so a replayed
   * ACCEPTED resolves to the popup it came from rather than falling through
   * and stealing a different, still-undecided popup's identity.
   *
   * The fallbacks cover a popup that closes in the same turn it posts, which
   * can arrive with `source` already null. Both scan NEWEST first, which is
   * the round-3 regression in one line: a forward scan returned a stale
   * hand-closed record ahead of the live popup that actually sent the
   * message, marking the wrong one decided — refusing the post-accept
   * re-signup and billing the accepting popup's
   * `soleTraderReconfirmingCount` decrement to a record that never owed one.
   * A relaunch is always newer than the stale record it opened over, so
   * newest-first cannot pick the stale one.
   *
   * An unmatched non-null `source` deliberately falls back too, rather than
   * refusing to pair: the only cost of pairing a message we cannot attribute
   * is mis-marking a record in a replay that no live window can actually send,
   * whereas refusing one would strand `soleTraderReconfirmingCount` — and with
   * it every leave-sole-trader action — on any browser whose `source` is not
   * reference-equal to what `window.open` returned.
   *
   * @param {Window|null} [source] the message's `event.source`
   * @returns {Object|undefined} the record, if the message can be attributed
   */
  findPopupWatcher: function (source) {
    const watchers = twoincSoleTrader.activePopupWatchers;
    if (source) {
      const exact = watchers.find(function (candidate) {
        return candidate.win === source;
      });
      if (exact) {
        return exact;
      }
    }
    for (let i = watchers.length - 1; i >= 0; i -= 1) {
      if (!watchers[i].decided && !watchers[i].win.closed) {
        return watchers[i];
      }
    }
    for (let i = watchers.length - 1; i >= 0; i -= 1) {
      if (!watchers[i].decided) {
        return watchers[i];
      }
    }
    return undefined;
  },

  /** Test seam: stop every outstanding popup-close poll and settle the
   * flight each was holding, so a test file leaves nothing running past it.
   * @returns {void}
   */
  stopAllPopupWatchers: function () {
    twoincSoleTrader.activePopupWatchers.forEach(function (watcher) {
      clearInterval(watcher.id);
      twoincSoleTrader.settleFlight();
    });
    twoincSoleTrader.activePopupWatchers = [];
  },

  /**
   * Adopt an enrolled sole trader's company onto the checkout.
   *
   * Goes through the ONE capture write path (TWO-40 §5), which owns the posted
   * fields, the instance record, the pairing tag and the provenance markers.
   * A `TWO:`-prefixed identifier takes exactly the same path as any registry
   * number — no branch here, none downstream. The only place it is treated
   * specially is display, and that is `formatCompanyNumber`'s job.
   *
   * @param {string} companyId
   * @param {string} companyName
   * @param {Object} [buyer] the autofill buyer, when one was resolved; its
   *   address is written too (§2.6, §5)
   * @returns {void}
   */
  setCompany: function (companyId, companyName, buyer) {
    if (companyId && twoincSoleTrader.mode === "sole_trader") {
      // The moment there is actually a sole trader captured — as opposed to
      // just having switched mode (TWO-40 §7 correction) — is the moment
      // there is nothing left to search for. Locking here, instead of on
      // every switch into sole-trader mode, is what lets the dropdown+spinner
      // survive the autofill/popup round trip.
      twoincSoleTrader.lockCapturedFields(companyId, companyName);
      // Read by `watchPopupClose()` in place of `#company_id`'s raw value
      // (round-1 review — Vader) — see that flag's own comment.
      twoincSoleTrader.soleTraderAdopted = true;
    }
    twoincCompanyCapture.write(companyName, companyId);
    // The display select too, when this is the clearing call setMode("business")
    // makes. The picker appends an <option> per pick and select2("destroy")
    // leaves it selected, so without this a company picked before the sole-trader
    // detour stayed on that select after being cleared from both posted fields
    // (TWO-25288).
    if (!companyName) {
      jQuery("#billing_company_display").val("");
    }
    const instance = Twoinc.getInstance();
    // The buyer's address, written REGARDLESS of the merchant's address-lookup
    // switch (TWO-40 §5). That switch gates an ordinary company-search pick's
    // address write, and routing sole-trader adoption through the same gate is
    // the bug this bullet exists for: the switch is legitimately off in
    // configurations that have nothing to do with sole-trader signup, and a
    // buyer who has just enrolled must still have their address land. Explicit
    // bypass rather than making the switch context-aware.
    const buyerAddress = buyer && (buyer.billing_address || buyer.address);
    if (companyId && buyerAddress) {
      instance.setAddress(buyerAddress);
      instance.registryAddressApplied = true;
    }
    // Re-evaluate which company fields are shown, AFTER the write above
    // (TWO-25326 §12).
    //
    // `#company_id`'s visibility depends on the value it now holds, and this
    // is the function that changes that value. Every route into sole-trader
    // capture toggles the fields BEFORE the autofill lands — setMode() runs
    // while the input is still empty, and the hosted-signup postMessage
    // handler reaches here with no toggle of its own at all — so without this
    // the minted `TWO:…` identifier lands in a field that was made visible on
    // the strength of it being empty, and stays on screen until some
    // unrelated country or payment-method switch happens to re-toggle. That
    // is the exact surface §12 exists to close.
    //
    // Not re-entrant: toggleBusinessFields() reads the inputs and reassigns
    // classes, and calls nothing that comes back here.
    twoincDomHelper.toggleBusinessFields();
    // Explicit rather than DOM-read: this function is the authority on what was
    // just captured, so the summary should not depend on the order the mirrors
    // above are written in (TWO-25288). Also re-renders after the toggle above,
    // whose own trailing renderCompanySummary() reads the DOM.
    twoincSelectWooHelper.renderCompanySummary(companyName, companyId);
    // The "select a different sole trader" link only means something once one
    // is adopted, so its visibility is re-decided wherever that changes.
    twoincSoleTrader.syncDifferentSoleTraderLink();
    if (companyId) {
      instance.getApproval();
    }
  },

  /**
   * Mint the delegation + autofill tokens. Invokes cb(true) once tokens are
   * available (also binding the signup postMessage listener), cb(false) on
   * any failure. Tokens are short-lived, so we re-mint on each email change.
   */
  fetchTokens: function (cb) {
    const cfg = twoincSoleTrader.config();
    if (!cfg.tokens_url) {
      if (cb) cb(false);
      return;
    }
    const country = twoincSoleTrader.currentCountry();
    jQuery
      .post(cfg.tokens_url, { nonce: cfg.nonce, country: country })
      .done(function (response) {
        // The buyer may have changed country while the request was in
        // flight — same guard `refresh()` uses for availability (TWO-40,
        // round-2 review — Vader). Without it, a slower request for the
        // country the buyer just left can land after a newer one and
        // overwrite `tokens` with delegated authority for the wrong
        // jurisdiction.
        if (twoincSoleTrader.currentCountry() !== country) {
          if (cb) cb(false);
          return;
        }
        if (response && response.success && response.data && response.data.autofill_token) {
          twoincSoleTrader.tokens = response.data;
          twoincSoleTrader.bindPopupMessageListener();
          twoincSoleTrader.scheduleTokenRefresh();
          if (cb) cb(true);
        } else {
          if (cb) cb(false);
        }
      })
      .fail(function () {
        if (cb) cb(false);
      });
  },

  /** Live id from `scheduleTokenRefresh`, so `stopTokenRefresh` (and tests) can clear it. */
  tokenRefreshIntervalId: null,

  /**
   * Keep the delegation/autofill tokens alive across a long checkout
   * (TWO-40). A buyer who sits on checkout past their expiry would
   * otherwise find autofill and the signup popup broken on a stale token
   * the next time either needs one — including via "select a different
   * sole trader", which reads `tokens` long after adoption (see
   * `openPopup`).
   *
   * Started once, from the first successful mint — not eagerly on page
   * load, since a buyer who never touches the sole-trader flow never mints
   * a token and has nothing to refresh.
   *
   * @returns {void}
   */
  scheduleTokenRefresh: function () {
    if (twoincSoleTrader.tokenRefreshIntervalId) return;
    twoincSoleTrader.tokenRefreshIntervalId = setInterval(
      twoincSoleTrader.refreshTokens,
      30 * 60 * 1000
    );
    window.addEventListener("pagehide", twoincSoleTrader.handlePageHide);
  },

  /**
   * The 30-minute refresh tick. Skipped, silently, while a mint from the
   * normal user-driven path (chip click / email-change prefetch, or the
   * signup popup itself) is already outstanding — `isBusy()` is the same
   * guard those paths use against each other, and that flight's own settle
   * leaves `tokens` fresh regardless. A failed re-mint (network error,
   * expired session) is left for the next scheduled tick, same tolerance
   * `fetchTokens` itself already has for its callers.
   *
   * Deliberately does NOT also call `beginFlight()`/`settleFlight()` itself
   * (round-1 review, rejected): `onEmailChanged` never checks `isBusy()`
   * before starting its own flight, so holding the flag wouldn't close that
   * race — it would only over-block the Business chip, `reopenSearch()`
   * and click-to-reopen for a background round trip they didn't ask for.
   * `fetchTokens`'s own country-staleness guard (round-2 review) keeps the
   * resulting last-write-wins no worse than the pre-existing, unsequenced
   * one `tokens` already has between two overlapping `onEmailChanged`
   * calls. Closing it for real means gating `onEmailChanged`/`launchSignup`
   * themselves — the fragile flow this feature is scoped to leave alone.
   *
   * @returns {void}
   */
  refreshTokens: function () {
    if (twoincSoleTrader.isBusy()) return;
    twoincSoleTrader.fetchTokens(function () {});
  },

  /**
   * `pagehide` fires on a bfcache-eligible navigation too, where the page is
   * only frozen — not destroyed — and JS timer state (including this
   * interval) survives the freeze/resume untouched. Tearing the interval
   * down on that path would leave a buyer restored from bfcache mid-checkout
   * with a dead refresh loop for the rest of the session (round-1 review —
   * Vader), so only a real unload (`event.persisted` false) stops it.
   *
   * @param {PageTransitionEvent} [event]
   * @returns {void}
   */
  handlePageHide: function (event) {
    if (event && event.persisted) return;
    twoincSoleTrader.stopTokenRefresh();
  },

  /**
   * @returns {void}
   */
  stopTokenRefresh: function () {
    clearInterval(twoincSoleTrader.tokenRefreshIntervalId);
    twoincSoleTrader.tokenRefreshIntervalId = null;
    window.removeEventListener("pagehide", twoincSoleTrader.handlePageHide);
  },

  /**
   * Read the buyer on the Two cookie. Invokes cb(buyer) with the buyer
   * details, or cb(null) when none exist (404) or on error. No UI side
   * effects — the caller decides what to do with the result.
   */
  fetchCurrentBuyer: function (cb) {
    if (!twoincSoleTrader.tokens) {
      cb(null);
      return;
    }
    fetch(window.twoinc.twoinc_checkout_host + "/autofill/v1/buyer/current", {
      credentials: "include",
      headers: { "two-delegated-authority-token": twoincSoleTrader.tokens.autofill_token }
    })
      .then(function (response) {
        if (response.ok) return response.json();
        // Every non-2xx path must still drain the body. Abandoning an unread
        // response leaves the request in flight as far as the browser is
        // concerned, so the in-flight request count never returns to zero and
        // anything waiting on network-idle (tooling, analytics, some themes)
        // hangs.
        return response.text().then(function () {
          if (response.status === 404) return null;
          throw new Error("autofill/v1/buyer/current failed");
        });
      })
      .then(function (json) {
        cb(json || null);
      })
      .catch(function () {
        cb(null);
      });
  },

  /**
   * Open the hosted sole-trader signup in a real popup window (TWO-40 §7).
   *
   * `window.open()`, NOT an iframe-in-overlay. The signup/OTP flow depends on
   * a third party that only works in a real popup window; the iframe rewrite
   * would sidestep popup-blocker risk and was explicitly evaluated and
   * rejected for that reason. The call stays SYNCHRONOUS with the click that
   * triggered it — an async-delayed `window.open()` is blocker bait in every
   * browser — which is why the chip-click path resolves against a prefetched
   * result rather than issuing a request first.
   *
   * Brand overlays do not need anything added here. A branded deployment
   * resolves this URL's HOST from the brand registry's own URL template
   * (see WC_Twoinc_Helper::get_environment_host and the brand's
   * `checkout_url_template`), so the host itself carries the brand in
   * production. A `?brand=`/`?brandVersion=` query-string form also exists,
   * but it is documented as a development-loop affordance for when several
   * brands temporarily share one non-production domain — not the mechanism to
   * build on.
   *
   * @param {Object} [options]
   * @param {boolean} [options.autoselect] when false, appended to the URL so
   *   the hosted flow offers a choice rather than adopting a known
   *   registration silently
   * @returns {Window|null}
   */
  openPopup: function (options) {
    if (!twoincSoleTrader.tokens) {
      return null;
    }
    const opts = options || {};
    const invoice = twoincAddressRoles.invoice();
    const read = function (name) {
      return twoincAddressRoles.value(invoice, name);
    };
    const prefill = {
      email: read("email"),
      first_name: read("first_name"),
      last_name: read("last_name"),
      company_name: read("company"),
      phone_number: read("phone"),
      billing_address: {
        street: read("address_1"),
        postal_code: read("postcode"),
        city: read("city"),
        region: read("state"),
        country_code: twoincSoleTrader.currentCountry()
      }
    };
    let url =
      twoincSoleTrader.tokens.signup_url +
      "?businessToken=" +
      encodeURIComponent(twoincSoleTrader.tokens.delegation_token) +
      "&autofillToken=" +
      encodeURIComponent(twoincSoleTrader.tokens.autofill_token) +
      "&autofillData=" +
      encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(prefill)))));
    // Wired through unconditionally when asked for, with no branching on what
    // the hosted flow does with it — that is the flow's business, not this
    // plugin's.
    if (opts.autoselect === false) url += "&autoselect=false";
    // 700 wide, not narrower: the hosted signup's own layout clips below that.
    return window.open(
      url,
      "_blank",
      "location=yes,resizable=yes,scrollbars=yes,status=yes,height=805,width=700"
    );
  },

  /**
   * The hosted signup posts 'ACCEPTED' back to the opener when the buyer
   * completes registration; re-read the buyer (it now owns the entered
   * email) and apply the result — autofilling and keeping Sole trader.
   */
  bindPopupMessageListener: function () {
    if (twoincSoleTrader.messageListenerBound) {
      return;
    }
    twoincSoleTrader.messageListenerBound = true;
    // Kept on the module so it can be unbound again. A `window` listener
    // outlives everything else this module owns, so without a handle on it
    // there is no way to take one down — which matters to any harness that
    // re-evaluates this file against the same window.
    twoincSoleTrader.messageHandler = function (event) {
      if (twoincSoleTrader.mode !== "sole_trader" || !twoincSoleTrader.tokens) {
        return;
      }
      const signupOrigin = new URL(twoincSoleTrader.tokens.signup_url).origin;
      if (event.origin !== signupOrigin) {
        return;
      }
      if (event.data === "ACCEPTED") {
        // Attribute the message to the popup that sent it — see
        // `findPopupWatcher`, which reads `event.source` rather than guessing
        // from the record list. Marked decided at receipt: from this moment
        // the popup's outcome is known, and its close poll must not treat it
        // as abandoned (nor spend its reconfirming decrement — that belongs to
        // this handler's callback below).
        const watcher = twoincSoleTrader.findPopupWatcher(event.source);
        // A replayed ACCEPTED resolves to its own, already-decided popup;
        // only the receipt that actually settles a popup may spend its
        // decrement below.
        const newlyDecided = !!watcher && !watcher.decided;
        if (watcher) {
          watcher.decided = true;
        }
        twoincSoleTrader.beginFlight();
        // Held for the duration of this fetch (round-1 review — Han): the
        // popup can close the instant "ACCEPTED" is posted, well before this
        // resolves and writes `#company_id` — `watchPopupClose()`'s own poll
        // checks this before deciding the buyer abandoned signup with
        // nothing captured.
        twoincSoleTrader.signupConfirming = true;
        twoincSoleTrader.fetchCurrentBuyer(function (buyer) {
          // AUTHENTICATED path (TWO-40 §8). The server has just told this
          // browser who the buyer is — the OTP step succeeded — so the email
          // they authenticated with is the answer, full stop. Re-running the
          // PASSIVE `buyerOwnsCheckoutEmail()` check here is a confirmed bug:
          // a buyer who signs up under a different address from the one in the
          // checkout's contact field completes OTP, the stale email match
          // disagrees with the server, and the same popup reopens forever.
          const resolved = !!buyer;
          twoincSoleTrader.prefetched = { ready: true, buyer: buyer, matches: resolved };
          twoincSoleTrader.signupConfirming = false;
          // This popup's own decision is now made — see
          // `soleTraderReconfirmingCount`'s comment. Decremented here rather
          // than only on popup close so a resolved re-signup un-blocks the
          // Business chip/`reopenSearch()` immediately, not after another
          // 300ms poll cycle. Scoped to the record paired at receipt: the
          // decrement belongs to the popup that incremented, whether or not
          // its window has already closed by the time this fetch resolves.
          // Clamped, same reason `watchPopupClose`'s own decrement is; the
          // `newlyDecided` check covers a late or replayed ACCEPTED, which
          // must not spend a second decrement against one increment.
          if (newlyDecided && watcher.isReconfirming) {
            twoincSoleTrader.soleTraderReconfirmingCount = Math.max(
              0,
              twoincSoleTrader.soleTraderReconfirmingCount - 1
            );
          }
          if (resolved) {
            twoincSoleTrader.setCompany(buyer.organization_number, buyer.company_name, buyer);
            twoincSoleTrader.showNote(false);
          } else {
            twoincSoleTrader.showError();
          }
          // LAST, after the capture above has actually landed (Doug
          // 2026-08-20). This used to settle before the write, so on the
          // ordinary path — the popup closes the instant "ACCEPTED" is posted,
          // which is what `signupConfirming` exists for — depth hit zero, the
          // spinner came down and the dropdown closed while the company name
          // and number were still unwritten. "Flow complete" is the write, not
          // the response.
          twoincSoleTrader.settleFlight();
        });
      } else {
        twoincSoleTrader.showError();
      }
    };
    window.addEventListener("message", twoincSoleTrader.messageHandler);
  },

  /** Test seam: take the hosted-signup listener back off the window. */
  unbindPopupMessageListener: function () {
    if (!twoincSoleTrader.messageHandler) return;
    window.removeEventListener("message", twoincSoleTrader.messageHandler);
    twoincSoleTrader.messageHandler = null;
    twoincSoleTrader.messageListenerBound = false;
  },

  showError: function () {
    const cfg = twoincSoleTrader.config();
    const $container = jQuery(".twoinc-sole-trader-note-slot");
    if (!cfg.text || !cfg.text.error || $container.length === 0) {
      return;
    }
    let $error = $container.find(".twoinc-sole-trader-toggle__error");
    if ($error.length === 0) {
      $error = jQuery("<span>", { class: "twoinc-sole-trader-toggle__error" });
      $container.append($error);
    }
    $error.text(cfg.text.error);
  }
};

class Twoinc {
  constructor() {
    if (instance) {
      throw "Twoinc is a singleton";
    }
    instance = this;

    this.isInitialized = false;
    this.isTwoincApproved = null;
    // Whether the address fields currently hold a registry lookup's result,
    // as opposed to the buyer's own (typed or account-prefilled) address.
    // Set only where `setAddress` is actually called with looked-up data
    // (TWO-25288); read by `enterManualCompanyEntry` to decide whether
    // disowning the company should clear the address behind it.
    this.registryAddressApplied = false;
    // Monotonic supersession counter for the registry address lookup
    // (TWO-24867). Bumped by every lookup and by every real country change,
    // so only the newest lookup — and only one issued under the country still
    // selected — is allowed to write the address fields.
    this.addressLookupSeq = 0;
    this.orderIntentCheck = {
      interval: null,
      pendingCheck: false,
      // Monotonic supersession counter for the order-intent request, the same
      // idiom `addressLookupSeq` above uses and for the same reason (review
      // round 3). Bumped when a request is issued and by every abandon, so a
      // response is only allowed to act if it is still the newest question
      // asked. Without it BOTH of these painted:
      //
      //   - two checks overlapping (the interval is disarmed before the request
      //     goes out, so a second can be armed while the first is in flight) and
      //     arriving in reverse order — the older verdict won, and the buyer
      //     read an answer about a company or cart they had already moved on
      //     from;
      //   - a response arriving after the check was abandoned — a Place Order
      //     click — which deselected the gateway and painted a verdict onto a
      //     checkout already mid-submit.
      seq: 0,
      // The seq of the request currently in flight, or null. This is the ONLY
      // record that a check is running between the interval being disarmed and
      // the response arriving, so abandonOrderIntentCheck() has to consult it:
      // during that window every other flag reads falsy, and round 2's
      // `wasRunning` gate therefore skipped the reset and left the loader on
      // screen for the rest of the page.
      inFlightSeq: null,
      // The jqXHR of the request in flight, so a superseded one can be dropped
      // instead of left to run (review round 5). Without this, rapid edits
      // stacked one POST per second against a 30s timeout — up to thirty
      // outstanding requests, all but the last of them already known to be
      // unwanted.
      inFlightXhr: null,
      // Ticks spent waiting for a readable cart total. The interval body cannot
      // proceed without one and used to retry forever, leaking a 1s timer for the
      // life of the page and keeping `pendingCheck` alive with it. See the
      // `!gross_amount` branch. Reset in exactly
      // one place — where a check is armed — because that is the only place it
      // can be stale by the time it matters (review round 2 found three further
      // resets that no test could distinguish from their absence).
      priceWaitTicks: 0,
      // The timer that waits out a WooCommerce checkout re-render before
      // painting a verdict. Held here rather than in a local, so that
      // abandonOrderIntentCheck() can cancel it: it used to be unreachable, and
      // an orphan copy of it would paint a verdict onto a tile that had already
      // been reset — after Place Order, on a checkout mid-submit (review round
      // 2).
      renderInterval: null
    };
    this.orderIntentLog = {};
    this.customerCompany = {
      company_name: null,
      country_prefix: null,
      organization_number: null
    };
    this.customerRepresentative = {
      email: null,
      first_name: null,
      last_name: null,
      phone_number: null
    };
    this.billingCompanySelect = null;
  }

  /**
   * Attach the company-search widget (TWO-25326 architecture rebuild).
   *
   * All the search/dropdown/manual-entry/select2 lifecycle logic this used
   * to inline now lives on `TwoCompanySearch` (see `twoincSelectWooHelper`,
   * constructed once at module load, above). This method's own job is just
   * the early-return gate and handing this singleton to the widget's
   * `select2:select` handler.
   *
   * Gated on the capture mode being `search` (#486): manual entry has no picker
   * to attach, and in sole-trader mode the live widget is already showing the
   * adopted company as its own selection (`lockCapturedFields()`) — re-attaching
   * over it would blank that selection back out.
   */
  enableCompanySearch() {
    if (twoincCompanyCapture.mode !== "search") return;
    this.billingCompanySelect = twoincSelectWooHelper.attach(this);
  }

  /**
   * Initialize Twoinc code
   */
  initialize(loadSavedInputs) {
    const self = this;

    if (this.isInitialized) {
      return;
    }
    const $body = jQuery(document.body);

    // Stop if not the checkout page
    if (jQuery("#order_review").length === 0) return;

    // Set up the business fields when the gateway is visible — or when
    // company search should serve other payment methods while this
    // gateway is gated away. (Note isTwoincVisible() is also true when
    // the gateway <li> is absent entirely — .css() on an empty set — so
    // the second clause guards intent, not today's behaviour: it must
    // survive any future tightening of isTwoincVisible.)
    if (
      twoincDomHelper.isTwoincVisible() ||
      // Admin's address-area preference, not the buyer-driven capture mode —
      // see the comment on the equivalent check in toggleBusinessFields
      // (TWO-25326 §7.1). No longer ANDed with
      // a separate "for other payment methods" toggle (removed, TWO-25326 —
      // that setting is now just this same checkbox, so the AND collapsed
      // to a no-op).
      window.twoinc.company_search_location === "address_area"
    ) {
      // Toggle the business fields
      twoincDomHelper.toggleBusinessFields();

      // Move the fields to correct positions
      twoincDomHelper.positionFields();
    }

    // Seed the delivery-address mirror HERE, before any binding below can
    // change an invoice field (TWO-40 §2). Seeded late — from a
    // `sync()` that self-seeds — the record would capture the invoice address
    // as it is AFTER the buyer's first edit, so an unedited delivery address
    // still holding the pre-edit value would read as buyer-edited and pin
    // itself for the rest of the session. Reads the invoice form only, so it
    // does not matter whether WooCommerce has rendered the shipping fields yet.
    twoincAddressMirror.seed();

    // Propagate invoice → delivery on every invoice-address edit. Delegated,
    // and on `change` AND `input`: `change` alone misses nothing a buyer does
    // by hand, but the plugin's own writes (registry autofill, sole-trader
    // adoption) go through `setAddress()`/the capture helper, which call
    // `sync()` directly rather than faking events.
    const mirroredSelector = twoincAddressMirror.MIRRORED_FIELDS.map(function (name) {
      return twoincAddressRoles.field(twoincAddressRoles.invoice(), name);
    }).join(", ");
    $body
      .off("change.twoincAddressMirror input.twoincAddressMirror", mirroredSelector)
      .on("change.twoincAddressMirror input.twoincAddressMirror", mirroredSelector, function () {
        twoincAddressMirror.sync();
      });

    // Focus on search input on country open
    jQuery("#billing_country").on("select2:open", function (e) {
      twoincSelectWooHelper.waitToFocus("billing_country");
    });

    // Enable company search, then again on a delay to catch a billing fragment
    // that WooCommerce had not rendered yet when initialize() ran. This retry is
    // the only one this code owns: `updated_checkout` re-syncs plenty of other
    // state but does not re-attach the picker itself. The other callers of
    // enableCompanySearch are the manual-entry exit and the sole-trader mode
    // switch — so a checkout whose deferred pass misses can still be recovered
    // by going through one of those, but nothing here is aiming for that, and it
    // is not a path to rely on. Treat this timer as the one that has to work.
    //
    // Wrapped rather than passed by reference (TWO-25337). `setTimeout` invokes
    // a bare method reference with the GLOBAL as its receiver: the timer steps
    // supply `window` as the callback's this-value, and a strict-mode class body
    // does not change that, because the global is only substituted for a
    // null/undefined receiver in sloppy mode and here a receiver was passed. So
    // `this` inside enableCompanySearch was `window`, and the deferred pass
    // wrote its `billingCompanySelect` onto `window` rather than onto this
    // instance.
    //
    // That did NOT throw and did not break the retry: nothing outside
    // enableCompanySearch reads `billingCompanySelect`, so the widget still
    // attached, and every other lookup in there goes through the DOM or
    // `Twoinc.getInstance()`. What it left behind was a live selectWoo object on
    // `window`, plus an instance property still holding whatever the
    // synchronous pass wrote. Note what that value is, because it is NOT null:
    // `.selectWoo()` on an empty jQuery set returns that same empty set. So in
    // the late-render case this timer exists for, the property held a truthy
    // empty set — a widget-shaped object wrapping no element, which is worse
    // than null for anyone testing it for presence. (`null` survives only when
    // company search is off, where the early return sits above the assignment.)
    // The first reader of `this.billingCompanySelect` after a deferred
    // re-attach would get that stale value, which is the trap
    // `clearSelectedCompany` already avoids by looking the widget up from the
    // DOM instead.
    //
    // Verified in real Chromium rather than reasoned about: the receiver is
    // `window`, the assignment succeeds, and the console stays clean. Under
    // Jest's fake timers the same call throws instead, because Sinon invokes
    // the callback with `null` rather than the global — so the suite sees a
    // TypeError that no browser ever produces. Do not restate that TypeError as
    // production behaviour; it is a test-harness artefact.
    //
    // NOT fixed here, and not caused here: the deferred re-run leaves the
    // picker's own `select2:select` / `select2:open` handlers DUPLICATED. Those
    // are bound unnamespaced with no preceding `.off()`, and selectWoo's re-init
    // destroys the previous instance with `.off(".select2")`, which cannot match
    // them — so after the retry a single pick runs the whole select body twice.
    //
    // What that costs, per handler, neither overstated nor waved away. The
    // `select2:select` copy is the one that costs anything.
    //
    // From the duplicated `select2:select`: `renderCompanySummary()` and
    // `togglePaySubtitleDesc()` genuinely run twice, and `addressLookup()` does
    // too when address lookup is enabled. The DOM and `customerCompany` writes
    // are idempotent — same data both times. `getApproval()` costs nothing: the
    // second entry finds `orderIntentCheck.interval` already set, flags
    // `pendingCheck` and returns, and that flag cannot buy a later extra round
    // either, because `pendingCheck` is only ever set inside that same guard and
    // every site that nulls `interval` clears it in the same block — so the 3s
    // poller only sees it set while the interval is still running, and the call
    // it makes re-enters the guard and returns. The duplicate is simply dropped.
    //
    // From the duplicated `select2:open`: very little, and specifically NOT a
    // pair of racing focus pollers. `addSelectWooFocusFixHandler` is idempotent
    // (it guards on its own `two-focused-handler` attribute), and while
    // `waitToFocus` has no dedupe, the arguments this site passes it —
    // `("billing_company_display", null, null)` — defeat its own defaults: it
    // guards them with `isNaN`, and `isNaN(null)` is false, so `hitsRequired`
    // stays null and `attemptsLeft` becomes `null * 8`, i.e. 0. The interval
    // clears itself on its first tick. Duplicating it therefore costs two
    // single-shot focus nudges, each already a no-op when the input is focused.
    //
    // One stale figure to distrust while reading around this:
    // `focusStillWithinCompanySearch`'s docblock says the poll can nudge "up to
    // ~4.8s from `select2:open`", which is 2 x 8 x 300ms — the numbers you get by
    // assuming those `isNaN` defaults apply. They do not apply to this call site,
    // so that bound does not describe it. Left as-is rather than corrected here
    // because it belongs with the `waitToFocus` work in TWO-25338, but do not
    // take it as evidence of a focus race on the company picker.
    //
    // Pre-existing and unchanged by this commit: the retry ran on a live widget
    // before it too, only storing its reference elsewhere. Its own ticket,
    // TWO-25338.
    this.enableCompanySearch();
    setTimeout(function () {
      self.enableCompanySearch();
    }, 800);

    // Disable or enable actions based on the account type
    $body.on("updated_checkout", Twoinc.getInstance().onUpdatedCheckout);

    // Company-search tile relocation (TWO-25326 §7.1), paired handlers on
    // WooCommerce's own before/after checkout-update triggers. `update_checkout`
    // is the PRESENT-tense trigger that starts a recalculation — fired
    // synchronously, before the async AJAX call WooCommerce's own handler on
    // this same event kicks off — so detaching the tile wrapper here always
    // completes before that AJAX response can wholesale-replace the
    // `.woocommerce-checkout-payment` fragment the tile lives inside (see
    // `detachCompanySearchTileWrapperToSafety`'s doc comment for the bug this
    // closes). `onUpdatedCheckout` (the past-tense, after-swap trigger,
    // already bound above) is what moves the wrapper back into the fresh
    // slot.
    $body.on("update_checkout", twoincSelectWooHelper.detachCompanySearchTileWrapperToSafety);

    // Same `update_checkout` timing, defending the widget's OWN dropdown
    // rather than the tile wrapper — see
    // `closeCompanySearchBeforeCheckoutUpdate`'s own comment.
    $body.on("update_checkout", twoincSelectWooHelper.closeCompanySearchBeforeCheckoutUpdate);

    // A payment-method switch must re-DECIDE company-field visibility, not
    // just relocate whatever is already there (TWO-25326 bugfix, Doug
    // live-verified: the search control never appeared in the payment tile
    // at all). `onUpdatedCheckout()` below only calls
    // `syncCompanySearchTileLocation()` — it never revisits which field
    // `toggleBusinessFields()` decided to show, so a buyer who starts on a
    // DIFFERENT gateway (the ordinary case: WooCommerce checks the first
    // available gateway by default) and switches TO this one saw an empty
    // tile: `#billing_company_display_field`'s hidden/visible decision was
    // made once, at page load, while some other gateway was selected — the
    // "other payment methods" branch of `toggleBusinessFields()`, gated on
    // `enable_company_search_for_others` — and nothing re-ran that decision
    // on the switch. `syncCompanySearchTileLocation()`'s own "unhide only if
    // a VISIBLE child moved in" guard (see its doc comment) then correctly
    // kept the slot hidden around a still-hidden field, which is the exact
    // symptom reported live.
    //
    // The `change` listener `onUpdatedCheckout()` itself re-registers on
    // every `updated_checkout` (below) cannot be relied on for this: it is
    // bound too late to catch the FIRST payment-method switch of a session,
    // since nothing forces `updated_checkout` to have fired even once before
    // a buyer picks a payment method, and — unbound with no matching `.off`
    // — it accumulates a duplicate on every cycle besides. Namespaced and
    // delegated here instead, alongside this function's other one-time
    // bindings, so it exists before the buyer's first click and never
    // duplicates across repeated `initialize()` calls (guarded by
    // `isInitialized` above, same as every other binding in this function).
    $body
      .off("change.twoincPaymentMethod", 'input[name="payment_method"]')
      .on("change.twoincPaymentMethod", 'input[name="payment_method"]', function () {
        twoincDomHelper.toggleBusinessFields();
      });

    // No click handler for the manual-entry row (TWO-25288). It is a pseudo-
    // option inside the results list now, so the picker already turns a click
    // on it into the same internal select that Enter does, and
    // bindManualEntryAffordance intercepts that one event for both. A second,
    // click-only path here would fire alongside it on every mouse activation.
    //
    // #search_company_btn's own click activation used to be delegated from
    // here (`$body.on("click", "#" + searchCompanyBtnId, ...)`). Removed
    // (#30.x.13) — live reproduction showed a real click on that button
    // never reached this handler (no console errors, mousedown/focus both
    // landed on the button correctly), so the activation now lives directly
    // on the button itself, alongside its Enter/Space handler — see the
    // comment in getSearchCompanyBtnNode for why binding directly there is
    // also more robust than delegating here in the first place.

    // Handle the representative inputs blur event
    $body.on(
      "blur",
      "#billing_first_name, #billing_last_name, #billing_email, #billing_phone",
      self.onRepresentativeInputBlur
    );

    // Handle the representative inputs blur event
    $body.on("blur", "#company_id, #billing_company_display", self.onCompanyManualInputBlur);

    // Handle the company inputs change event
    // Wrapped, not passed by reference (review round 5). Bound directly, jQuery
    // hands the handler its Event object as the `action` argument — which happened
    // to degenerate to the blanket hide, because no action name matches an Event,
    // so it did the right thing by accident and would break the moment
    // togglePaySubtitleDesc grew a truthy-action branch.
    $body.on("change", "#select2-billing_company_display-container", function () {
      twoincDomHelper.clearIntentVerdicts();
    });
    $body.on("change", "#billing_company", function () {
      Twoinc.getInstance().customerCompany.company_name = twoincSelectWooHelper.getCompanyName();
      twoincSelectWooHelper.renderCompanySummary();
      // Verdicts only — same mid-request blanking as the picker's own handler.
      twoincDomHelper.clearIntentVerdicts();
    });

    // Retype guard (TWO-40 §5): a company name the buyer edits away from the
    // organisation number it was captured under takes that number with it.
    // Bound on `input` as well as `change` so the stale number is gone before
    // the buyer can reach Place Order without ever blurring the field.
    //
    // Only ever fires for a real buyer edit: every plugin write in this file
    // goes through `.val()` or `.value =`, neither of which dispatches an
    // event.
    $body
      .off("input.twoincCompanyPairing change.twoincCompanyPairing", "#billing_company")
      .on(
        "input.twoincCompanyPairing change.twoincCompanyPairing",
        "#billing_company",
        function () {
          twoincCompanyCapture.guardCompanyRetype();
        }
      );

    // Handle the country inputs change event. The tracker behind it is seeded
    // at the END of this function, not here — see the comment there.
    $body.on("change", "#billing_country", self.onCountryInputChange);

    // Re-evaluate the sole-trader autofill prefetch whenever the email
    // changes, so a returning sole trader is auto-selected and the signup
    // popup can open synchronously on the chip click.
    $body.on("change", "#billing_email", function () {
      twoincSoleTrader.onEmailChanged();
    });

    // Click-to-reopen out of an adopted sole trader (TWO-40 §7 correction,
    // live-reported by Doug) — see `reopenSearch()`'s own comment. A plain
    // delegated binding is fine here, unlike `searchCompanyBtnId`'s: these
    // are static inputs present from page load, not a button built and
    // rebuilt on every dropdown open.
    $body.on("click", "#billing_company, #company_id", function () {
      twoincSoleTrader.reopenSearch();
    });

    // Both of these disarm an in-flight check, so both have to take the loading
    // state down with it — see abandonOrderIntentCheck()'s own comment for why
    // `checkout_error` is the worse of the two to leave spinning.
    $body.on("click", "#place_order", function () {
      // This now ABORTS an outstanding order-intent POST, where it used to only
      // disarm the timer (review round 5 noted the change). That response is the
      // only writer of `#tracking_id`, so in principle a tracking id could be lost
      // — in practice it could not: WooCommerce serialises the form after this
      // handler runs, so a response that had not already landed would have missed
      // the submission anyway. Recorded because it IS a behaviour change.
      Twoinc.getInstance().abandonOrderIntentCheck();
    });

    $body.on("checkout_error", function () {
      // Abandon, then re-arm (review round 5). The buyer is still on the page and
      // about to correct a field, but `checkout_error` does NOT fire
      // `updated_checkout`, so nothing else would run another check — the tile sat
      // blank, with no verdict and no spinner, for the rest of the page.
      // getApproval() no-ops when the form is not ready, so this costs nothing on
      // the errors that have nothing to do with this gateway.
      // Re-arm ONLY if a check was actually interrupted (review round 7).
      // Unconditionally, `getApproval()`'s own clear wiped a perfectly good verdict
      // that the abandon had just been careful to leave alone, and could not repaint
      // it for at least a second — or at all quickly for an approval, which is never
      // cached. Every failed submit for an unrelated reason, a missing postcode say,
      // flickered the box.
      if (Twoinc.getInstance().abandonOrderIntentCheck()) {
        Twoinc.getInstance().getApproval();
      }
    });

    setInterval(function () {
      if (Twoinc.getInstance().orderIntentCheck.pendingCheck) Twoinc.getInstance().getApproval();
      twoincDomHelper.saveCheckoutInputs();
    }, 3000);

    // Add customization for current theme if any
    twoincDomHelper.insertCustomCss();

    // Both of these re-toggle the company fields themselves, at the point they
    // write `#company_id` (TWO-25326 §12) — the toggle earlier in this function
    // ran before either of them, against an empty input.
    twoincDomHelper.loadUserMetaInputs();
    if (loadSavedInputs) {
      twoincDomHelper.loadStorageInputs();
      // loadStorageInputs() writes `#company_id`/`#billing_company` with bare
      // `.val()` assignments, so unlike the pass above it re-toggles nothing
      // and captures nothing. For a GUEST that pass is the only one that ever
      // supplies a company, so without this the restored pair carries no
      // pairing tag and a restored sole trader never reaches `sole_trader`
      // mode. No-ops when there is nothing restored, and idempotent when the
      // pass above already captured the same pair.
      twoincDomHelper.restoreCapturedCompany();
    }

    // Seed the country tracker HERE — after the two restore passes above, not
    // next to the binding that reads it (TWO-24867 / TWO-25326).
    //
    // `loadStorageInputs()` writes #billing_country with `selectElem.value =`
    // and fires no `change`. Seeded before it, the tracker held the country
    // the page was rendered with while the field held the restored one, and
    // the first re-render afterwards read the difference as a real country
    // change — destroying the company and address that same restore had just
    // put back. The bootstrap's own call is `initialize(true)`, so that is the
    // production path, not an edge case.
    //
    // Seeding at all is what tells the two first-event cases apart: with no
    // seed the FIRST country the page ever sees is adopted rather than acted
    // on — right for the re-render WooCommerce fires at init (core's
    // address-i18n.js triggers `country_to_state_changing` carrying the
    // country the form already had), wrong for a buyer who changes country
    // before any re-render happens.
    //
    // Through `countryDidChange` rather than by assignment, so this file has
    // exactly one writer for the tracker.
    twoincSelectWooHelper.countryDidChange(twoincSelectWooHelper.currentCountry());

    setTimeout(function () {
      twoincDomHelper.saveCheckoutInputs();
      Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();
      Twoinc.getInstance().customerRepresentative = twoincDomHelper.getRepresentativeData();
      twoincSelectWooHelper.renderCompanySummary();
      Twoinc.getInstance().getApproval();
    }, 1000);
    this.updateElements();
    this.isInitialized = true;
  }

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!instance) instance = new Twoinc();
    return instance;
  }

  /**
   * Check if all the required details are collected
   *
   * @returns {boolean}
   */
  updateElements() {
    // Clear the VERDICT, not the loading state (review round 5). This runs on
    // every `updated_checkout`, and WooCommerce fires that for a shipping-method
    // change or a coupon — neither of which has any bearing on a request already
    // in flight. The blanket hide that used to be here blinked the spinner off
    // mid-request and left the tile blank until the response landed.
    twoincDomHelper.clearIntentVerdicts();

    // Check approval again
    this.getApproval();

    // Rearrange the DOMs in Twoinc payment
    twoincDomHelper.rearrangeDescription();

    this.toggleDueInDays();
    this.getDueInDays();
  }

  /**
   * Check if all the required details are collected
   *
   * @returns {boolean}
   */
  isReadyApprovalCheck() {
    if (window.twoinc.enable_order_intent !== "yes") {
      return false;
    }

    if (!Twoinc.getInstance().customerCompany.organization_number) {
      return false;
    }

    let values = [].concat(Object.values(this.customerCompany));

    return !twoincUtilHelper.isAnyElementEmpty(values);
  }

  /**
   * Retire whatever order-intent request is in flight (review round 5).
   *
   * Bumping the counter is what makes the response a no-op; the abort is purely
   * so the connection is not held open for an answer nobody will read. The order
   * matters: the counter moves FIRST, so the `.fail` that jQuery synchronously
   * runs for an abort already fails its own `stillCurrent()` check and cannot
   * deselect the gateway or paint a decline.
   *
   * @returns {void}
   */
  supersedeInFlightOrderIntent() {
    this.orderIntentCheck.seq += 1;
    this.orderIntentCheck.inFlightSeq = null;
    const xhr = this.orderIntentCheck.inFlightXhr;
    this.orderIntentCheck.inFlightXhr = null;
    if (xhr && typeof xhr.abort === "function") xhr.abort();
  }

  /**
   * Stop the armed order-intent check and take the tile back to neutral.
   *
   * Used where a check ends with a REQUEST outstanding, or with its verdict paint
   * still pending — the two states in which something of this check's is on screen
   * and nothing else will take it down:
   *
   *   - Place Order clicked, or `checkout_error` fired, mid-request (and
   *     `checkout_error` does NOT trigger `updated_checkout`, so nothing
   *     re-renders the tile afterwards — the spinner would sit beside the
   *     validation errors for the rest of the page);
   *   - the form went incomplete while a request was in flight or a paint pending.
   *
   * NOT used where a check ends before its request goes out: no loading state is
   * up then, so there is nothing to take down and the blanket reset below would
   * only wipe whatever else the tile was showing. The cart-total give-up disarms
   * quietly for exactly that reason.
   *
   * `togglePaySubtitleDesc()` with no argument is the blanket hide-every-pay-box
   * reset, which is the right end state: there is no verdict to show, and
   * whatever verdict was on screen before belonged to a question that has since
   * changed.
   */
  abandonOrderIntentCheck() {
    // Only touch the UI when there was actually something in flight (review
    // round 2). `#place_order` fires on clicks that never submit — an HTML5
    // constraint failure, WooCommerce's own client-side validation — and
    // `checkout_error` fires for errors that have nothing to do with this
    // gateway, such as a missing postcode. Resetting unconditionally wiped a
    // perfectly good verdict in both cases, and neither fires
    // `updated_checkout`, so nothing brought it back.
    // `inFlightSeq` is in the list because of a hole round 2's gate had (found
    // round 3): the interval is disarmed BEFORE the request goes out, so for the
    // whole duration of the XHR every other flag here reads falsy. An abandon in
    // that window therefore skipped the reset and left the loader on screen with
    // its response orphaned below — the exact defect the gate was added to avoid,
    // reintroduced through its own condition.
    // One question, not two. Round 8 split this into `wasShowing` (an outstanding
    // request or a pending paint) to gate the reset, and `wasRunning` to gate the
    // caller's re-arm, on the theory that resetting for a merely ARMED check wipes an
    // earlier verdict. It cannot: every route that arms a check calls
    // `clearIntentVerdicts()` in the same breath — `getApproval()` at its head,
    // `updateElements()` before it — so "armed" already implies "nothing of ours is on
    // screen", and the reset is a no-op there rather than a hazard. The split was
    // reverted for the reason round 7 deleted the paint give-up's hand-back: a
    // distinction no test can exhibit is one more invariant to maintain and nothing
    // else.
    const wasRunning =
      this.orderIntentCheck.interval !== null ||
      this.orderIntentCheck.renderInterval !== null ||
      this.orderIntentCheck.inFlightSeq !== null ||
      this.orderIntentCheck.pendingCheck;

    clearInterval(this.orderIntentCheck.interval);
    this.orderIntentCheck.interval = null;
    clearInterval(this.orderIntentCheck.renderInterval);
    this.orderIntentCheck.renderInterval = null;
    this.orderIntentCheck.pendingCheck = false;

    this.supersedeInFlightOrderIntent();

    if (wasRunning) {
      twoincDomHelper.togglePaySubtitleDesc();
    }

    // Returned so callers can tell "I stopped something" from "there was nothing to
    // stop" (review round 7) — `checkout_error` re-arms only in the first case.
    return wasRunning;
  }

  /**
   * Check the company approval status by creating an order intent
   */
  getApproval() {
    if (!this.isReadyApprovalCheck()) {
      // A form that has become incomplete cannot answer the question a request
      // in flight is asking, and that request's answer describes a form the
      // buyer no longer has (review round 5). Orphan it, and take the loading
      // state down with it — otherwise the spinner runs until a response the
      // checkout will refuse to use finally arrives.
      // A pending PAINT counts as well as a request in flight (review round 5):
      // once `stillCurrent()` has released `inFlightSeq` the response is banked and
      // only the paint is left, and letting it land writes a verdict about a form
      // the buyer has since emptied.
      if (
        this.orderIntentCheck.inFlightSeq !== null ||
        this.orderIntentCheck.renderInterval !== null
      ) {
        this.abandonOrderIntentCheck();
      }
      return;
    }

    // CLEAR the previous verdict here — and only clear it. The loading state
    // goes up where the request is actually issued, in the interval body below.
    //
    // Clearing at this one choke point is the whole of TWO-25326's third
    // requirement, and it has to be here rather than per-caller: four of the
    // five routes in — setSoleTraderCompany(), onCompanyInputBlur(),
    // onRepresentativeInputBlur() and onCountryChange() — did no clearing of
    // their own at all, so the buyer changing company kept reading "<old
    // company> is not available for this order" until the new RESULT arrived.
    //
    // Showing the LOADER here as well was tried and reverted (review round 5).
    // It read better — no gap between the old verdict going and the spinner
    // appearing — but it decoupled the loading state's lifetime from the
    // request's, and four review rounds of stranded, blanked and duplicated
    // spinners followed from that one change. Tied to the request, the loader
    // is up exactly while a request is outstanding, which is a property that
    // holds by construction instead of by patching every exit.
    //
    // Above the interval guard on purpose: a call arriving while a check is
    // already armed is a NEWER question, so the older verdict is stale from
    // this moment either way.
    twoincDomHelper.clearIntentVerdicts();

    if (this.orderIntentCheck.interval) {
      this.orderIntentCheck.pendingCheck = true;
      return;
    }

    this.orderIntentCheck.priceWaitTicks = 0;
    this.orderIntentCheck.interval = setInterval(function () {
      let gross_amount = twoincDomHelper.getPrice("order-total");
      let tax_amount = twoincDomHelper.getPrice("tax-rate");
      if (!gross_amount) {
        // Bounded, not forever (review round 1). No cart total, no request — but
        // this used to retry indefinitely, and there are carts where it can never
        // succeed: a 100%-discounted order's total of 0 is falsy every tick, and a
        // theme whose totals markup `getPrice()` cannot read never yields one at
        // all. An unbounded 1s interval is a leak for the life of the page, and it
        // holds `pendingCheck` with it, which keeps the 3s poller re-entering.
        //
        // Ten ticks because the only legitimate reason to wait is a totals
        // block WooCommerce is still re-rendering, which is sub-second; ten
        // seconds is generous for that and short enough that the buyer is still
        // looking. Giving up costs nothing — the next blur or `updated_checkout`
        // arms a fresh check.
        if (++Twoinc.getInstance().orderIntentCheck.priceWaitTicks < 10) return;
        // Disarm QUIETLY (review round 5). No loading state is up during the price
        // wait — it goes up with the request, which is downstream of reading the
        // total — so there is nothing of this check's to take off screen, and
        // abandonOrderIntentCheck()'s blanket reset instead wiped whatever else was
        // there. Reachable with a verdict on screen: an earlier request lands and
        // paints while this interval is still counting, and the give-up erased it
        // with nothing left to re-arm. Deliberately does NOT touch an outstanding
        // request either — that is a live question this wait knows nothing about.
        clearInterval(Twoinc.getInstance().orderIntentCheck.interval);
        Twoinc.getInstance().orderIntentCheck.interval = null;
        Twoinc.getInstance().orderIntentCheck.pendingCheck = false;
        return;
      }
      if (!tax_amount) {
        tax_amount = 0;
      }
      let net_amount = gross_amount - tax_amount;

      let jsonBody = JSON.stringify({
        merchant_id: window.twoinc.merchant?.id,
        merchant_short_name: window.twoinc.merchant?.short_name,
        gross_amount: gross_amount.toFixed(2),
        net_amount: net_amount.toFixed(2),
        tax_amount: tax_amount.toFixed(2),
        invoice_type: "FUNDED_INVOICE",
        buyer: {
          company: Twoinc.getInstance().customerCompany,
          representative: Twoinc.getInstance().customerRepresentative
        },
        currency: window.twoinc.currency,
        line_items: [
          {
            name: "Cart",
            description: "",
            gross_amount: gross_amount.toFixed(2),
            net_amount: net_amount.toFixed(2),
            discount_amount: "0",
            tax_amount: tax_amount.toFixed(2),
            tax_class_name: "VAT " + ((100.0 * tax_amount) / net_amount).toFixed(2) + "%",
            tax_rate: "" + ((1.0 * tax_amount) / net_amount).toFixed(6),
            unit_price: net_amount.toFixed(2),
            quantity: 1,
            quantity_unit: "item",
            image_url: "",
            product_page_url: "",
            type: "PHYSICAL",
            details: {
              categories: [],
              barcodes: []
            }
          }
        ]
      });

      let hashedBody = twoincUtilHelper.getUnsecuredHash(jsonBody);
      if (Twoinc.getInstance().orderIntentLog[hashedBody]) {
        // This body has already been answered — render the cached verdict and
        // DISARM (review round 1). This branch used to return with the interval
        // still running, which had two consequences: the cached verdict was
        // re-rendered every second forever, and `pendingCheck` — set by the guard
        // in getApproval() whenever an interval is armed — could never be cleared,
        // so the 3s poller in initialize() re-entered getApproval() indefinitely.
        // Disarming is also just correct: the answer is in hand.
        clearInterval(Twoinc.getInstance().orderIntentCheck.interval);
        Twoinc.getInstance().orderIntentCheck.interval = null;
        Twoinc.getInstance().orderIntentCheck.pendingCheck = false;
        // And retire anything in flight (review round 5). A request issued for an
        // EARLIER body can still be outstanding here, and its answer would land
        // afterwards and paint over the verdict this branch is about to show —
        // the cached one being, by construction, the answer to the body the form
        // holds right now.
        Twoinc.getInstance().supersedeInFlightOrderIntent();
        twoincDomHelper.togglePaySubtitleDesc(
          ...Twoinc.getInstance().orderIntentLog[hashedBody].split("|")
        );
        return;
      }
      if (!Twoinc.getInstance().isReadyApprovalCheck()) {
        // Nothing of this check is on screen yet — the loading state goes up with
        // the request, below — so this is a disarm, and abandonOrderIntentCheck()'s
        // reset is a no-op via its own `wasRunning` gate unless an EARLIER check
        // left a request or a paint outstanding, which is precisely when the reset
        // is wanted. Reachable whenever the buyer empties a required field in the
        // second between arming and this tick.
        Twoinc.getInstance().abandonOrderIntentCheck();
        return;
      }

      clearInterval(Twoinc.getInstance().orderIntentCheck.interval);
      Twoinc.getInstance().orderIntentCheck.interval = null;
      Twoinc.getInstance().orderIntentCheck.pendingCheck = false;

      // Re-asserted rather than relied upon from getApproval(): a `pendingCheck`
      // re-arm comes straight back here, and the run of ticks spent waiting for
      // a cart total sits between the two.
      twoincDomHelper.togglePaySubtitleDesc("checking-intent");

      // Retire the previous request before issuing this one (review round 5).
      // The interval is disarmed before a request goes out, so nothing stopped a
      // second check arming and POSTing while the first was still outstanding —
      // at one per second against a 30s timeout, up to thirty in flight, all but
      // the last already superseded. This also claims this request's place in
      // the queue, so both handlers can tell whether they are still the newest
      // question asked (see `seq`/`inFlightSeq`).
      Twoinc.getInstance().supersedeInFlightOrderIntent();
      const seq = Twoinc.getInstance().orderIntentCheck.seq;
      Twoinc.getInstance().orderIntentCheck.inFlightSeq = seq;
      // The company this request is ABOUT, captured now rather than re-read when its
      // verdict is painted (review round 5) — and read from `customerCompany`, the
      // same record the request BODY above is built from (review round 8). It used to
      // come off `#billing_company`/`#company_id`, which can diverge from the record:
      // `clearCompanyIfCountryStale()` exists because of that divergence and
      // documents it as reachable (a number typed into `#company_id` with no blur).
      // Divergent, the sentence named a company the API was never asked about.
      const companyLabel = twoincDomHelper.readCompanyLabelFromRecord();

      /**
       * Is this response still the one the checkout is waiting for?
       *
       * Also clears `inFlightSeq` when it is, so the abandon gate stops counting
       * this request as running.
       *
       * @returns {boolean}
       */
      const stillCurrent = function () {
        if (seq !== Twoinc.getInstance().orderIntentCheck.seq) return false;
        Twoinc.getInstance().orderIntentCheck.inFlightSeq = null;
        // Released with it, or the abort in supersedeInFlightOrderIntent() would
        // be aimed at a jqXHR that has already settled — harmless, but it would
        // also keep a reference to every response for the life of the page.
        Twoinc.getInstance().orderIntentCheck.inFlightXhr = null;
        return true;
      };

      // Create an order intent
      const approvalResponse = jQuery.ajax({
        url: twoincUtilHelper.constructTwoincUrl("/v1/order_intent"),
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        method: "POST",
        xhrFields: { withCredentials: true },
        // Bounded, like the company-search transport already is (review round
        // 3). A request that never settles calls neither handler, and both the
        // loader coming down and the verdict appearing hang off those handlers —
        // so a hung connection meant "Checking availability" for the rest of the
        // page. A timeout arrives as a `.fail` with status 0, which paints the
        // generic decline and is deliberately not cached.
        timeout: 30000,
        data: jsonBody
      });
      Twoinc.getInstance().orderIntentCheck.inFlightXhr = approvalResponse;

      approvalResponse.done(function (response) {
        if (!stillCurrent()) return;

        // A 200 whose JSON body parses to `null` — or to anything that is not an
        // object — makes every read below a TypeError (review round 8). It throws
        // AFTER `stillCurrent()` has released `inFlightSeq`/`inFlightXhr` and BEFORE
        // the paint is armed, so the loader is stranded for the rest of the page with
        // nothing left able to reset it: `abandonOrderIntentCheck()`'s gate reads
        // false on every flag by then. Same class as the `responseJSON` and
        // `Array.append` throws round 1 fixed, but on the SUCCESS path, which those
        // guards never covered. Normalising to `{}` sends it down the not-approved
        // branch, which is the right reading of an unusable body.
        const body = response && typeof response === "object" ? response : {};

        // Store the approved state
        Twoinc.getInstance().isTwoincApproved = body.approved;

        if (!body.approved) {
          twoincDomHelper.deselectPaymentMethod();
        }

        // Update tracking number
        if (body.tracking_id && document.querySelector("#tracking_id")) {
          document.querySelector("#tracking_id").value = body.tracking_id;
        }

        // Display messages and update order intent logs. The hash is passed
        // rather than read back off a shared slot (review round 2): because the
        // interval is disarmed BEFORE the request goes out, a second check could
        // be armed and overwrite that slot while the first was still in flight —
        // so the first response was cached under the second request's body. With
        // the cached branch now disarming, that mis-filed entry would be served
        // forever with no request ever issued again.
        //
        // `false` is "this is not a failure" — read from the jQuery callback we
        // are IN rather than sniffed off the payload (review round 3). jQuery
        // hands `.done` the parsed response BODY, so a `status` field in that
        // body was being read as an HTTP status.
        Twoinc.getInstance().processOrderIntentResponse(body, hashedBody, false, companyLabel);
      });

      approvalResponse.fail(function (response) {
        if (!stillCurrent()) return;

        // Store the approved state
        Twoinc.getInstance().isTwoincApproved = false;

        twoincDomHelper.deselectPaymentMethod();

        // Display messages and update order intent logs
        Twoinc.getInstance().processOrderIntentResponse(response, hashedBody, true, companyLabel);
      });
    }, 1000);
  }

  /**
   * Update page after order intent request complete
   */
  processOrderIntentResponse(response, hashedBody, isFailure, companyLabel) {
    let displayMsgId = "";
    let invalidFields = [];

    if (response.approved) {
      displayMsgId = "intent-approved";
    } else {
      // Display error messages
      displayMsgId = "errored|.twoinc-err-payment-default";
      // `isFailure &&` (review round 3): on the success path `response` is the
      // parsed response BODY, so an API that returns a field called `status`
      // would send a perfectly good 200 down the HTTP-error branch below. Which
      // callback we were invoked from is the fact being tested, and only the
      // caller knows it.
      if (isFailure && response.status >= 400) {
        // @TODO: use the error code returned by the API
        //
        // Two fixes here, both found in review round 1 and both about this
        // function throwing before it reaches the render below — which is the
        // ONLY thing that takes the loading state down, so a throw here now
        // leaves "Checking availability" on screen for the rest of the page.
        //
        // 1. `responseJSON` is undefined for any failure that did not carry a
        //    JSON body — a proxy 502 with an HTML error page, a parse error —
        //    and `"error_details" in undefined` is a TypeError. Guarded by
        //    reading the field off the object only when there is an object.
        // 2. `invalidFields.append(...)` — Array has no `append`, so the ONE
        //    route to the phone-number box has always thrown, which is why that
        //    box has never been seen. `push`.
        let errMsg = response.responseJSON;
        if (errMsg && typeof errMsg !== "string") {
          if (errMsg["error_details"]) {
            errMsg = errMsg["error_details"];
          } else if (errMsg["error_code"]) {
            errMsg = errMsg["error_code"];
          }
        }

        if (typeof errMsg === "string" && errMsg.includes("Invalid phone number")) {
          displayMsgId = "errored|.twoinc-err-phone-number";
          invalidFields.push("billing_phone_field");
        }
      }

      // Cache the verdict against the request body that produced it — but only
      // when it IS a verdict (review round 2, narrowed round 3).
      //
      // The cached branch disarms the timer and issues no request, so a cached
      // answer is permanent for the rest of the page. That is right for an
      // answer and catastrophic for a hiccup: one dropped connection would
      // decline this cart and company until the buyer reloaded.
      //
      // A declining 200 is an answer. So is most of the 4xx range — the backend
      // refusing this order with a reason. Not cacheable: anything on the
      // transport (status 0, our own timeout), any 5xx, and the four 4xx codes
      // that mean "ask again" rather than "no" — 401 and 403 (a session or key
      // that can be refreshed), 408 (a timeout the server noticed first) and 429
      // (rate limiting, where re-asking later is the documented remedy).
      const RETRYABLE = [401, 403, 408, 429];
      const cacheable =
        !isFailure ||
        (response.status >= 400 && response.status < 500 && !RETRYABLE.includes(response.status));
      if (hashedBody && cacheable) {
        this.orderIntentLog[hashedBody] = displayMsgId;
      }
    }

    // Paint the verdict, once WooCommerce is not mid-re-render — its own
    // `updated_checkout` rebuilds the payment box and would discard anything
    // written into it.
    //
    // Bounded, and cancellable (review round 2). This is the ONLY code that
    // takes the loading state down, so an overlay that never clears used to mean
    // "Checking availability" for the rest of the page — the same defect the
    // cart-total wait was bounded for. And the timer used to be a local, so
    // abandonOrderIntentCheck() could not reach it: a Place Order click reset the
    // tile and an orphan copy of this then painted a verdict back onto a
    // checkout that was already mid-submit, with the gateway radio already
    // deselected.
    let renderWaitTicks = 0;
    // The paint is tied to the check that produced it (review round 5). Neither
    // the issue path nor the cached branch clears `renderInterval`, so a paint
    // still pending from an earlier response would fire afterwards and put a stale
    // verdict over the loader — or over the verdict — of the check that superseded
    // it. Reachable with an `updated_checkout` arriving in the second between a
    // response and its paint, which is routine.
    const paintSeq = this.orderIntentCheck.seq;
    clearInterval(this.orderIntentCheck.renderInterval);
    this.orderIntentCheck.renderInterval = setInterval(() => {
      if (paintSeq !== this.orderIntentCheck.seq) {
        clearInterval(this.orderIntentCheck.renderInterval);
        this.orderIntentCheck.renderInterval = null;
        return;
      }
      if (jQuery("#payment .blockOverlay").length === 0) {
        const parts = displayMsgId.split("|");
        twoincDomHelper.togglePaySubtitleDesc(parts[0], parts[1], companyLabel);
        for (let fld of invalidFields) {
          twoincDomHelper.markFieldInvalid(fld);
        }
        clearInterval(this.orderIntentCheck.renderInterval);
        this.orderIntentCheck.renderInterval = null;
        return;
      }
      if (++renderWaitTicks >= 10) {
        // Give up on THIS paint only, rather than calling
        // abandonOrderIntentCheck() (review round 3). That helper also bumps the
        // supersession counter and clears `pendingCheck`, neither of which has
        // anything to do with an overlay refusing to clear — and bumping the
        // counter here would silently orphan a newer check that had already been
        // armed while this paint was waiting.
        clearInterval(this.orderIntentCheck.renderInterval);
        this.orderIntentCheck.renderInterval = null;

        // Reset, unconditionally. Rounds 3-7 went round this branch three times —
        // reset, then hand the tile back to anything still running, then hand it
        // back only for an outstanding request — and the last pass showed the
        // hand-back is UNREACHABLE, so the simplest form is also the correct one.
        //
        // Why unreachable: getting here at all means `paintSeq === seq`, or the
        // guard above would have returned. A request is outstanding only if it was
        // issued, issuing bumps `seq`, and this paint's `paintSeq` was captured
        // before that — so "outstanding request" implies `paintSeq !== seq` and we
        // never arrive. `inFlightSeq` is therefore always null at this line.
        //
        // The behaviour the hand-back was reaching for is real, and the `paintSeq`
        // guard is what delivers it: when a newer check has superseded this paint,
        // the guard retires the paint and touches the tile not at all, leaving the
        // newer check's own loading state exactly where it is. This branch only ever
        // runs when nothing else is in play, and then a neutral tile is right.
        twoincDomHelper.togglePaySubtitleDesc();
      }
    }, 1000);
  }

  addressLookup(selectedCompany) {
    const self = this;
    // Supersession, not cancellation (TWO-24867). Two independent things can
    // make this response wrong by the time it arrives: a newer lookup (the
    // buyer picked a different company) and a country change (the buyer
    // corrected a mis-clicked country). The sequence number catches the
    // first, the country snapshot the second — a country switched away from
    // and back again between request and response leaves the sequence stale
    // but the country matching, and vice versa, so both are needed.
    const seq = (self.addressLookupSeq += 1);
    const requestCountry = twoincSelectWooHelper.currentCountry();
    const addressResponse = jQuery.ajax({
      dataType: "json",
      url: twoincUtilHelper.constructTwoincUrl(`/companies/v2/company/${selectedCompany.lookup_id}`)
    });
    addressResponse.done(function (response) {
      if (seq !== self.addressLookupSeq) return;
      // An empty reading on EITHER side means the field was mid-replacement,
      // not that the country moved — discarding a good registry address on it
      // would be a silent failure with no retry and no message. Both sides
      // matter: a lookup issued during a replacement snapshots "", and
      // comparing that against a known country would drop every response.
      // Only two countries that are both known AND different are grounds to
      // drop this.
      const landedCountry = twoincSelectWooHelper.currentCountry();
      if (requestCountry && landedCountry && landedCountry !== requestCountry) return;
      // Use new address lookup by default
      if (response.addresses) {
        self.setAddress(response.addresses[0]);
        // Only here, on the branch that actually writes registry data. A
        // buyer's own address (account-prefilled, or typed by hand) never
        // goes through this path, so this flag distinguishes the two —
        // `#company_id` being non-empty does not: it is also written by
        // account-restore and sole-trader code with no lookup behind it, and
        // is empty for company hits that carry no organisation number even
        // though a lookup DID run for them.
        self.registryAddressApplied = true;
      }
    });
  }

  /**
   * Write an address that arrived in an external payload onto the
   * INVOICE-role address form (TWO-40 §2.6).
   *
   * ONE routing table for every such payload — the registry address behind a
   * company-search pick and the sole-trader autofill buyer alike. Sole trader
   * is deliberately NOT special-cased here; it was on the platform this ports
   * from, and the divergence is what let the two paths drift.
   *
   *   - `building`/`apartment` present → they go on line 1 and `street` goes
   *     on line 2.
   *   - `building`/`apartment` absent → `street` goes on line 1 and line 2 is
   *     left ALONE. Not blanked: this function's job is to write what the
   *     payload carries, and a payload with nothing for line 2 says nothing
   *     about line 2. Clearing a captured address is `clearAddress()`.
   *   - No dedup between the two lines even when they come out textually
   *     identical — some real addresses genuinely repeat.
   *   - `region` goes to the state/county control when the country's address
   *     format has one, else onto the city with a comma (`"Ashford, Kent"`).
   *
   * `street_address` is accepted as a synonym for `street`, which is what the
   * company-address endpoint calls the same field.
   *
   * @param {Object} address
   * @returns {void}
   */
  setAddress(address) {
    const payload = address || {};
    const role = twoincAddressRoles.invoice();
    const street = twoincUtilHelper.blankToEmpty(
      payload.street !== undefined ? payload.street : payload.street_address
    );
    const premises = [payload.building, payload.apartment]
      .map(twoincUtilHelper.blankToEmpty)
      .filter(Boolean)
      .join(" ");

    if (premises) {
      jQuery(twoincAddressRoles.field(role, "address_1")).val(premises);
      jQuery(twoincAddressRoles.field(role, "address_2")).val(street);
    } else {
      jQuery(twoincAddressRoles.field(role, "address_1")).val(street);
    }
    jQuery(twoincAddressRoles.field(role, "city")).val(twoincUtilHelper.blankToEmpty(payload.city));
    jQuery(twoincAddressRoles.field(role, "postcode")).val(
      twoincUtilHelper.blankToEmpty(payload.postal_code)
    );
    Twoinc.getInstance().setRegion(role, payload.region);

    // Propagate onto the delivery address before the re-render below, so one
    // checkout update carries both (TWO-40 §2).
    twoincAddressMirror.sync();

    // Update order review in case there is a shipping change
    jQuery(document.body).trigger("update_checkout");
  }

  /**
   * Best-effort write of a registry `region` onto a role's address form
   * (TWO-40 §2.6).
   *
   * Text→id matching against a state select is inherently lossy — the registry
   * and WooCommerce's own state lists are two independent vocabularies — so it
   * is attempted and then fallen back on, never assumed. When there is no
   * state control to write to at all (WooCommerce swaps the field for a hidden
   * input on a country whose address format has no state), the region is
   * appended to the city rather than dropped: losing it silently would strip a
   * real part of the buyer's address.
   *
   * @param {string} role
   * @param {*} region
   * @returns {void}
   */
  setRegion(role, region) {
    const value = twoincUtilHelper.blankToEmpty(region);
    if (!value) return;

    const $state = jQuery(twoincAddressRoles.field(role, "state"));
    if ($state.is("select")) {
      const wanted = value.trim().toLowerCase();
      let matched = null;
      $state.find("option").each(function () {
        const $option = jQuery(this);
        if (!$option.attr("value")) return;
        const text = twoincUtilHelper.blankToEmpty($option.text()).toLowerCase();
        const id = twoincUtilHelper.blankToEmpty($option.attr("value")).toLowerCase();
        if (text === wanted || id === wanted) matched = $option.attr("value");
      });
      if (matched !== null) {
        $state.val(matched).trigger("change");
        return;
      }
      Twoinc.getInstance().appendRegionToCity(role, value);
      return;
    }

    // A hidden input is WooCommerce's marker for "this country's address
    // format has no state field"; a visible text input is a free-text county
    // the region can simply be written into.
    if ($state.length && $state.attr("type") !== "hidden") {
      $state.val(value);
      return;
    }

    Twoinc.getInstance().appendRegionToCity(role, value);
  }

  /**
   * Append a region to the city, comma-separated, unless it is already there.
   *
   * @param {string} role
   * @param {string} region
   * @returns {void}
   */
  appendRegionToCity(role, region) {
    const $city = jQuery(twoincAddressRoles.field(role, "city"));
    if (!$city.length) return;
    const city = twoincUtilHelper.blankToEmpty($city.val());
    if (city.toLowerCase().endsWith(region.toLowerCase())) return;
    $city.val(city ? city + ", " + region : region);
  }

  /**
   * Blank the address fields a captured company's registry address wrote
   * (TWO-40 §2.6).
   *
   * Split out from `setAddress()`, which now means "write what this payload
   * carries" and therefore deliberately leaves line 2 alone when the payload
   * says nothing about it. Clearing has the opposite requirement — a line 2
   * the registry wrote for the OUTGOING company must not survive — so it is
   * its own function rather than a magic empty payload.
   *
   * The state/county control is left alone: it belongs to the country, not to
   * the company, and the country is not what is being cleared here.
   *
   * @returns {void}
   */
  clearAddress() {
    const role = twoincAddressRoles.invoice();
    ["address_1", "address_2", "city", "postcode"].forEach(function (name) {
      jQuery(twoincAddressRoles.field(role, name)).val("");
    });
    twoincAddressMirror.sync();
    jQuery(document.body).trigger("update_checkout");
  }

  /**
   * Get the actual due in days to display on page
   */
  getDueInDays() {
    if (
      !Twoinc.getInstance().customerCompany ||
      !Twoinc.getInstance().customerCompany.organization_number ||
      !Twoinc.getInstance().customerCompany.country_prefix
    )
      return;

    let params = {
      merchant_id: window.twoinc.merchant?.id,
      merchant_short_name: window.twoinc.merchant?.short_name,
      buyer_organization_number: Twoinc.getInstance().customerCompany.organization_number,
      country_prefix: Twoinc.getInstance().customerCompany.country_prefix
    };

    // Create a get due in days request
    const dueInDaysResponse = jQuery.ajax({
      url: twoincUtilHelper.constructTwoincUrl("/v1/payment_terms", params),
      dataType: "json",
      method: "GET"
    });

    dueInDaysResponse.done(function (response) {
      window.twoinc.custom_due_in_days = typeof response.due_in_days !== "undefined";

      Twoinc.getInstance().toggleDueInDays();
    });

    dueInDaysResponse.fail(function (response) {
      Twoinc.getInstance().toggleDueInDays();
    });
  }

  /**
   * Display due in days only if the buyer does not have custom payment term
   */
  toggleDueInDays() {
    if (window.twoinc.custom_due_in_days) {
      jQuery(".payment-term-number").hide();
      jQuery(".payment-term-nonumber").show();
    } else {
      jQuery(".payment-term-nonumber").hide();
      jQuery(".payment-term-number").show();
    }
  }

  /**
   * Handle the woocommerce updated checkout event
   */
  onUpdatedCheckout() {
    // RECORD the billing country, and nothing else (TWO-24867). A re-render
    // can move the field with no `change` event — a `checkout_error`
    // re-render, a multi-step theme, a session address restored server-side —
    // and without this the tracker would hold the pre-re-render country for
    // the rest of the page, so a later genuine switch BACK to that value
    // would read as no change and be swallowed.
    //
    // Deliberately NOT `syncBillingCountry()`. These re-renders restore the
    // country and the company together, so clearing the capture here would
    // destroy what the same re-render just put back — the TWO-25326 failure
    // on a new trigger. Throwing away a captured company needs the buyer's
    // gesture, and the `change` event is the only signal of one there is.
    //
    // Record-only is still not the whole answer, though: a country that moved
    // to something the captured company does not belong to left that company
    // captured and approved, and the mismatch surfaced as an opaque
    // order-creation failure. `clearCompanyIfCountryStale` below is the
    // discriminator for that — it fires on the countries DISAGREEING, not on
    // the country having moved, so it stays silent on the restore-together
    // case above (TWO-25333).
    const movedCountry = twoincSelectWooHelper.currentCountry();
    if (twoincSelectWooHelper.countryDidChange(movedCountry)) {
      // Invalidating in-flight work IS safe here, though, and record-only
      // would otherwise leave a hole: on this path nothing bumps either
      // counter, so a company-search response or a registry address for the
      // OUTGOING country could still land — and the address guard's own
      // country comparison does not cover it either, since an empty reading
      // on either side (the field mid-replacement, which is exactly what this
      // path is about) waves the response through by design.
      //
      // Purely destructive-to-pending, never to captured state: it discards
      // answers to questions asked under a country that is no longer
      // selected, which is not something the buyer can lose.
      twoincSelectWooHelper.companySearchSeq += 1;
      Twoinc.getInstance().addressLookupSeq += 1;

      // BEFORE updateElements() below, which is what re-runs getApproval().
      // getApproval() does not fire immediately — it arms a 1s interval — so
      // the ordering is not what stops the stale pair being posted, and no
      // test pins it as though it were. It is here because clearing before the
      // approval pass is the only order in which `updateElements` sees the
      // state that the rest of this event's work should be derived from.
      Twoinc.getInstance().clearCompanyIfCountryStale(movedCountry);
    }

    Twoinc.getInstance().updateElements();

    // Payment-method-switch handling moved to a single namespaced, delegated
    // binding in `initialize()` (TWO-25326 bugfix) — bound once, before the
    // buyer's first click, rather than re-registered (with no `.off()`, so it
    // duplicated) on every `updated_checkout`. See that binding's own doc
    // comment for the live bug this closes.

    twoincDomHelper.rearrangeDescription();

    twoincTermChips.refresh();
    twoincSoleTrader.refresh();

    // TWO-25326 §7.1, hardened round 2026-08-03: called directly here, not
    // only via `toggleBusinessFields()`. `updated_checkout` (this handler)
    // fires on every WooCommerce checkout AJAX refresh — a shipping-method
    // change, a coupon apply, a quantity change — not only the
    // payment-method/gestured-country switches that call
    // `toggleBusinessFields()`. The server just re-rendered a fresh, empty
    // `.twoinc-company-search-tile-slot` as part of that same refresh (see
    // `detachCompanySearchTileWrapperToSafety`, paired on `update_checkout`,
    // for why the wrapper survived the refresh to be moved back in here at
    // all), and every one of those triggers needs it re-populated, not just
    // the two `toggleBusinessFields()` already covered.
    twoincSelectWooHelper.syncCompanySearchTileLocation();

    // WooCommerce re-renders the shipping fields as part of this same refresh
    // (revealing "Ship to a different address?" is one of the triggers), so a
    // delivery form that has just appeared, or just been replaced, needs the
    // mirror re-asserted against it (TWO-40 §2). A no-op once the buyer has
    // taken that address over.
    twoincAddressMirror.sync();
  }

  /**
   * Handle the company manual input changes
   *
   * @param event
   */

  onCompanyManualInputBlur(event) {
    const $input = jQuery(this);

    let inputName = $input.attr("name");

    if (inputName === "company_id") {
      const typed = $input.val();
      // Only when the blur actually MOVED the number (TWO-25333 — see the
      // picker's select handler for why the number and the country have to be
      // written together). This is a BLUR, not a change: tabbing through an
      // untouched `#company_id` fires it too, and re-pinning there would
      // launder a stale pair into a consistent-looking one. The number would
      // still be the previous country's company while `country_prefix` was
      // rewritten to the country the form has since moved to, and
      // `clearCompanyIfCountryStale` could never fire on it again. Pinning only
      // a number the buyer actually entered keeps the witness tied to a
      // capture rather than to a keystroke that passed through.
      // Normalised on both sides, and requiring a value: `organization_number`
      // is seeded null by the constructor and written from parsed JSON by the
      // sole-trader prefill, so a raw `!==` reads the number 123456789 as
      // different from the string "123456789" and re-pins on a blur that moved
      // nothing — reopening the laundering this guard exists to close, through
      // a type mismatch. And a blur on an EMPTY untouched field would otherwise
      // count as movement ("" !== null), pinning a country onto a capture that
      // does not exist; inert today, but it makes the witness look
      // authoritative to the next reader, which is how this class of bug got
      // here.
      const previousNumber = twoincUtilHelper.blankToEmpty(
        Twoinc.getInstance().customerCompany.organization_number
      );
      const numberMoved = twoincUtilHelper.blankToEmpty(typed) !== previousNumber;
      // Stored RAW, deliberately. Normalising on the way in was written here
      // first, to remove the asymmetry between this one writer and the readers
      // that all normalise — and then reverted, because it would have changed
      // the organisation number this plugin POSTS on the order intent
      // (`customerCompany` goes into `buyer.company` verbatim in getApproval),
      // which is a behaviour change nothing in this ticket asked for. No test in
      // this suite distinguishes the two, and that is a consequence of the
      // choice rather than a justification for it — a test trivially could,
      // by asserting the stored value keeps its padding. The record may hold an
      // unnormalised value; that is precisely why every comparison against it
      // goes through `blankToEmpty` rather than trusting its shape.
      Twoinc.getInstance().customerCompany.organization_number = typed;
      if (numberMoved && twoincUtilHelper.blankToEmpty(typed)) {
        Twoinc.getInstance().customerCompany.country_prefix =
          twoincSelectWooHelper.currentCountry();
      }
    } else if (inputName === "billing_company_display") {
      Twoinc.getInstance().customerCompany.company_name = $input.val();
    }

    twoincSelectWooHelper.renderCompanySummary();
    Twoinc.getInstance().getApproval();
  }

  /**
   * Handle the representative input changes
   *
   * @param event
   */

  onRepresentativeInputBlur(event) {
    const $input = jQuery(this);

    let inputName = $input.attr("name").replace("billing_", "");

    if (inputName === "phone") inputName += "_number";

    Twoinc.getInstance().customerRepresentative[inputName] = $input.val();

    Twoinc.getInstance().getApproval();
  }

  /**
   * Handle the country input changes
   *
   * @param event
   */

  onCountryInputChange() {
    Twoinc.getInstance().syncBillingCountry();
  }

  /**
   * Bring everything that depends on the billing country back into step with
   * the field (TWO-24867). Reached only from the `change` handler on
   * #billing_country — that event is the closest thing this checkout has to a
   * buyer gesture on the country.
   *
   * Everything destructive lives behind that gesture on purpose. WooCommerce
   * can also move the country with no `change` at all — a `checkout_error`
   * re-render, a multi-step theme, a session address restored server-side —
   * and it is tempting to run this from `updated_checkout` so the tracker
   * cannot drift. It must NOT: those re-renders restore the country and the
   * company TOGETHER, so clearing on them destroys data the same re-render
   * just put back, which is the TWO-25326 failure again on a new trigger.
   * `onUpdatedCheckout` therefore only RECORDS the country (see there); the
   * tracker still cannot drift, and nothing is thrown away without a gesture.
   */
  syncBillingCountry() {
    const country = twoincSelectWooHelper.currentCountry();
    const changed = twoincSelectWooHelper.countryDidChange(country);

    // Unconditional, and BEFORE the guard below. This pass is idempotent —
    // it re-derives which company fields should be visible and required from
    // the current state and writes nothing the buyer typed — and the events
    // the guard now swallows are exactly the ones that just re-rendered the
    // billing fields underneath it (core's address-i18n.js re-sorts them on
    // `country_to_state_changing`). Gating it behind the guard along with
    // everything else would have turned this fix into a field-visibility
    // regression on every such re-render (TWO-24867).
    twoincDomHelper.toggleBusinessFields();

    // Everything past here is destructive, so only a REAL country change gets
    // to run it (TWO-25326 — see countryDidChange for the events this
    // swallows). The rest of what this handler used to do on those events is
    // already re-run by `onUpdatedCheckout`: sole-trader availability and the
    // approval check both go through it.
    if (!changed) {
      return;
    }

    const self = Twoinc.getInstance();

    // Invalidate everything already in flight under the OUTGOING country
    // (TWO-24867). Neither of these responses can be allowed to land:
    //
    //  - a company search would repopulate the picker with the previous
    //    country's register, next to a field this handler is about to clear;
    //  - an address lookup would write the previous country's registry
    //    address over the cleared address fields, and set
    //    registryAddressApplied on it.
    //
    // Both are supersession counters rather than aborts on purpose: the
    // network request may already have completed, so cancelling it is not
    // enough — the guard has to sit on the handler.
    twoincSelectWooHelper.companySearchSeq += 1;
    self.addressLookupSeq += 1;
    // The order-intent request is retired on this path too, but NOT from here
    // (review round 5). An explicit `supersedeInFlightOrderIntent()` was added
    // here first and no mutation could kill it: `clearSelectedCompany()` below
    // resets `customerCompany` wholesale, so the `self.getApproval()` at the end
    // of this function finds an incomplete form and retires the in-flight request
    // through its own readiness guard. Keeping a second, unreachable copy of that
    // would be a line no test can distinguish from its absence. The OUTCOME — a
    // response for the outgoing country cannot paint — is asserted in
    // tests/js/intent-loading-state.test.js.
    // The company-search SPINNER, below — belt and braces, and DELIBERATELY not
    // covered by a test: there is no reachable case that fails without it today,
    // so a test asserting the spinner is gone afterwards would pass either way and
    // be worse than none. The reasoning for keeping the line anyway: the transport hands
    // the spinner off to whichever request is newest, so bumping the counter
    // above orphans the one an in-flight search is showing (its `always()`
    // now sees a stale sequence and returns before hiding it). What actually
    // clears it is `clearSelectedCompany()` below re-attaching the widget and
    // taking the dropdown — and the spinner node inside it — with it. That is
    // an incidental consequence of an unrelated call, not a guarantee.
    twoincSelectWooHelper.toggleCompanySearchSpinner(false);

    // Skipped entirely while sole-trader mode owns the field (round-3
    // review — Han): this rebuilds the search widget and wipes
    // `#company_id`/`#billing_company` via `twoincCompanyCapture.write()`
    // unconditionally — including a company already ADOPTED this
    // sole-trader session, and including the dropdown a flight/popup wait
    // is deliberately keeping alive (the whole point of round 1). Neither
    // is what an ordinary company search/address lookup being invalidated
    // by a country change means here, and `mode` itself was left stranded
    // at `sole_trader` afterwards with nothing left in the fields to match
    // it. `refresh()` below (sole-trader availability, re-evaluated for the
    // new country) is what decides whether to revert — via `hide()`'s own
    // `isBusy()` guard — once there is something to decide from.
    if (twoincSoleTrader.mode !== "sole_trader") {
      twoincSelectWooHelper.clearSelectedCompany();
    }

    // AFTER clearSelectedCompany, deliberately: that function resets
    // `customerCompany` to {} wholesale, so setting the country prefix before
    // it (as this used to) discarded it immediately and left getApproval()
    // below — and getDueInDays(), which early-returns without one — running
    // on an undefined country for the three seconds until the deferred
    // re-read inside clearSelectedCompany put it back (TWO-24867).
    self.customerCompany.country_prefix = country;

    // Sole trader availability is per-country; re-evaluate the toggle.
    twoincSoleTrader.refresh();

    self.getApproval();
  }

  /**
   * Drop a captured company that belongs to a country the checkout has since
   * moved away from (TWO-25333).
   *
   * The gap this closes. `onUpdatedCheckout` records a country that moved with
   * no `change` event and deliberately does NOT clear the capture, because
   * those re-renders restore the country and the company together and
   * clearing would destroy what the re-render just put back (TWO-24867 /
   * TWO-25326 — see there). But when the country really did move to something
   * the captured company does not belong to, that company survived and
   * nothing downstream caught it: `getApproval()` posts `customerCompany`
   * carrying the OLD `country_prefix` next to the OLD organisation number, so
   * the pair is internally consistent and the intent check approves it and
   * the buyer sees a green payment method; the order payload then pairs that
   * `company_id` with the ORDER's billing country with no consistency check
   * between the two. The mismatch reached the Two API at order creation and
   * came back as an opaque failure the buyer could not act on.
   *
   * Discriminating rather than choosing between "always clear" and "never
   * clear" is what keeps this from being TWO-25326 again: in the
   * restore-together case the recorded country and the captured company's own
   * country agree by construction, because the same re-render supplied both,
   * so this stays silent exactly where clearing would be destructive.
   *
   * Called only from `onUpdatedCheckout`. The `change` path
   * (`syncBillingCountry`) already clears unconditionally on a real country
   * change, which is strictly stronger, so running this there as well would
   * be dead code rather than extra safety.
   *
   * Three readings are NOT grounds to clear, and none of them is incidental:
   *
   *   - No organisation number on `customerCompany`. A company name with no
   *     id is not a capture (TWO-25326 §6: the payment method is usable only
   *     for a company captured WITH an id), and there is nothing about a bare
   *     name that a country change invalidates.
   *
   *     KNOWN RESIDUAL GAP, not closed here. `customerCompany` is populated
   *     from the DOM on a timer, so `#company_id` can hold a real capture
   *     while this object still holds nulls — during `initialize()`'s deferred
   *     seed, and for the three seconds after `clearSelectedCompany`. A silent
   *     country move inside one of those windows is missed, and the deferred
   *     re-read then pairs the old country's company with the new country via
   *     `getCompanyData()`, which reads `#billing_country` live and so
   *     UN-PINS the witness — leaving a self-consistent false pair nothing can
   *     detect afterwards. The country is not the only half `getCompanyData()`
   *     unpairs: it also sources the name from `getCompanyName()`, which in
   *     company-search mode reads the `checkoutInputs` sessionStorage snapshot
   *     rather than the DOM, so the name comes from a third moment again.
   *     Benign in both windows as things stand, because `organization_number`
   *     is empty there and every downstream guard refuses on that — but the
   *     gap is two-axis, not one, and a later reader should not conclude the
   *     name half is sound. Falling back to `#company_id` here would not help:
   *     the DOM has no per-company country to compare against, which is why
   *     the witness has to live in JS state at all. Closing it properly means
   *     stopping the DOM re-reads from overwriting a pinned `country_prefix`,
   *     which is a change to `getCompanyData()`'s contract and its several
   *     other callers — deliberately left for its own ticket rather than
   *     widened into this one.
   *   - An unknown country on either side. `country_prefix` is null until the
   *     first capture or DOM re-read, and an empty field reading means the
   *     field was mid-replacement — the same rule the address-lookup guard
   *     and `countryDidChange` already apply, for the same reason: only two
   *     countries that are both KNOWN and DIFFERENT are evidence of anything.
   *   - The DOM already holding a DIFFERENT company from the one recorded.
   *     Then it is the record that is stale, not the fields: `customerCompany`
   *     is refreshed from the DOM on a timer, so a re-render that swapped in
   *     another saved address — country AND company together, a different pair
   *     but a self-consistent one — reaches here with the previous capture
   *     still in JS state. Clearing on that would destroy the company the
   *     re-render had just restored, which is precisely the regression this
   *     ticket must not reintroduce. Re-sync to the DOM instead.
   *
   * Compared case-insensitively because the two sides are written by
   * different readers: `currentCountry()` upper-cases, `getCompanyData()`
   * reads `#billing_country` raw (the inconsistency noted in the comment on
   * `currentCountry`, still not swept up here). WooCommerce's country values
   * are upper-case ISO codes today, so this normalisation is guarding the
   * comparison against that known disagreement rather than against observed
   * mixed-case data — a false positive here is a destructive clear.
   *
   * Returns nothing on purpose. It reported whether it had cleared, the only
   * caller ignored it, and flipping the value broke no test — an unverified
   * contract stated in a docblock is worse than none.
   *
   * @param {string} country upper-cased ISO code the checkout has moved to
   * @returns {void}
   */
  clearCompanyIfCountryStale(country) {
    const company = this.customerCompany || {};
    if (!company.organization_number) return;

    const capturedCountry = twoincUtilHelper.blankToEmpty(company.country_prefix).toUpperCase();
    // `!country` is unreachable from the only caller today and no test covers
    // it: `countryDidChange` already returns false on an empty reading, so this
    // is never entered with one. Kept as the guard a second caller would need,
    // and said out loud so the docblock's "an unknown country on either side"
    // is not read as two tested readings when only the captured side is.
    if (!country || !capturedCountry || capturedCountry === country) return;

    // Every comparison below goes through `blankToEmpty`, which normalises
    // null/undefined to "" and coerces to a trimmed string. Not defensive
    // noise: `organization_number` is seeded null by the constructor and
    // written from parsed JSON by the sole-trader prefill, so it is not
    // guaranteed to be a string, while `.val()` always is. A raw `!==` between
    // the number 123456789 and the string "123456789" is true, and every
    // comparison here treats "different" as evidence — so an un-normalised
    // compare turns a type mismatch into either a laundered stale pair or a
    // destructive clear of a valid capture.
    const domNumber = twoincUtilHelper.blankToEmpty(jQuery("#company_id").val());
    const domName = twoincUtilHelper.blankToEmpty(jQuery("#billing_company").val());
    const recordedNumber = twoincUtilHelper.blankToEmpty(company.organization_number);
    const recordedName = twoincUtilHelper.blankToEmpty(company.company_name);

    // The DOM holds a DIFFERENT company than the record: BOTH halves present
    // and BOTH diverged. Then it is the record that is stale rather than the
    // fields — a re-render swapped in another saved address, country and
    // company together, a different pair but a self-consistent one — and
    // clearing would destroy what that re-render just restored.
    //
    // Both halves, and both non-empty, is the whole discriminator. Requiring
    // only the number to diverge was fail-OPEN: a buyer typing into
    // `#company_id` without blurring produces the same divergence, and this
    // branch then pinned the new country onto a number no capture path had
    // witnessed, next to the PREVIOUS company's name — a two-moment pair made
    // self-consistent, which is the exact defect this function exists to catch.
    //
    // What the rule actually tests is "both mirrors changed", not "restore
    // versus keystroke" — the two are not the same thing and the difference
    // matters to whoever reads this next. A genuine restore of a DIFFERENT
    // company that happens to carry the SAME name (group entities trading
    // under one name) reads as one mirror moving and is cleared. Accepted:
    // rare, fail-closed, and the buyer re-picks.
    //
    // The rule holds on WooCommerce's own re-render paths because `#company_id`
    // is a registered billing field (`$fields['billing']['company_id']` in
    // WC_Twoinc_Checkout), so it lives in the same billing fragment as
    // `#billing_company` and every WC-driven re-render writes both from the
    // same vintage. One mirror moving alone is therefore evidence of something
    // other than a re-render.
    //
    // Anything else falls through to the clear, deliberately fail-CLOSED. In
    // particular a diverged number with an EMPTY `#billing_company` is NOT
    // trusted: taking the name from the record instead would pair company A's
    // name with company B's number, and writing the empty name through would
    // leave `isReadyApprovalCheck()` refusing forever — this branch arms no
    // deferred re-read, and the next re-render would see a self-consistent
    // pair and never fire again, so the payment method would be stuck unusable
    // with no way back. A clear is recoverable; that is not.
    //
    // Read field by field rather than through `getCompanyData()`, which is what
    // this did first and which was wrong on the half that matters: in
    // company-search mode that takes the name from `getCompanyName()`, and that
    // does not read the DOM at all — it reads the `checkoutInputs`
    // sessionStorage snapshot, refreshed only by `saveCheckoutInputs()`'s own
    // interval. So the name came from a different moment than the number and
    // the country. `#billing_company` is the right source here: the field
    // WooCommerce posts, the mirror a restore writes, and the one
    // `clearSelectedCompany` and `enterManualCompanyEntry` already treat as
    // authoritative.
    //
    // Normalising is load-bearing on ALL FOUR values, not defence in depth — an
    // earlier version of this comment claimed the name condition made the
    // recorded number's normalisation unreachable, and that was wrong twice
    // over, so each of the four now has its own test. Reachable ways a value
    // diverges from its counterpart by representation alone, while the other
    // mirror has genuinely moved:
    //
    //   - Type. `twoincSoleTrader.setCompany()` writes the organisation number
    //     straight out of parsed JSON, so the record can hold the NUMBER
    //     123456789 while `#company_id` holds the string "123456789". Add a
    //     re-render that rewrote `#billing_company` and left the plugin's own
    //     `#company_id` alone, and an un-normalised compare takes the re-sync
    //     branch and launders a GB-captured number into a self-consistent ES
    //     pair.
    //   - Whitespace, on either side and in either direction. The record picks
    //     it up because the manual blur handler stores what the field holds;
    //     the DOM picks it up from a paste into `#company_id` or a trailing
    //     space typed into `#billing_company` with no blur behind it.
    //
    // Not normalised, and equivalent by construction: `capturedCountry`. It is
    // compared against a value `currentCountry()` produced, and WooCommerce's
    // country values are unpadded upper-case ISO strings on both sides — the
    // `.toUpperCase()` there is about the two READERS disagreeing, which is a
    // real difference and is tested.
    //
    // `country_prefix: country` rather than a fresh `currentCountry()` read is
    // also indistinguishable today — the caller took `country` from that same
    // reader on this same tick. Written as the argument anyway, so the value
    // this pairs the company with is provably the one the change was detected
    // against rather than whatever the field says by the time this line runs.
    //
    // Also equivalent by construction, recorded so the next reader does not
    // "fix" it into a difference: `company_name: domName` needs no fallback.
    // The condition guarantees `domName` is non-empty, so
    // `domName || recordedName` is dead — and worse than dead, because falling
    // back to the record's name would pair company A's name with company B's
    // number, the two-moment pair this whole function exists to prevent.
    if (domNumber && domName && domNumber !== recordedNumber && domName !== recordedName) {
      this.customerCompany = {
        company_name: domName,
        country_prefix: country,
        organization_number: domNumber
      };
      return;
    }

    // No supersession bump here, deliberately. `clearSelectedCompany()` below
    // empties the fields, so a company search or a registry address issued
    // under the outgoing country must not land on top of them afterwards — but
    // the only caller has already bumped both counters, unconditionally on the
    // country having moved, before it reaches this. A defensive repeat was
    // written here first and then removed: it changed nothing observable, so no
    // test could hold it in place, and an untestable line that reads as the
    // guarantee is worse than the guarantee living plainly at the one call
    // site. A second caller would have to bump them too, and its own test for
    // that is what would say so.
    twoincSelectWooHelper.clearSelectedCompany();

    // AFTER clearSelectedCompany, for the reason spelled out in
    // syncBillingCountry: it resets `customerCompany` to {} wholesale, so an
    // assignment made before it is dropped and leaves getApproval() and
    // getDueInDays() with no country for the three seconds until its deferred
    // re-read runs.
    this.customerCompany.country_prefix = country;
  }
}

let instance = null;
let isTwoincSelected = null;
jQuery(function () {
  if (window.twoinc) {
    // WooCommerce core's own radio-click handler for payment method
    // selection (checkout.js payment_method_selected) calls
    // e.stopPropagation() and only fires a bare `payment_method_selected`
    // event on document.body — it never triggers `update_checkout`. This
    // gateway's buyer surcharge fee (apply_cart_fee) is conditional on
    // which payment method is currently chosen, so without an explicit
    // recalculation trigger here the fee neither appears when switching
    // TO this gateway nor disappears when switching AWAY from it, until
    // something unrelated (e.g. a term-chip click) happens to fire
    // update_checkout first. Bound once at page load; WC fires
    // payment_method_selected only when the checked radio actually
    // changes, so this does not cause extra recalculations on unrelated
    // re-renders.
    jQuery(document.body).on("payment_method_selected", function () {
      jQuery(document.body).trigger("update_checkout");
    });

    if (window.twoinc.enable_order_intent === "yes") {
      const initIfGatewayPresent = function () {
        if (jQuery("#payment_method_" + window.twoinc.gateway_id).length > 0) {
          // Run Twoinc code if order intent is enabled
          Twoinc.getInstance().initialize(true);
          return true;
        }
        return false;
      };
      if (!initIfGatewayPresent()) {
        // The gateway can be absent at page load yet appear later: the
        // server-side availability gate re-evaluates per order-review
        // refresh (basket total crossing the platform minimum, billing
        // country change). The old one-shot check left company search
        // unwired for the whole session. Re-check on every
        // updated_checkout; and when company search is enabled for other
        // methods — the same "Enable company search in address entry"
        // checkbox, no separate setting any more (TWO-25326) — wire it
        // immediately: that state exists precisely for checkouts where this
        // gateway isn't offered.
        if (
          // Admin's address-area preference, not the buyer-driven capture
          // mode — see the comment on the equivalent check in
          // toggleBusinessFields (TWO-25326 §7.1).
          window.twoinc.company_search_location === "address_area"
        ) {
          Twoinc.getInstance().initialize(true);
        } else {
          const $body = jQuery(document.body);
          const retryInit = function () {
            // initialize(false): the load-time saved-input replay must not
            // run mid-session — replaying stored radio/checkbox clicks
            // TOGGLES state the buyer set after page load.
            if (jQuery("#payment_method_" + window.twoinc.gateway_id).length > 0) {
              Twoinc.getInstance().initialize(false);
              $body.off("updated_checkout", retryInit);
            }
          };
          $body.on("updated_checkout", retryInit);
        }
      }
    } else {
      // Handle initialization every time order review (right panel) is updated
      jQuery(document.body).on("updated_checkout", function () {
        // If shop defaults payment method to Twoinc, run Twoinc code
        if (twoincDomHelper.isTwoincSelected()) {
          Twoinc.getInstance().initialize(false);
          Twoinc.getInstance().onUpdatedCheckout();
        }

        // Run Twoinc code if Twoinc payment is selected
        jQuery("#payment_method_" + window.twoinc.gateway_id).on("change", function () {
          Twoinc.getInstance().initialize(false);
          Twoinc.getInstance().onUpdatedCheckout();
        });
      });

      // If last selected payment method is Twoinc, run Twoinc code anyway
      let lastSelectedPayment = twoincDomHelper.getCheckoutInput(
        "INPUT",
        "radio",
        "payment_method"
      );
      if (
        lastSelectedPayment &&
        lastSelectedPayment.id === "payment_method_" + window.twoinc.gateway_id
      ) {
        Twoinc.getInstance().initialize(true);
      }

      // Otherwise do not run Twoinc code
    }

    // Nothing to relocate or hide here any more (TWO-25288): the manual-entry
    // row is created inside the results list only while it should be visible,
    // and the link back to search is created hidden, in place, on first use.

    setTimeout(function () {
      // Init the hidden Company name field
      const companyName = twoincSelectWooHelper.getCompanyName().trim();
      if (companyName) {
        jQuery("#billing_company").val(companyName);
      }
    }, 1000);
  }
});
