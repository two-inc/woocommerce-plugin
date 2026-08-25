let twoincUtilHelper = {
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
   * Normalise a checkout value to displayable text: null/undefined/whitespace-only -> ""
   * (TWO-25288). Whitespace-only matters because the company picker's empty option
   * label is a non-breaking space, which is otherwise truthy and invisible; `trim()`
   * covers it since its whitespace definition includes U+00A0.
   */
  blankToEmpty: function (value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  },

  /**
   * Prefix marking an organisation number as internally minted by sole-trader
   * enrollment rather than issued by a company registry (TWO-25326 §12) — a
   * protocol value, not something a buyer's own authorities would recognise,
   * so it must never be shown to them. Matched as a literal, case-sensitive
   * prefix only the backend mints; a real number merely containing these
   * characters elsewhere is not synthetic.
   */
  SYNTHETIC_NUMBER_PREFIX: "TWO:",

  /**
   * Whether an organisation number is internally minted and must not be shown
   * (TWO-25326 §12). Empty is NOT synthetic — "no number yet" is a different
   * state from "must not be shown".
   */
  isSyntheticCompanyNumber: function (value) {
    return twoincUtilHelper
      .blankToEmpty(value)
      .startsWith(twoincUtilHelper.SYNTHETIC_NUMBER_PREFIX);
  },

  /**
   * Organisation number for DISPLAY only (TWO-25326 §12): "" for a synthetic
   * identifier, so any "is there a number" truthiness check doubles as
   * suppression. The raw value still goes to `#company_id`, instance state
   * and the order-intent payload — only rendering to a human is filtered.
   */
  formatCompanyNumber: function (value) {
    if (twoincUtilHelper.isSyntheticCompanyNumber(value)) return "";
    return twoincUtilHelper.blankToEmpty(value);
  },

  /**
   * Compose "<label> (<number>)", number filtered through formatCompanyNumber
   * (TWO-25326 §12). When the number resolves to nothing, the label is
   * returned bare rather than with empty parens.
   *
   * `label` is passed through untouched (not blank-collapsed): callers
   * disagree on contract — intent notices pass plain text for `.text()`,
   * the search dropdown passes pre-highlighted HTML for innerHTML.
   */
  composeCompanyLabel: function (label, value) {
    const number = twoincUtilHelper.formatCompanyNumber(value);
    return label && number ? label + " (" + number + ")" : label;
  },

  /** composeCompanyLabel for a plain-text company name (TWO-25326 §12). */
  formatCompanyLabel: function (name, value) {
    return twoincUtilHelper.composeCompanyLabel(twoincUtilHelper.blankToEmpty(name), value);
  },

  /**
   * Construct url to Twoinc checkout api. `client`/`client_v` identify plugin
   * + version for the company-search endpoint (the only attribution
   * available, since the request runs in the buyer's browser); kept in the
   * query string rather than a header to avoid a CORS preflight per keystroke.
   *
   * `params` may be a plain object or URLSearchParams — normalise to
   * URLSearchParams first since `new URLSearchParams(obj)` copies entries,
   * not JS properties, and would silently drop fields from an existing one.
   */
  constructTwoincUrl: function (path, params) {
    const searchParams = new URLSearchParams(params || {});
    searchParams.set("client", window.twoinc.client_name);
    searchParams.set("client_v", window.twoinc.client_version);
    return window.twoinc.twoinc_checkout_host + path + "?" + searchParams.toString();
  },

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
 * Which checkout address plays which ROLE — invoice/billing vs
 * delivery/shipping, never "primary/secondary" (TWO-40 §1). WooCommerce is
 * billing-first (`#billing_*` is both the always-shown form and the invoice
 * role); PrestaShop/Magento/Hyvä are shipping-first, so "the primary form"
 * ports wrong in both directions while a ROLE ports cleanly.
 *
 * All country/company reads feeding sole-trader chip visibility, signup/
 * token-mint calls and the address mirror go through here so they can't
 * resolve the role independently and disagree (documented root cause of
 * several PrestaShop bugs this ports from).
 *
 * The payment tile has no address fields of its own, so it reads
 * `invoice()` explicitly rather than "whichever form is on screen".
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

  /** `#`-prefixed selector of one field on a role's form. */
  field: function (role, name) {
    return "#" + role + "_" + name;
  },

  /** Live (not saved/session) value of one field on a role's form, trimmed. */
  value: function (role, name) {
    return (jQuery(twoincAddressRoles.field(role, name)).val() || "").trim();
  }
};

/**
 * Mirror the invoice address onto the delivery address until the buyer edits
 * the delivery address themselves (TWO-40 §2). Never locked/read-only —
 * rejected on the platform this ports from because of a real case (one legal
 * entity in Northern Ireland with a branch in the Republic: a genuinely
 * different valid country/company pairing on the second address).
 *
 * "Edited" is a pure content-match check against what this mirror last wrote,
 * not a flag set by UI events: one field disagreeing pins the WHOLE delivery
 * address (per-field granularity was rejected — editing one line means
 * editing the address). Because the check is pure content there's no
 * explicit "resume sync" control: clearing the fields back out re-matches and
 * resumes on its own. A field left EMPTY still counts as synced, so a
 * freshly-revealed "Ship to a different address?" form mirrors instead of
 * reading as buyer-edited.
 *
 * Org number/company are required on the invoice-role address only (§2.7),
 * which on WooCommerce is the always-shown `#billing_*` form — unlike
 * shipping-first platforms, WooCommerce can never hide the address that
 * legally needs them, so nothing here adds a required cue to a delivery field.
 */
let twoincAddressMirror = {
  /**
   * Fields this mirror writes/watches. `address_2` and `state` are included
   * deliberately — a buyer typing into either is as strong an edit signal as
   * the city.
   */
  MIRRORED_FIELDS: ["company", "country", "address_1", "address_2", "city", "postcode", "state"],

  /** Provenance record the pin check compares against. `null` until seeded. */
  written: null,

  /** Re-entrancy guard: our own writes must not be read as buyer edits. */
  writing: false,

  /** Trimmed, case-insensitive comparison form. */
  normalize: function (value) {
    return twoincUtilHelper.blankToEmpty(value).trim().toLowerCase();
  },

  /**
   * Seed the provenance record from the invoice address, so a delivery form
   * WooCommerce already prefilled to match (a logged-in buyer's saved
   * shipping address) reads as synced rather than buyer-edited.
   */
  seed: function () {
    const invoice = twoincAddressRoles.invoice();
    twoincAddressMirror.written = {};
    twoincAddressMirror.MIRRORED_FIELDS.forEach(function (name) {
      twoincAddressMirror.written[name] = twoincAddressRoles.value(invoice, name);
    });
  },

  /**
   * Whether the delivery address is part of this order at all. WooCommerce
   * keeps shipping fields in the DOM permanently, gated on "Ship to a
   * different address?"; unchecked, it ignores them on submit and uses
   * billing — writing into them then would be a payment gateway silently
   * rewriting a form with no bearing on the order. Absence of the checkbox
   * means the theme always shows the form, so that's in-play. Checking the
   * box fires WooCommerce's own checkout update, which re-runs this via
   * `updated_checkout`, so the form fills the moment it starts to matter.
   */
  deliveryFormIsInPlay: function () {
    const $toggle = jQuery("#ship-to-different-address-checkbox");
    return $toggle.length === 0 || $toggle.is(":checked");
  },

  /** Whether the buyer has taken the delivery address over. */
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
   * Country is written first with a `change` event, because WooCommerce
   * core's address-i18n.js rebuilds the state control (select/text/absent)
   * off that event, and the state write below must land on whatever control
   * that rebuild produces.
   */
  sync: function () {
    if (twoincAddressMirror.writing) return false;
    if (twoincAddressMirror.written === null) twoincAddressMirror.seed();
    const delivery = twoincAddressRoles.delivery();
    // No shipping fields at all (virtual cart, or store that doesn't ship).
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
        // Record what LANDED, not what was intended: a <select> given a value
        // with no matching option keeps its old selection silently, and the
        // delivery country select (store's ship-to list) is exactly that —
        // recording the intended value would make the next pin check see a
        // false buyer edit and pin the mirror for the session.
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
      // A name with no number is not a pair; manual entry captures that.
      twoincCompanyCapture.forgetPairing();
    }

    const instance = Twoinc.getInstance();
    // RAW onto the record, normalised onto the DOM: the record goes verbatim
    // into `buyer.company` on the order intent, so normalising it here would
    // change the org number this plugin POSTS. Comparisons against the
    // record normalise at read time instead.
    instance.customerCompany.company_name = companyName;
    instance.customerCompany.organization_number = companyId;
    // Pin the country alongside the number so the pair can never be assembled
    // from two different moments (TWO-25333); only on a capturing write.
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

  /** Whether a field still holds the value the plugin wrote into it. */
  isPluginWritten: function ($field) {
    return $field.attr(twoincCompanyCapture.PROVENANCE_ATTR) === "1";
  },

  /**
   * Buyer input on the company-name field: drop a now-stale organisation
   * number and the state that depends on it. Bound to `input`/`change`,
   * which only fire for a real buyer edit (plugin writes go through `.val()`,
   * which dispatches no event).
   *
   * Deliberately does NOT wipe the address fields — the registry address is
   * stale but is also the only address on the form, and destroying it
   * mid-keystroke costs more than a stale line. `registryAddressApplied` is
   * cleared instead, tidied up on the next manual-entry switch or country
   * change.
   *
   * @returns {boolean} whether a stale capture was dropped
   */
  guardCompanyRetype: function () {
    const $name = twoincCompanyCapture.nameField();
    const $number = twoincCompanyCapture.numberField();
    const number = twoincUtilHelper.blankToEmpty($number.val());

    // The buyer's own typing, whatever else follows.
    $name.removeAttr(twoincCompanyCapture.PROVENANCE_ATTR);

    // Manual entry captures a name alone by design — nothing stale to drop.
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

    // `#company_id` visibility depends on the value just cleared (TWO-25326
    // §12); the verdict on screen was about the company just uncaptured.
    twoincDomHelper.clearIntentVerdicts();
    twoincDomHelper.toggleBusinessFields();
    twoincSelectWooHelper.renderCompanySummary();
    return true;
  }
};

/**
 * Company-search widget: search/dropdown/manual-entry/select2 lifecycle,
 * encapsulated (TWO-25326 architecture rebuild). Mirrors PrestaShop's
 * TwoCompanySearch — a single class owns the entire lifecycle, exactly one
 * construction site (below, `twoincSelectWooHelper`), never a second
 * implementation.
 *
 * Checkout-wide concerns adjacent to company search — field visibility per
 * account type, intent-message text, sole-trader mode — stay in
 * `twoincDomHelper` / `twoincSoleTrader` and call into this class's public
 * methods, the same way `Twoinc#enableCompanySearch()` does.
 */
class TwoCompanySearch {
  /**
   * @param {Object} [options]
   * @param {string} [options.companyFieldSelector] Defaults to
   *   `#billing_company_display`, the id WooCommerce always renders it
   *   under on this plugin's checkout.
   */
  constructor(options) {
    options = options || {};
    this.companyFieldSelector = options.companyFieldSelector || "#billing_company_display";
  }

  /** CSS selector of the <select> this instance attaches selectWoo to. */
  companyFieldSelector;

  /**
   * Hard ceiling on a single company-search request, ms (TWO-25232).
   * Deliberately wider than the backend's own retry envelope for the
   * upstream provider lookup — this is the backstop for a request that never
   * arrives, not for a slow-but-arriving one.
   */
  companySearchTimeoutMs = 30000;

  /**
   * Characters the buyer must type before company search runs (TWO-25288) —
   * the single source of this threshold: minimumInputLength, the "not in the
   * list" button visibility, and the min-chars hint all read it, so the
   * number shown and the number enforced can't drift apart.
   */
  companySearchMinLength = 3;

  /**
   * The dropdown's own search field. select2 tears the dropdown down and
   * rebuilds it on every open, so this node is never the same one twice —
   * every use is a fresh lookup, every handler delegated.
   */
  companySearchInputSelector = 'input[aria-owns="select2-billing_company_display-results"]';

  /** DOM id of the manual-entry button. */
  manualEntryRowId = "company_not_in_btn";

  /** DOM id of the link back out of manual entry and into search. */
  searchCompanyBtnId = "search_company_btn";

  /**
   * DOM id of the mode-chips group (TWO-40 §0), sibling of the results list.
   * Holds "Registered company", "Sole trader" (while available), and "Enter
   * manually" (`manualEntryRowId`), in that order.
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
   * Sequence number of the most recently dispatched company-search request.
   * A superseded request must not act on the shared spinner — select2's own
   * abort ordering makes this a non-issue today, but that's an internal
   * detail of its ajax adapter, and this is the guard against it regressing.
   */
  companySearchSeq = 0;

  /**
   * Elements the browser stops on during Tab traversal. Deliberately a
   * superset — `[tabindex]` catches both the select2 combobox span
   * (`tabindex="0"`) and rows opted out via `tabindex="-1"` — so the caller
   * filters on the live `tabIndex` property rather than trusting the
   * selector alone.
   */
  tabbableSelector =
    "a[href], area[href], input:not([disabled]):not([type=hidden]), " +
    "select:not([disabled]), textarea:not([disabled]), button:not([disabled]), " +
    "iframe, object, embed, [tabindex], [contenteditable]";

  /**
   * The last billing country this page has acted on (TWO-24867/TWO-25326).
   * `null` until first seen; every setter goes through `countryDidChange`, so
   * none can leave this out of step with the field.
   */
  lastObservedCountry = null;

  /** DOM class of the payment-tile slot the company-search control moves into
   * when `company_search_location` is 'payment_tile' (TWO-25326 §7.1). */
  companySearchTileSlotClass = "twoinc-company-search-tile-slot";

  /**
   * DOM id of the wrapper holding the relocated company-search control
   * (TWO-25326 §7.1). One element, created once; every move is this same
   * node changing parent, never a clone.
   */
  companySearchTileWrapperId = "twoinc-company-search-tile-wrapper";

  /**
   * DOM id of the company-number label under the company-name field
   * (TWO-25288, narrowed to number-only by TWO-25326 §7). Id/class kept as
   * `twoinc_company_summary` since brand overlays style it by that class
   * (e.g. `.custom-checkout .twoinc-company-summary` in twoinc.css).
   */
  companySummaryId = "twoinc_company_summary";

  companySearchUnavailableText() {
    return (
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_search_unavailable) ||
      "Company search is temporarily unavailable. Please try again."
    );
  }

  /** Hint shown in the empty company-search field (TWO-25288). */
  companySearchPlaceholderText() {
    return (
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_search_placeholder) ||
      "Enter company name to search"
    );
  }

  /**
   * Hint stating the search threshold (TWO-25288), shown as the query
   * field's watermark. Deliberately a fixed number rather than select2's own
   * "N more characters" countdown — the buyer is told what the field needs,
   * not how far off they are. Rendered into the query-field placeholder
   * directly, matching PrestaShop (TWO-40) rather than select2's
   * `language.inputTooShort` hook, which would paint a second on-screen hint.
   * See `applyQueryFieldPlaceholder`.
   */
  companySearchTooShortText() {
    const template =
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_search_too_short) ||
      "Please enter %d or more characters";
    // Matches gettext's positional form (`%1$d`) as well as bare `%d`: a
    // translator may reorder arguments via `#, php-format` placeholders. The
    // msgid itself stays `%d` — changing it would invalidate catalogues.
    return template.replace(/%(\d+\$)?d/, twoincSelectWooHelper.companySearchMinLength);
  }

  /** Label of the "Enter manually" mode chip (TWO-40 §0). */
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
   * Build the manual-entry affordance as a real, focusable button.
   * TWO-25288 made it a pseudo-option inside `.select2-results__options`,
   * which was only reachable by arrowing past every real result (clipped by
   * select2's own scroll region, `tabindex="-1"` to match the listbox
   * pattern) and inherited selectWoo's row-activation binding on plain
   * `mouseup` with no button check, so a right-click activated it too. A
   * real `<button>` fixes both via native Tab order and native click.
   *
   * One of three `.twoinc-mode-chip` buttons inside `.twoinc-mode-chips`
   * (TWO-40 §0) — see `buildBusinessChip`/`buildSoleTraderChip` and
   * `syncManualEntryButton`.
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
   * Switch out of company search into manual entry. Removes the button
   * before deferring so a second click can't queue a second switch. Deferred
   * because entering manual entry destroys this widget, and destroying it
   * from inside the still-unwinding click event would pull the DOM out from
   * under that unwind.
   */
  activateManualEntry() {
    const helper = twoincSelectWooHelper;

    // Mid-decision the chip must stay: `enterManualCompanyEntry` refuses in
    // that state anyway, so removing the chip first would leave no chip and
    // no manual mode (TWO-40).
    if (twoincSoleTrader.isDeciding()) return;

    // Captured synchronously: the deferred callback can't otherwise tell "was
    // already in sole-trader mode" from "switched into it during the defer".
    const leavingSoleTrader = twoincSoleTrader.mode === "sole_trader";

    jQuery("#" + helper.manualEntryRowId).remove();
    setTimeout(function () {
      // Re-checked: reverting under an in-flight decision is what every other
      // exit from sole-trader mode refuses to do.
      if (
        leavingSoleTrader &&
        twoincSoleTrader.mode === "sole_trader" &&
        !twoincSoleTrader.isDeciding()
      ) {
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
        // raced the buyer against the flight/popup's own resolution — the
        // ACCEPTED handler could silently reassert or
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
   * "Sole trader" mode chip (TWO-40 §0). Only added while
   * `twoincSoleTrader.isAvailable()` — see `syncSoleTraderChip`.
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
   * availability resolves asynchronously per country and can change after
   * the dropdown is already open and the rest of the group already built.
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
   * Cosmetic-only selected-chip class (TWO-40 §0), never a visibility
   * mechanism — manual entry destroys the widget its chip lives in on
   * activation, so it has no "selected" state to paint.
   */
  updateModeChipsSelection() {
    const helper = twoincSelectWooHelper;
    const mode = twoincSoleTrader.mode === "sole_trader" ? "sole_trader" : "business";

    // By class, not id: an id selector only finds one wrapper even when a
    // stale, orphaned one shares the id (see syncManualEntryButton).
    jQuery("." + helper.modeChipsWrapperClass)
      .find("." + helper.modeChipClass)
      .each(function () {
        jQuery(this).toggleClass("twoinc-mode-chip--selected", jQuery(this).data("mode") === mode);
      });
  }

  /**
   * Put the mode-chips group right after the results list, or take it away
   * (TWO-40 §0). A sibling of `.select2-results__options`, not a child, so
   * it sits outside the scrollable part of the dropdown but stays inside
   * `.select2-results`, the same wrapper the results list lives in.
   *
   * Holds all three chips as one group in this order — "Registered company",
   * "Sole trader" (while available), "Enter manually" — so the manual-entry
   * chip and its Tab shortcut stay the last tabbable element.
   *
   * Visibility rule is "search UI active", not the search threshold and not
   * "company already captured" (both regressed live 2026-08-02): the group
   * only exists inside the dropdown, so dropdown-open already implies
   * buyer-searching. It stays in the dropdown's subtree while closed —
   * harmless, since selectWoo's AttachBody decorator detaches the whole
   * container from the document on close, making it unreachable anyway.
   */
  syncManualEntryButton() {
    const helper = twoincSelectWooHelper;

    const picker = jQuery("#billing_company_display").data("select2");
    if (!picker || !picker.$results || !picker.$results.length) return;

    const $list = picker.$results;

    // Sweep away any STALE `.select2-results` panel for this field:
    // WooCommerce's checkout AJAX can `replaceWith()` the underlying <select>
    // while its dropdown is open without calling `select2("destroy")`,
    // orphaning the old dropdown in <body> forever and causing a second,
    // independent panel on the next open (TWO-40). Scoped by the results-list
    // id prefix (deterministic per field, vendored search.js) rather than a
    // blanket `.select2-results` query, so this never touches another
    // widget's open dropdown (e.g. `#billing_country`'s).
    const resultsIdPrefix = "select2-" + helper.companyFieldSelector.replace("#", "") + "-results";
    jQuery("[id^='" + resultsIdPrefix + "']")
      .closest(".select2-results")
      .not($list.closest(".select2-results"))
      .closest(".select2-container--open")
      .remove();

    // By class, not id: a second orphaned wrapper can legitimately exist
    // (same replaceWith() issue above), and the class selector catches all of
    // them regardless of which is stale.
    let $wrapper = jQuery("." + helper.modeChipsWrapperClass);

    // Already correctly placed with no duplicates: skip the rebuild so an
    // unconditional re-append doesn't tear down/rebuild on every keystroke.
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
   * Wire the manual-entry affordance to a company-search widget (TWO-25288).
   * Idempotent: handler is namespaced and every bind is preceded by the
   * matching `.off()`, since this runs repeatedly (800ms re-run of
   * enableCompanySearch, every return from manual entry).
   *
   * No separate activation binding: the button from `syncManualEntryButton`
   * owns its own click handler directly, since it's a real element outside
   * the results list rather than a pseudo-option needing `select2:selecting`
   * interception.
   */
  bindManualEntryAffordance() {
    const helper = twoincSelectWooHelper;

    // Delegated on <body>, not bound to the search field: that field is
    // destroyed/rebuilt on every open.
    jQuery(document.body)
      .off("input.twoincManualEntry")
      .on("input.twoincManualEntry", helper.companySearchInputSelector, function () {
        helper.syncManualEntryButton();
      });

    // Also on open (TWO-25326 §2): visibility is no longer keyed on the
    // search threshold, so a buyer who opens the dropdown and types nothing
    // fires no `input` event at all. Deferred a tick: `select2:open` fires
    // while the open is still unwinding, before the results list is in its
    // post-open state.
    jQuery(document.body)
      .off("select2:open.twoincManualEntry")
      .on("select2:open.twoincManualEntry", "#billing_company_display", function () {
        setTimeout(helper.syncManualEntryButton, 0);
      });

    // Tab-to-button shortcut. Only plain Tab is hijacked — Shift+Tab keeps
    // ordinary reverse-tab behaviour. No-op (not a fallback) when the button
    // isn't in the DOM yet (below the search threshold).
    //
    // `e.which` matches the vendored selectWoo bundle's own convention
    // (`evt.which` throughout selectWoo.full.js), and is immune to `.key`
    // coming back blank/"Unidentified" on some real keydowns.
    //
    // `stopPropagation` is load-bearing: selectWoo's core document keydown
    // handler treats a bare Tab like Enter while the dropdown is open — it
    // fires `results:select` then unconditionally refocuses the search field,
    // with no `isDefaultPrevented()` check. Without stopping propagation that
    // handler still runs right after this one and yanks focus back.
    // `preventDefault` alone doesn't stop the bubble. Side effect (intended):
    // Tab no longer doubles as "accept highlighted result" the way
    // selectWoo's own Tab-as-Enter would; Enter itself is untouched.
    //
    // A second selectWoo timer needs separate defending, since
    // stopPropagation on the Tab event can't reach it: the same document
    // handler also schedules `focusOnActiveElement()` on every typing
    // keystroke, refocusing the highlighted result row 1000ms later — a timer
    // armed by the PREVIOUS keystroke, before this Tab handler ever runs. A
    // fast typer hitting Tab within that ~1s window gets focus yanked back
    // onto the highlighted row shortly after landing on the button
    // (confirmed with fake timers). Re-assert focus on the button once, just
    // past that window, but only if selectWoo's timer actually won and the
    // button is still there — so a buyer who has since moved on deliberately
    // is never fought.
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
    // Landing on this button via the shortcut does not close the dropdown or
    // clear selectWoo's `isOpen()` class. Without `stopPropagation`, a second
    // Tab (or Enter/Space) bubbles to selectWoo's still-live document handler
    // (`Select2.prototype._registerEvents`), which for Tab/Enter silently
    // fires `results:select` on the highlighted row (wrong company selected)
    // and for all three unconditionally refocuses the search field —
    // trapping the buyer and, for Tab/Enter, mis-selecting underneath them.
    // `_attachCloseHandler` in the vendored bundle only closes on Escape,
    // a result pick, or an outside mousedown, so the dropdown otherwise stays
    // open and keeps intercepting every later Tab/Enter/Escape on the page.
    //
    // Fix, for Tab: `preventDefault`, resolve the next real tab-stop after
    // the company-name control while the dropdown/anchor are still in the
    // document, then close, then focus it. Closing fires selectWoo's own
    // `container.on('close')`, which unconditionally refocuses the search
    // field ~1ms later — rather than avoid the close, re-focus the intended
    // target just past that window, only if the steal actually won.
    //
    // Shift+Tab is left alone: reverse Tab should go to the query field,
    // which native traversal already reaches; hijacking it would close the
    // dropdown the buyer is trying to move back into.
    //
    // Enter/Space need the same protection for the same reason — they fall
    // through selectWoo's handler to the same unconditional refocus tail
    // (Enter additionally hits the `results:select` branch). `stopPropagation`
    // only, deliberately without `preventDefault`, so the browser's native
    // "activate a focused <button>" action still runs and this button's own
    // click handler fires.
    jQuery(document.body)
      .off("keydown.twoincManualEntryButton")
      .on("keydown.twoincManualEntryButton", "#" + helper.manualEntryRowId, function (e) {
        if (e.which !== 9 && e.which !== 13 && e.which !== 32) return;
        e.stopPropagation();

        // Enter and Space stop here: their native "activate a focused
        // <button>" default action must still run so this button's own click
        // handler fires. Shift+Tab stops here too — see above.
        if (e.which !== 9 || e.shiftKey) return;

        // Resolved before the close, while the company-name control is still
        // on screen.
        const candidates = helper.tabbablesAfterCompanyField();

        e.preventDefault();
        helper.closeCompanySearchDropdown();

        // Walk candidates until one actually takes focus rather than
        // assuming the first does — `.focus()` can silently no-op, in which
        // case selectWoo's own post-close refocus would otherwise win by
        // default. Falling through entirely means <body>, which is at least
        // distinguishable from Tab having done nothing.
        if (!helper.focusFirstThatTakes(candidates)) helper.releaseFocusFromCompanyField();

        // selectWoo schedules an unconditional `$selection.focus()` ~1ms
        // after close (vendored bundle); 20ms clears that. Re-checked rather
        // than reapplied blindly, so a buyer who clicked elsewhere in the
        // window is never fought.
        setTimeout(function () {
          if (!helper.focusIsBackOnCompanyField()) return;
          if (!helper.focusFirstThatTakes(candidates)) helper.releaseFocusFromCompanyField();
        }, 20);
      });
    // NOTE: #search_company_btn's equivalent fix (in getSearchCompanyBtnNode)
    // binds directly on the element and calls preventDefault() +
    // exitManualCompanyEntry() instead — the two buttons have different
    // interferers (selectWoo's document handler here; selectWoo isn't even
    // alive there), so the fix shape differs. See that function's comment.
  }

  /**
   * Close the company-search dropdown, if one is open (TWO-25326). Goes
   * through the instance rather than `.select2('close')` so it's a no-op,
   * not a thrown error, on a page where the widget was never attached.
   */
  closeCompanySearchDropdown() {
    const picker = jQuery("#billing_company_display").data("select2");
    if (picker && typeof picker.close === "function") picker.close();
  }

  /**
   * Is this element hidden, for the purpose of choosing a Tab target? A
   * cheap pre-filter, not a guarantee — reads only the `hidden` class/attr
   * and inline `display: none`, deliberately not jQuery's `:visible` (a
   * layout query that jsdom/Jest always reports as hidden for everything).
   * A field hidden by some other stylesheet rule slips through this, which
   * is why the caller verifies focus actually landed — see
   * `focusFirstThatTakes`.
   */
  isHiddenForTabbing(el) {
    const $el = jQuery(el);
    if ($el.closest(".hidden, [hidden]").length) return true;
    return Boolean(el.style && el.style.display === "none");
  }

  /**
   * Every real tab-stop after the company-name control, in tab order
   * (TWO-25326 §4). Needed because selectWoo attaches the dropdown to the
   * end of `<body>`, so native Tab out of it walks off the document instead
   * of continuing through the address form — traversal has to be recomputed
   * from the control's position in the form.
   *
   * Returns a list, not just the first hit, so the caller can keep walking
   * if one candidate can't take focus (e.g. hidden by a stylesheet rule
   * `isHiddenForTabbing` can't detect) rather than losing the race to
   * selectWoo's own unconditional post-close refocus.
   *
   * Everything inside an open select2 is excluded — otherwise the answer
   * would be the query field or manual-entry button, both about to be
   * detached by the close.
   *
   * Uses `compareDocumentPosition` rather than an index into the candidate
   * list: selectWoo flips the combobox's own `tabindex` while open, so the
   * anchor isn't reliably a member of that list.
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
   * The element the Tab traversal is measured from (TWO-25326 §4), in order
   * of how precisely they locate the control: rendered combobox, its
   * `.form-row` wrapper (present regardless of select2 render state or field
   * reordering), then the plain manual-entry input.
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
   * Focus the first candidate that actually accepts focus (TWO-25326 §4).
   * `.focus()` silently no-ops on a non-rendered element per the HTML spec,
   * so this reads `document.activeElement` back and keeps walking on
   * failure — which makes `isHiddenForTabbing`'s pre-filter an optimisation
   * rather than a correctness requirement.
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
   * The spinner is a single childless element (the stylesheet paints the
   * animated GIF as background-image); aria-hidden since it's decoration and
   * select2 already announces search state via the results list. Removed
   * rather than hidden when the search ends, since select2 tears the
   * dropdown down and rebuilds it on every open anyway.
   *
   * Only the company-search request paints here; the sole-trader round trip
   * paints over the company-NAME field instead (`syncSoleTraderSpinner`) —
   * two nodes in two places, `companySearchSeq` deciding which of two
   * overlapping searches owns this one.
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
   * the company field (item 2.1, TWO-40). A pure function of mode alone.
   *
   * Hidden, not merely readonly — readonly alone leaves it painted, reading
   * as a broken search box. `display: none` + `hidden` attr (not
   * visibility/opacity) so it leaves the tab order too. Readonly stays on
   * top of the hide because selectWoo's `container.on('open')` focuses this
   * input unconditionally, and a hidden-but-typable field is exactly what
   * that guards against.
   *
   * The whole row is removed, not just the input, to avoid an empty painted
   * row. Applied on both every open and every mode write: selectWoo renders
   * this row once per widget instance and re-attaches the same node on every
   * open, so a suppression from one open would otherwise outlive it.
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
   * (Re-)initialise selectWoo on the company field, with the post-init
   * wiring every init path owes. Both wirings act on nodes selectWoo creates
   * in its own constructor, so they can only be applied per widget instance
   * — hence this function rather than entries in `genSelectWooParams`. Two
   * init sites exist (`attach()` and `clearSelectedCompany()`, see the
   * latter for why it doesn't go through the former).
   */
  initCompanySearchWidget($field) {
    const helper = twoincSelectWooHelper;
    const widget = $field.selectWoo(helper.genSelectWooParams());
    helper.applyQueryFieldPlaceholder($field);
    helper.suppressQueryTooShortMessage($field);
    return widget;
  }

  /**
   * Put the length requirement in the query field's own watermark, a plain
   * `placeholder` attribute, matching PrestaShop. Read off the instance
   * rather than the document: selectWoo's AttachBody decorator keeps the
   * dropdown detached from the document until first open, so a
   * document-scoped lookup finds nothing at the moment this needs to run.
   */
  applyQueryFieldPlaceholder($field) {
    const picker = $field.data("select2");
    if (!picker || !picker.$dropdown) return;
    picker.$dropdown
      .find(".select2-search__field")
      .attr("placeholder", twoincSelectWooHelper.companySearchTooShortText());
  }

  /**
   * Stop select2 painting its own "input too short" row under the query
   * field — the requirement is now the field's watermark
   * (`applyQueryFieldPlaceholder`), so this removes the redundant hint.
   * Bound on the instance since `results:message` is internal to select2,
   * not relayed to the DOM node. Removes the row rather than blanking via
   * `language.inputTooShort`, which still appends an empty `<li>`.
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
   * Class of the sole-trader in-flight spinner (TWO-40). A class, not an
   * id, for the same reason as `modeChipsWrapperClass`: a checkout fragment
   * swap can orphan a duplicate wrapper (see `syncManualEntryButton`), and
   * an id selector would find only one, leaving the other animating forever.
   */
  soleTraderSpinnerClass = "twoinc-sole-trader-spinner";

  /** Marker class on whichever element currently hosts that spinner. */
  soleTraderSpinnerHostClass = "twoinc-name-searching";

  /**
   * The element the sole-trader spinner paints over: the box of whichever
   * of the two company-NAME surfaces is currently visible — same question
   * `getCompanySummaryNode()` answers for the number label, answered the
   * same way (search control wins while showing, native field otherwise).
   * The input box, not the field row, so vertically centring doesn't float
   * the spinner over the label too.
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
   * Show the sole-trader spinner for exactly as long as the flow is running.
   * Derived from state on every call, not held between calls, since mode and
   * `flightDepth` move independently and the host itself moves with the
   * visible name surface. Remove-then-add, same as `toggleCompanySearchSpinner`.
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
   * Everything the sole-trader flow's two dropdown/field surfaces derive
   * from `mode` and `flightDepth`. One call site per state change so the
   * query row and spinner can't be re-synced by different callers and drift
   * apart.
   */
  syncSoleTraderSurfaces() {
    twoincSelectWooHelper.syncQueryFieldSuppression();
    twoincSelectWooHelper.syncSoleTraderSpinner();
  }

  /**
   * Close the company-search dropdown if — and only if — it is open. The
   * mode chip is clicked from inside an open dropdown; the "select a
   * different sole trader" link is clicked with none on screen. Checking
   * "is it open" rather than tracking which entry point started the flow
   * lets both share one sequence, this call a no-op for the link.
   */
  closeCompanySearchDropdownIfOpen() {
    if (!twoincSelectWooHelper.companySearchDropdownIsOpen()) return;
    jQuery("#billing_company_display").select2("close");
  }

  /**
   * Is the company-search dropdown currently on screen? Asked by two callers
   * with opposite intentions — closing what's open vs. reopening what was
   * open before `setMode()` tore the widget down — so it's one predicate
   * rather than the same guard written twice.
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
   * "" when absent/unset (TWO-24867). The single reader for every
   * country-sensitive path (search request, change guard, address-lookup
   * supersession, `twoincSoleTrader.currentCountry()`), so they can't
   * disagree on "the current country" — the multi-resolver drift that broke
   * on the platform this ports from (TWO-40 §1). Reads the invoice-role form
   * explicitly, not "whichever form is on screen" — see `twoincAddressRoles`.
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

        // Spinner also driven off the widget's own query lifecycle, additive
        // to the ajax-transport hooks in genSelectWooParams (TWO-25326 §1):
        // covers the 300ms debounce before the transport runs, and is
        // independent of the transport hook actually firing in a real
        // browser (observed not to, though root cause unconfirmed, while the
        // same path under Jest works). `results:all`/`results:message` are
        // the two terminal states of a query.
        //
        // The threshold check is load-bearing: for a below-minimum term the
        // minimumInputLength decorator answers synchronously with
        // `results:message` before this handler runs (handlers run in
        // registration order, and the widget's own `query` handler runs
        // first) — without the guard every sub-3-character keystroke would
        // leave the spinner running with no request in flight.
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
   * `waitToFocus` polls to nudge focus into the search field because the
   * picker's own focus-on-open doesn't land reliably on every host theme;
   * left unchecked it would keep yanking focus back even after the buyer
   * deliberately Tabbed elsewhere. "Still allowed" covers everything the
   * poll's job needs: nothing focused yet, the search field, an option row,
   * or the collapsed combobox trigger — anything else is the buyer's own
   * navigation, which must win.
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
   * DOM id of the safe holding pen the wrapper sits in whenever it is not
   * inside the live `.twoinc-company-search-tile-slot` (TWO-25326 §7.1).
   * A direct child of `<form name="checkout">`, stable across every
   * WooCommerce checkout AJAX refresh (unlike `document.body`), so a buyer
   * submitting during the brief detached window still posts real inputs.
   */
  getCompanySearchTileHoldingPen() {
    let $pen = jQuery("#twoinc-company-search-tile-holding-pen");
    if (!$pen.length) {
      $pen = jQuery('<div id="twoinc-company-search-tile-holding-pen" class="hidden"></div>');
      const $form = jQuery('form[name="checkout"]');
      // Falls through to <body> only on a page with no checkout form.
      (($form.length && $form) || jQuery("body")).append($pen);
    }
    return $pen;
  }

  /**
   * Detach the company-search tile wrapper to the safe holding pen before
   * any WooCommerce checkout AJAX refresh can destroy it (TWO-25326 §7.1).
   *
   * WooCommerce's `update_order_review` AJAX (shipping/coupon/quantity
   * change, not only payment-method or country) replaces the whole
   * `.woocommerce-checkout-payment` fragment via `replaceWith()`, which the
   * payment tile's slot lives inside — a live input re-parented there is a
   * descendant of a subtree WooCommerce can destroy with no warning, and
   * nothing resurrects a node jQuery already tore down.
   *
   * Bound to WooCommerce's present-tense `update_checkout` trigger (fired
   * synchronously before the async AJAX begins), not `updated_checkout`
   * (past-tense, fires after fragments are already swapped) — jQuery
   * dispatches every handler on a trigger synchronously in the same tick,
   * so this always completes before the fragment swap regardless of
   * registration order against WooCommerce's own handler.
   *
   * No-op on 'address_area', or if the wrapper doesn't exist yet or is
   * already in the pen.
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
   * Refused while `twoincSoleTrader.isBusy()`, same restraint given
   * elsewhere in the file: the dropdown/busy spinner are deliberately left
   * open through a sole-trader popup round trip, and closing here mid-flight
   * would swap that spinner out from under the buyer for no reason.
   *
   * Checked again inside the deferred focus-restore, not only at entry: a
   * flight can start in the gap between the synchronous close and the timer
   * firing, and the restore would otherwise yank focus back off whatever
   * that flight's own UI just gave it.
   *
   * The restore's steal check deliberately isn't `focusIsBackOnCompanyField()`
   * — that helper treats nothing-focused (`<body>`) as a steal too, which is
   * right for its own caller (paired with attempting a new target) but wrong
   * here: a fragment replace can legitimately remove the previously-focused
   * node and leave focus on `<body>` with nothing to fight. Only a focus
   * landing literally back on the company field is the steal guarded here.
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
   * Relocate the one company-search control into the payment tile, or leave
   * it in the address area, per `window.twoinc.company_search_location`
   * (TWO-25326 §7.1) — derived from the `enable_company_search` checkbox
   * admin field (checked = address area, unchecked = payment tile; the
   * control never disappears, it only moves). See
   * WC_Twoinc_Checkout::prepare_twoinc_object().
   *
   * Same control both ways — `#billing_company_display_field` plus the
   * read-only number label — moved with `appendTo()`, never cloned. All
   * existing JS targeting those ids/classes keeps working unchanged.
   *
   * `#billing_company_field` (WooCommerce's own native field) is never
   * moved: it's the plain fallback the buyer types into when the checkbox
   * is unchecked (`toggleBusinessFields()`'s disabled branch) — moving it
   * would pull the buyer's only way to enter a company name out of the
   * address form. `#company_id_field` is also excluded, but only because
   * it's a hidden input with no visible effect from moving; it stays with
   * its manual-entry partner.
   *
   * Default 'address_area' (checkbox checked): no-op, zero behavioural
   * change. 'payment_tile': fields move into
   * `.twoinc-company-search-tile-slot`, the slot `get_pay_box_description()`
   * server-renders between the sole-trader toggle and the intent
   * loader/notice. A single wrapper is created once and holds all moved
   * rows, so the slot only ever has one child to manage. This function only
   * pulls the wrapper INTO the slot; pulling it back OUT before AJAX can
   * destroy it is `detachCompanySearchTileWrapperToSafety`'s job.
   *
   * Every move is guarded on the node's current parent (same idempotency
   * check `getCompanySummaryNode()` relies on) so an unconditional
   * `appendTo()` doesn't detach/reattach a live `<select>` — and silently
   * close an open dropdown — on every unrelated re-render.
   *
   * Called from `onUpdatedCheckout()` and from `toggleBusinessFields()` —
   * the two paths that can re-decide which company fields are visible, and
   * so must re-decide where they live.
   */
  syncCompanySearchTileLocation() {
    const $slot = jQuery("." + twoincSelectWooHelper.companySearchTileSlotClass);
    if (!$slot.length) return;

    if (window.twoinc.company_search_location !== "payment_tile") {
      // Address area (default): nothing to move — `window.twoinc` is
      // written once per page load, so this can't flip mid-session.
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

    // jQuery's multi-selector returns matches in document order, which is
    // already the address-form order (search control, then hidden org-number
    // field). `.appendTo()` on an already-attached node moves it (never
    // clones), only when not already there, so a stale dropdown/selection
    // survives an unrelated re-render.
    //
    // `#billing_company_field` and `#company_id_field` stay excluded from
    // this selector — both stay in the address form no matter which branch
    // runs.
    jQuery("#billing_company_display_field").each(function () {
      const $field = jQuery(this);
      if ($field.parent()[0] !== $wrapper[0]) $field.appendTo($wrapper);
    });

    // The read-only company summary is not appended here — no second
    // implementation of "where does the summary live". It follows the
    // search control on its own, since `getCompanySummaryNode()` (called
    // from `renderCompanySummary()`, which always runs right after this)
    // anchors the summary against `#billing_company_display_field` itself,
    // already relocated above by the time that lookup runs.
    //
    // Unhidden only when the wrapper gained a VISIBLE child: manual entry
    // and any country with no registry to search hide
    // `#billing_company_display_field` with the `hidden` class rather than
    // removing it, but it's still moved into the wrapper by the loop above
    // — so checking mere child presence would unhide the slot around a
    // `display: none` field, leaving a bare gap between the sole-trader
    // toggle and the intent message.
    if ($wrapper.children(":not(.hidden)").length) {
      if ($slot.hasClass("hidden")) $slot.removeClass("hidden");
    } else if (!$slot.hasClass("hidden")) {
      $slot.addClass("hidden");
    }
  }

  /**
   * The native `#billing_company` is read only in manual entry. Sole-trader
   * mode reads the picker's display span exactly like an ordinary search
   * pick, because that is where the adopted name is rendered
   * (`lockCapturedFields()` seeds the widget with it, TWO-40 §7). Branching
   * on `enable_company_search` instead would send the sole-trader case down
   * the native-field branch, which isn't what the buyer sees there, so
   * `getCompanyData()`/`isReadyApprovalCheck()` would silently fail to fire
   * an order intent for an adopted sole trader.
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

  clearSelectedCompany() {
    let billingCompanyDisplay = jQuery("#billing_company_display");
    billingCompanyDisplay.html("");
    // Re-inits selectWoo directly rather than through `attach()` (TWO-25469)
    // — this can run after a fragment replace has already discarded the
    // field's old `<select>`, the orphan-dropdown trigger `attach()`'s own
    // sweep exists for. See `sweepOrphanedDropdown()` for the mechanism.
    twoincSelectWooHelper.sweepOrphanedDropdown(billingCompanyDisplay);
    twoincSelectWooHelper.initCompanySearchWidget(billingCompanyDisplay);
    twoincDomHelper.toggleTooltip(
      "#billing_company_display_field .select2-container",
      window.twoinc.text.tooltip_company
    );
    twoincSelectWooHelper.fixSelectWooPositionCompanyName();
    // The real company field too, matching enterManualCompanyEntry: without
    // this the cleared company survives in #billing_company (the field
    // WooCommerce posts, and the live mirror the read-only summary reads),
    // so it would reappear on the next render (TWO-25288).
    //
    // Gated on PROVENANCE (TWO-40 §5), not capture mode: in manual entry
    // #billing_company is the buyer's own typed input, and this runs on
    // every country change, so clearing unconditionally would wipe a name
    // typed for reasons of their own. The provenance marker distinguishes a
    // plugin-written name (e.g. sole-trader adoption) from buyer typing
    // directly, which `enable_company_search` alone can't.
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
   * Anchored after the company-search field's enclosing `.twoinc-inp-container`
   * where there is one, not inside it — the pay-for-order page hides that
   * container (not just the field), so a summary placed inside would be
   * invisible there in exactly the search mode it matters most for.
   * `#billing_company_field` covers the hidden-search-field case, and
   * `#company_id_field` is the fallback for a page with no name field.
   *
   * Anchoring against the search field specifically, rather than
   * `#company_id_field` (never relocated — see
   * `syncCompanySearchTileLocation()`), is what makes the summary follow
   * the control into the payment tile: that function runs before every
   * `renderCompanySummary()` call, so the anchor is already wherever it's
   * going to be for this render.
   *
   * Re-anchored on every call, not just on first creation: WooCommerce
   * core's `address-i18n.js` detaches and re-appends every `.form-row` in
   * the billing wrapper by priority on every checkout load. This summary is
   * a plain `<div>`, not a `.form-row`, so it never takes part in that
   * resort and stays stranded above the real fields once WC moves them.
   * `insertAfter` on an already-attached node moves it rather than cloning,
   * so re-checking the anchor on every render (already firing on every
   * pick/switch/change) snaps it back into place.
   *
   * Guarded on `$node.prev()`: an unconditional `insertAfter` on every call
   * detaches/reinserts the node even when nothing drifted, collapsing any
   * text selection and restarting brand-overlay CSS transitions. `.prev()`
   * is element-only, so "prev is already the anchor" reliably means
   * "already positioned, nothing to do".
   */
  getCompanySummaryNode() {
    let $node = jQuery("#" + twoincSelectWooHelper.companySummaryId);
    const isNew = !$node.length;

    let $field = jQuery("#billing_company_display_field");
    // The label belongs immediately below whichever company-NAME element is
    // currently visible: the search control wins while showing, the native
    // field takes over only when it's hidden (anchoring against a
    // `display: none` row would strand the label above whatever sits there).
    if ($field.hasClass("hidden")) {
      const $native = jQuery("#billing_company_field");
      if ($native.length && !$native.hasClass("hidden")) $field = $native;
    }
    if (!$field.length) $field = jQuery("#company_id_field");
    if (!$field.length) $field = jQuery("#billing_company_field");
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
   * Both render as text in one place across all three capture modes:
   * company search (name+number from the registry), sole trader (name+number
   * held by Two), manual entry (typed name, no number until the buyer
   * supplies one).
   *
   * Both arguments are optional. Callers that already hold the values pass
   * them (picker select handler, sole-trader autofill, the user-meta restore
   * — which writes #company_id after this runs). Everyone else omits them
   * and the current inputs are read.
   */
  renderCompanySummary(companyName, companyId) {
    const data =
      companyName === undefined && companyId === undefined
        ? twoincSelectWooHelper.readCapturedCompany()
        : { company_name: companyName, organization_number: companyId };

    // The empty selectWoo option's label is a non-breaking space, so an
    // unselected picker reads back as " " rather than "".
    const name = twoincUtilHelper.blankToEmpty(data.company_name);
    // Display-normalised (TWO-25326 §12): an internally minted number reads
    // back as "" here, so a sole trader's captured company shows no number
    // label. The raw value stays untouched on `#company_id` and in instance
    // state, which is what gets posted.
    const number = twoincUtilHelper.formatCompanyNumber(data.organization_number);

    const $node = twoincSelectWooHelper.getCompanySummaryNode();
    if (!$node.length) return;

    $node.find(".twoinc-company-summary-id").text(number);

    // Visible only in `search` mode (never `manual`, which clears
    // #company_id; never `sole_trader`, whose minted number isn't the
    // buyer's own registry identifier) with a non-synthetic number —
    // `number` is already `formatCompanyNumber()`'s output, so this one
    // truthiness check covers both "nothing captured" and "must not show".
    // Deliberately not gated on Two being the selected payment method: the
    // number belongs to the captured company, not to Two's tile.
    const visible = Boolean(number && twoincCompanyCapture.mode === "search");
    $node.toggleClass("hidden", !visible);
  }

  /**
   * Read the captured company straight out of the live inputs (TWO-25288).
   * Deliberately not getCompanyData(): in search mode that goes through
   * getCompanyName(), which reads a sessionStorage snapshot refreshed only
   * every 3 seconds, so a summary rendered from it could show a stale or
   * blank name while the number (read live) stayed current.
   *
   * `#billing_company` and `#company_id` only — the fields WooCommerce
   * posts, written by every capture mode. The display select's value was
   * briefly used as a fallback but had to go: the picker appends an
   * `<option>` per pick that nothing removes on leaving search mode, so it
   * could show a company the order didn't actually carry.
   */
  readCapturedCompany() {
    return {
      company_name: twoincUtilHelper.blankToEmpty(jQuery("#billing_company").val()),
      organization_number: twoincUtilHelper.blankToEmpty(jQuery("#company_id").val())
    };
  }

  /**
   * Get the link back out of manual entry and into company search, building
   * it hidden on first use (TWO-25288). A real `<button>` (`type="button"`
   * so it can't submit the checkout form), not a `<div>` — needed for
   * keyboard access.
   *
   * Appended into `.woocommerce-input-wrapper`, WooCommerce core's own box
   * around just the `<input>` with no label inside it, so a plain appended
   * block lands directly below the input regardless of label height. If
   * that wrapper is missing, one is built around `#billing_company`
   * directly rather than falling back to `#billing_company_field` itself,
   * which would reintroduce the overlap bug this avoids.
   */
  getSearchCompanyBtnNode() {
    const id = twoincSelectWooHelper.searchCompanyBtnId;

    let $btn = jQuery("#" + id);
    if ($btn.length) return $btn;

    $btn = jQuery("<button></button>")
      .attr({ id: id, type: "button" })
      .text(twoincSelectWooHelper.searchCompanyText())
      .hide()
      // Both click and Enter/Space bound directly on the element rather
      // than delegated from document.body: a delegated click handler was
      // previously found not to fire even though the mouse event
      // demonstrably reached this button, and native Enter/Space activation
      // alone did nothing for it either. A directly-bound listener always
      // runs before any bubble-phase ancestor listener regardless of
      // registration order, so both fire reliably.
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
   * Extracted so the "select a different sole trader" link (TWO-40 §7)
   * shares this same visual slot rather than a second near-copy.
   *
   * Self-heals rather than degrading: falling back to
   * `#billing_company_field` directly would append the button as a sibling
   * of both the label and the input rather than right after the input,
   * reintroducing an overlap-with-the-label bug — so an equivalent wrapper
   * is built around just the `<input>` instead, matching the DOM shape
   * WooCommerce core's own `woocommerce_form_field()` produces.
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
    // sole-trader switch raced in during the same tick — a
    // `twoincSoleTrader.setMode("sole_trader")` independent of
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
    // landing can arrive while a sole-trader flight is still
    // outstanding and `mode` hasn't flipped to `sole_trader` yet — without
    // this, a signup resolving afterwards fully overwrites whatever this
    // function touched anyway (`setCompany` → `lockCapturedFields`), so
    // today it's harmless, but only by that
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

    // Land the buyer in the open dropdown with the caret in its search box,
    // so re-entering search costs one click rather than two. After
    // toggleBusinessFields deliberately: opening positions the dropdown
    // against its container, which is only laid out once shown.
    if (!twoincSelectWooHelper.openCompanySearchDropdown()) {
      // Fallback for a surface with no picker attached (pay-for-order page).
      // Not #billing_company_display — the picker hides that <select> and
      // moves its accessible role onto the rendered combobox.
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
   * (TWO-25288). The explicit focus isn't redundant with the picker's own —
   * that doesn't reliably land on every host theme (hence the polling
   * `waitToFocus` fix), so focusing here makes the caret arrive
   * synchronously instead of waiting on the poll.
   *
   * Reports whether the dropdown opened, not whether focus landed — the
   * caller only falls back to focusing the collapsed combobox when there
   * was no dropdown to be inside; a failed focus with the dropdown open is
   * left to the `select2:open` poll.
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
   * Guarded rather than a bare `.focus()`: the target may be absent on
   * surfaces like the pay-for-order page, and `.focus()` on an empty set is
   * a silent no-op that reads as success.
   */
  focusVisibleCompanyField(selector) {
    const $field = jQuery(selector);
    if (!$field.length || $field.prop("disabled")) return false;
    $field.trigger("focus");
    return jQuery(document.activeElement).is($field);
  }

  /**
   * Sweep away an orphaned select2 dropdown clone left behind for this
   * field before (re-)initialising selectWoo against it (TWO-25469). A
   * widget discarded by having its `<select>` replaced outright (WooCommerce
   * checkout-AJAX `replaceWith()`, rather than a `select2("destroy")` call)
   * loses its inline container but not its dropdown: selectWoo's AttachBody
   * decorator renders that as a separate node appended to `<body>`, which
   * nothing then detaches — it sits there forever, and reopening the
   * freshly re-attached widget renders a second dropdown alongside it.
   *
   * Only swept when this field has no live widget right now — the ordinary
   * re-attach path calls this while a widget is still attached, and
   * selectWoo's own reinit already cleans up correctly there; sweeping
   * concurrently would race that cleanup.
   *
   * Called from both places that (re-)initialise selectWoo on this field:
   * `attach()` and `clearSelectedCompany()` (the latter re-inits directly
   * rather than through `attach()`, so needs this call of its own).
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
   * architecture rebuild). Called from `Twoinc#enableCompanySearch()`
   * (initialize, its 800ms retry, `exitManualCompanyEntry()`, sole-trader
   * mode switch back to search) — all of those re-attach the widget rather
   * than construct a second `TwoCompanySearch`. `clearSelectedCompany()`
   * re-inits directly instead — see `sweepOrphanedDropdown()`.
   *
   * @param {Twoinc} [twoincInstance] the singleton, so `select2:select` can
   *   write the pick onto it. Falls back to `Twoinc.getInstance()`.
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
      // or an open signup popup (TWO-40 §7), so a pick can land here while
      // `mode === "sole_trader"`. Refused while still genuinely deciding
      // (isDeciding()), same guard every other sole-trader exit uses.
      // Once adopted, a pick off this still-live widget is the buyer
      // choosing a different company — mirrors `setMode("business")`'s
      // bookkeeping directly rather than calling `setMode()`, which would
      // also destroy/rebuild this widget and blank the pick being written.
      if (twoincSoleTrader.mode === "sole_trader") {
        if (twoincSoleTrader.isDeciding()) return;
        twoincSoleTrader.mode = "business";
        twoincSoleTrader.soleTraderAdopted = false;
        twoincSoleTrader.soleTraderReconfirmingCount = 0;
        twoincSoleTrader.updateChips();
        twoincSoleTrader.syncDifferentSoleTraderLink();
        // Doesn't go through setMode(), so owes the same re-sync itself.
        twoincSelectWooHelper.syncSoleTraderSurfaces();
        twoincSoleTrader.leaveSoleTraderMode();
      }

      const instance = twoincInstance || Twoinc.getInstance();
      const data = e.params.data;

      // The single write path (TWO-40 §5): posted fields, instance record,
      // pairing tag and provenance in one call — writing #company_id
      // directly would leave a pair the tag doesn't describe.
      twoincCompanyCapture.write(data.id, data.company_id, { country: self.currentCountry() });

      self.renderCompanySummary(data.id, data.company_id);

      // Leave any loader alone: getApproval() below only arms a check, the
      // replacement request is a moment away.
      twoincDomHelper.clearIntentVerdicts();

      instance.getApproval();

      if (window.twoinc.enable_address_lookup === "yes") {
        instance.addressLookup(data);
      }
    });

    self.fixSelectWooPositionCompanyName();

    // Bound here, once per widget, not on every dropdown open: the handlers
    // it installs are delegated and outlive the dropdown, so re-binding per
    // open only accumulates duplicates.
    self.bindManualEntryAffordance();

    widget.on("select2:open", function (e) {
      self.waitToFocus("billing_company_display", null, null);
      self.addSelectWooFocusFixHandler("billing_company_display");

      // In sole-trader mode this dropdown's free-text query isn't a way to
      // get a different company — the dedicated "select a different sole
      // trader" flow is. Re-run every open since selectWoo re-attaches this
      // row each time, so a suppression from one open doesn't carry over.
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
  /** Add a placeholder after an input, used for moving fields in the DOM. */
  addPlaceholder: function ($el, name) {
    let $placeholder = jQuery("#twoinc-" + name + "-source");
    if ($placeholder.length > 0) return;
    $placeholder = jQuery('<div id="twoinc-' + name + '-source" class="twoinc-source"></div>');
    $placeholder.insertAfter($el);
  },
  /** Move a field to Twoinc template location and leave a placeholder. */
  moveField: function (selector, name) {
    const $el = jQuery("#" + selector);
    twoincDomHelper.addPlaceholder($el, name);
    const $target = jQuery("#twoinc-" + name + "-target");
    $el.insertAfter($target);
  },
  /** Move a field back to its original location. */
  revertField: function (selector, name) {
    const $el = jQuery("#" + selector);
    const $source = jQuery("#twoinc-" + name + "-source");
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
    // entry is reachable only via `enterManualCompanyEntry` — never as a side
    // effect of Two being unavailable or of the merchant's admin setting, both
    // of which used to silently downgrade a registered-company/sole-trader
    // buyer into manual entry the moment Two stopped being selected. WHERE the
    // control renders is `company_search_location`'s business, below; never
    // whether it's active.
    const showCompanySearch =
      twoincDomHelper.isCountrySupported() && twoincCompanyCapture.mode !== "manual";

    // `#company_id_field` is never in `visibleTargets`, in any mode: the
    // captured number is never typed into, only reaches the buyer as the
    // read-only label `renderCompanySummary()` renders. The input itself
    // stays permanently hidden but posted, since its value is what the order
    // intent is authorised against.
    if (showCompanySearch) {
      visibleTargets.push("#billing_company_display_field");

      // WooCommerce's own native company field stays independent of where
      // our search control lives: unchecking "Enable company search in
      // address entry" moves the search control into the payment tile but
      // must never take WooCommerce's stock field away from the address
      // area — the two coexist. Left untouched (no required cue): WC owns
      // that field's required-ness, this plugin only decides visibility.
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

    // Relocate the company-search control (TWO-25326 §7.1) before
    // renderCompanySummary() below: the summary's anchor is relative to
    // whichever field is currently its neighbour, and this call may just
    // have moved that field's wrapper into the tile.
    twoincSelectWooHelper.syncCompanySearchTileLocation();

    twoincSelectWooHelper.renderCompanySummary();

    // After it: the "select a different sole trader" link anchors against
    // whichever company-NAME field this function just decided to show.
    twoincSoleTrader.syncDifferentSoleTraderLink();
  },
  /**
   * Mirror each company field's visibility onto its enclosing wrapper
   * (TWO-25288). The pay-for-order page lays company inputs out in
   * per-field wrappers with their own hidden state, which the function
   * above doesn't touch — a no-op on the checkout page, which has no such
   * wrappers.
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
  deselectPaymentMethod: function () {
    const paymentMethodRadioObj = jQuery(':input[value="' + window.twoinc.gateway_id + '"]');
    if (paymentMethodRadioObj) {
      paymentMethodRadioObj.prop("checked", false);
    }
  },
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
   * (TWO-25326 §7.3): "<name> (<number>)", or bare <name> when there's no
   * number. Never "<name> ()" — an absent number is genuinely absent.
   */
  getCompanyLabelText: function (name, number) {
    // TWO-25326 §12: bracket composition and synthetic-number suppression
    // both live in twoincUtilHelper — the search dropdown needs the same
    // rule with a different escaping contract, and the two must not drift.
    return twoincUtilHelper.formatCompanyLabel(name, number);
  },
  /**
   * Write a verdict box's sentence, only when it isn't already that
   * sentence: `.text()` mutates the child text node unconditionally, which
   * inside a `role="status"`/`role="alert"` region re-announces the same
   * verdict to assistive tech on every unrelated re-render.
   */
  setPayBoxText: function ($box, text) {
    // Per element, not per set: `.text()` on a multi-element set returns
    // the concatenation of all of them, so comparing the whole set can miss
    // a case where one copy already matches and another doesn't. Walking
    // element-wise gets every copy right without over-mutating any of them
    // — reachable if a fragment swap ever leaves two copies of the gateway
    // description live.
    $box.each(function () {
      const $one = jQuery(this);
      if ($one.text() === text) return;
      $one.text(text);
    });
  },
  /**
   * The company label a verdict should name: the snapshot taken when the
   * request was issued, or a live DOM read when there's none. Snapshotting
   * fixes a wrong-company verdict: these sentences re-read the DOM at paint
   * time, but supersession only starts when the next request is issued, so
   * a response for company A landing in that gap could paint A's verdict
   * with B's name in it.
   *
   * The live read stays as the fallback for callers re-rendering rather
   * than reporting a response (`updateElements()`, picker handlers), where
   * the DOM is the current truth.
   */
  resolveCompanyLabel: function (snapshot) {
    // Empty snapshot honoured deliberately (`typeof`, not truthiness): ""
    // means the capture read blank when the request went out. Falling back
    // to a live read here was tried and reverted — by paint time the buyer
    // may have moved to another company, reintroducing the wrong-company
    // defect the snapshot exists to prevent.
    if (typeof snapshot === "string") return snapshot;
    return twoincDomHelper.readCompanyLabelFromDom();
  },
  /**
   * `<name> (<number>)` from the order-intent record — the same
   * `customerCompany` the request body is built from, so a verdict's
   * sentence and the question it answers can never name different
   * companies.
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
    return twoincDomHelper.getCompanyLabelText(
      twoincUtilHelper.blankToEmpty(captured.company_name),
      twoincUtilHelper.blankToEmpty(captured.organization_number)
    );
  },
  /**
   * Take any previous order-intent verdict off screen, and nothing else
   * (TWO-25326). The loading state is deliberately left alone: a request
   * from an earlier check may still be in flight with the loader up for
   * it, and blanket-hiding would blink the spinner off until the new
   * request is actually issued.
   */
  clearIntentVerdicts: function () {
    // "Every pay-box except the loading state", rather than a list of the
    // verdict classes, so a brand overlay or later ticket adding a fourth
    // verdict box is still covered.
    jQuery(".twoinc-pay-box").not(".twoinc-loader").addClass("hidden");
  },
  togglePaySubtitleDesc: function (action, errSelector, companyLabel) {
    jQuery(".twoinc-pay-box").addClass("hidden");
    if (["checking-intent", "intent-approved", "errored"].includes(action)) {
      if (action === "checking-intent") {
        // Suppressed by the brand => the loader div is absent, so this is a
        // no-op on an empty jQuery set.
        jQuery(".twoinc-pay-box.twoinc-loader").removeClass("hidden");
      } else if (action === "intent-approved") {
        // The notice ships the no-company sentence as its text and the
        // company variant as a template on data-company-template. Substitute
        // always from the template, so a later company change re-renders and
        // an emptied company falls back to the served sentence. TWO-25326
        // §7.3: the token stands for the whole "<name> (<number>)" chunk.
        let intentBox = jQuery(".twoinc-pay-box.twoinc-intent-approved");
        if (intentBox.data("twoincDefaultText") === undefined) {
          intentBox.data("twoincDefaultText", intentBox.text());
        }
        // Unhidden before its text is written, not after: role="status"/
        // role="alert" only announce a content change made while the region
        // is in the accessibility tree, and this function hides every
        // pay-box first — writing then revealing would mutate a region not
        // yet in the tree, then reveal one with no change to announce.
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
  getPrice: function (priceName) {
    let node =
      document.querySelector("." + priceName + " .woocommerce-Price-amount bdi") ||
      document.querySelector("." + priceName + " .woocommerce-Price-amount");
    return twoincDomHelper.getPriceRecursively(node);
  },
  rearrangeDescription: function () {
    let twoincPaymentBox = jQuery(".payment_box.payment_method_" + window.twoinc.gateway_id);
    if (twoincPaymentBox.length > 0) {
      twoincPaymentBox.after(jQuery(".abt-twoinc"));
    }
  },
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
              // The empty-field hint (TWO-25288) is an element child, so
              // without this it would be snapshotted as though the buyer had
              // chosen a company of that name (getCompanyName() reads this
              // value into #billing_company). Excluded from `subs` too, or
              // loadStorageInputs() would render it twice.
              hasPlaceholder = true;
              return;
            }
            subs.push(val.outerHTML);
          }
        });
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
   * Re-capture a company the page arrived already holding, through the one
   * capture write path (TWO-40 §5), so the restored pair carries its
   * pairing tag — written raw the pair would have none, and the retype
   * guard would read that as "number no longer belongs to this name" and
   * wipe a perfectly good restored capture on the buyer's first keystroke.
   *
   * Called after each of initialize()'s two restore passes, since either
   * can supply the pair: the user-meta echo exists only for a signed-in
   * WordPress user, while a guest's company reaches the DOM without it
   * (WooCommerce's own rendered value, or loadStorageInputs() one call
   * later).
   */
  restoreCapturedCompany: function () {
    const metaName = window.twoinc.billing_company;
    const metaId = window.twoinc.company_id;
    const domName = twoincCompanyCapture.nameField().val();
    const domId = twoincCompanyCapture.numberField().val();

    // Both halves from one source, never a half from each — a tag mixing
    // one restore's name with another's number would describe a company
    // that never existed. The source holding a number wins; the user-meta
    // echo breaks the tie as the more deliberate record.
    const fromUserMeta = Boolean(metaId) || (Boolean(metaName) && !domId);
    const restoredName = fromUserMeta ? metaName : domName;
    const restoredId = fromUserMeta ? metaId : domId;

    // Nothing to restore without a number, unless the echo is the source
    // (a name alone there is still a deliberate manual-entry record). A
    // bare name in the FIELD is not: initialize() can run after the buyer
    // has typed, and stamping plugin provenance on their own typing would
    // let a later country switch clear it as plugin-written.
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

    // A restored sole trader: this restore path writes straight to the
    // capture layer above rather than through `twoincSoleTrader.setCompany()`
    // (the only place that sets `mode`/`soleTraderAdopted` and syncs the
    // "select a different sole trader" link), so without this a returning
    // buyer has no way back into a fresh signup. `isSyntheticCompanyNumber`
    // tells a restored sole trader's `TWO:…` id apart from a registry number.
    if (twoincUtilHelper.isSyntheticCompanyNumber(restoredId)) {
      twoincSoleTrader.mode = "sole_trader";
      twoincSoleTrader.soleTraderAdopted = true;
      twoincSoleTrader.syncDifferentSoleTraderLink();
    }

    // Re-evaluate the company fields: the write above changes what
    // `#company_id`'s visibility depends on (TWO-25326 §12). Kept here
    // rather than at the initialize() call site so the re-toggle can't be
    // separated from the write by a later reordering.
    twoincDomHelper.toggleBusinessFields();
  },
  /** Id of current or parent theme, or undefined if not found. */
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
  // Snapshot of twoincCompanyCapture.mode, taken on the way into sole-trader
  // mode and restored on the way out. A buyer can reach sole-trader mode
  // while in manual entry, and without this they'd come back out into
  // `search` instead, with the link back to the picker never shown.
  // `null` means "nothing saved", distinct from every real mode value.
  savedCaptureMode: null,
  messageListenerBound: false,
  /** @type {Function|null} the bound `message` listener, so it can be removed */
  messageHandler: null,
  /** @type {Function|null} the bound window `focus` listener — see `bindWindowRefocusListener` */
  refocusHandler: null,
  /**
   * @type {Function|null} the bound capture-phase `mousedown` listener that
   * tells the refocus above which gesture caused it.
   */
  chipMousedownHandler: null,
  /**
   * @type {number|null} the pending abandon this refocus scheduled, or
   * `null` when none is outstanding — also the "is a refocus still
   * undecided" predicate the chip mousedown reads.
   */
  refocusAbandonTimer: null,
  /**
   * How long the abandon waits for the click that caused the refocus to
   * identify itself. A window `focus` is dispatched before the `mousedown`
   * that produced it, so the decision can't be made in the focus handler —
   * it has to outlive it by long enough for that mousedown to arrive.
   */
  refocusChipGraceMs: 150,
  /**
   * How many sole-trader round trips are outstanding (TWO-40 §7).
   *
   * A COUNT, not a boolean: a re-signup can be launched while an earlier
   * popup's own close poll is still running, so two flights overlap. A
   * boolean would take the busy state down at the first settle and leave the
   * second running invisibly.
   *
   * Wired to the real async duration — every terminal branch of the call graph
   * settles its own flight — never to a fixed timeout. Adversarial review of
   * this exact feature upstream found stuck-forever spinners on two separate
   * abandon/retry paths, so every `cb(...)` below is a settle point.
   *
   * Held by `watchPopupClose()` for as long as the signup popup itself is
   * open, and by the ACCEPTED handler across its own buyer lookup.
   */
  flightDepth: 0,

  /**
   * Re-entrancy guard on the signup popup (TWO-40 §7): without it a double
   * click opens a second popup over the first. Released when the popup
   * call returns, not when the popup closes — holding it until signup
   * finishes would strand the buyer if they closed the window by hand.
   */
  openingSignup: false,

  /**
   * True once `setCompany()` has actually adopted a company while in
   * sole-trader mode this time through (TWO-40 §7). Reset by every
   * `setMode()` call. `watchPopupClose()`'s "did the buyer abandon this
   * popup with nothing captured" check reads this instead of `#company_id`'s
   * raw value, since that field can already hold an unrelated id from an
   * earlier capture that `setMode("sole_trader")` never clears.
   */
  soleTraderAdopted: false,

  /**
   * How many "select a different sole trader" re-signups are outstanding
   * (TWO-40 §7). `soleTraderAdopted` is a one-way latch set by the first
   * adoption and never cleared except by `setMode()`, which a re-signup
   * never calls — so without this count, `isDeciding()` would read the
   * stale `true` as "already settled" during a re-signup's own flight,
   * letting the Business chip revert mode and clear fields mid-signup.
   *
   * A count, not a boolean: two re-signups can be genuinely concurrent
   * (close one, re-click within the same poll window), and a boolean would
   * let the first popup's stale poll clear state the second still needs.
   * Incremented by `launchSignup` per re-signup opened; decremented exactly
   * once per popup by that popup's own decrement owner. Clamped at zero.
   */
  soleTraderReconfirmingCount: 0,

  /**
   * True while the ACCEPTED-postMessage handler's own `fetchCurrentBuyer()`
   * is in flight (TWO-40 §7). Popup-close detection is a poll with no
   * cooperation from the popup, so the buyer can close the window the
   * instant "ACCEPTED" is posted, well before this fetch resolves and
   * writes `#company_id` — without this flag `watchPopupClose()`'s poll
   * could revert to business out from under a signup about to complete.
   */
  signupConfirming: false,

  /**
   * One record per live `watchPopupClose` poll: `{ id, win, isReconfirming,
   * decided }`. `id` is the `setInterval` handle; `win` is the popup, which
   * lets an inbound message be attributed to the record that sent it.
   * `decided` is the popup's own outcome, distinct from the global
   * `soleTraderAdopted`/`soleTraderReconfirmingCount` state another popup
   * can move while this one is still open — so an accepted-then-closed
   * popup can't spend two decrements against its one increment.
   *
   * Two or more records can be undecided at once: `launchSignup` refuses
   * only a live undecided popup, so a hand-closed one stays in this list
   * until its own poll notices. `findPopupWatcher` owns the attribution.
   */
  activePopupWatchers: [],

  /**
   * A signup popup has been opened during this flow, so the company-search
   * dropdown must be closed if it's open once the flow completes. A flag
   * rather than a call at popup-open time because the close belongs at the
   * end of the flow — consumed exactly once at depth zero, so any number of
   * nested flights resolve to one close.
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
    // The mode chip lives inside the company-search dropdown, not here —
    // re-sync so an availability change while it's open adds/removes live.
    twoincSelectWooHelper.syncManualEntryButton();
  },

  hide: function () {
    jQuery(".twoinc-sole-trader-note-slot").addClass("hidden").empty();
    jQuery("#" + twoincSoleTrader.differentSoleTraderBtnId).hide();
    // Refused while `isBusy()`, same as the Business chip: this runs from
    // `refresh()` on every `updated_checkout` (coupon, shipping, quantity —
    // not only country), so an unconditional revert would drop a signup
    // still completing in the popup. `watchPopupClose` re-checks adoption
    // once it settles, so deferring here loses nothing.
    if (twoincSoleTrader.mode === "sole_trader" && !twoincSoleTrader.isBusy()) {
      twoincSoleTrader.setMode("business");
    }
  },

  render: function () {
    const cfg = twoincSoleTrader.config();
    const $container = jQuery(".twoinc-sole-trader-note-slot");
    $container.empty().removeClass("hidden");

    // Bell-icon note + signup link — shown only when sole-trader mode is
    // active and signup is needed, and as the fallback when an
    // auto-launched popup is blocked. The mode chips themselves are NOT
    // built here — they render as children of the company-search dropdown,
    // see syncManualEntryButton()/syncSoleTraderChip().
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

    // Minted here rather than at click time, since `window.open()` outside
    // the click's own gesture is blocker bait. Tokens are country-scoped,
    // not email-scoped, so one mint per page serves every launch.
    //
    // The callback re-decides the "select a different sole trader" link: a
    // sole trader restored from a previous order is already adopted before
    // any mint has happened, and that link only shows once `tokens` is real.
    if (!twoincSoleTrader.tokens) {
      twoincSoleTrader.fetchTokens(function () {
        twoincSoleTrader.syncDifferentSoleTraderLink();
      });
    }
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
   * A sole-trader round trip has started (TWO-40 §7). The busy state is
   * shown over the company-NAME field — the same in-field spinner an
   * ordinary company search uses — rather than in the query row it hides,
   * so it's visible for the link-click entry point too, which never has a
   * dropdown open to paint in.
   */
  beginFlight: function () {
    twoincSoleTrader.flightDepth += 1;
    if (twoincSoleTrader.flightDepth === 1) {
      // The note slot and the chip group — the two places busy state is
      // ever visible.
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
   * (TWO-40 §7). Same visual slot and shape as the "search for company"
   * link manual entry already offers. One link covers both "pick a
   * different existing registration" and "register a new one" — that
   * choice happens inside the hosted signup's own UI.
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
   * Default home is `companyFieldAffordanceSlot()`, same slot as the
   * "search for company" link — correct for manual entry and an ordinary
   * registered-company pick, both of which leave that field visible.
   *
   * TWO-40 §7 makes an adopted sole trader show through the live search
   * widget instead, which hides `#billing_company_field` outright — a
   * button appended inside a hidden field never renders. So this follows
   * the search field itself whenever that (not the native field) is what's
   * actually shown, re-anchoring on every call the same way
   * `getCompanySummaryNode()` does.
   */
  placeDifferentSoleTraderBtn: function ($btn) {
    const $searchField = jQuery("#billing_company_display_field");
    if (jQuery("#billing_company_field").hasClass("hidden") && $searchField.length) {
      const $wrapper = $searchField.closest(".twoinc-inp-container");
      let $anchor = $wrapper.length ? $wrapper : $searchField;
      // Behind the number label while that's the visible one, in front of
      // it otherwise: this link and the label compete for the one slot
      // right after the field, and exactly one of the two is ever visible
      // (label in registered-search mode, link in sole-trader mode), so
      // ordering by visibility gives the slot to whichever can use it.
      const $summary = jQuery("#" + twoincSelectWooHelper.companySummaryId);
      if ($summary.length && !$summary.hasClass("hidden") && $summary.prev()[0] === $anchor[0]) {
        $anchor = $summary;
      }
      if ($btn.prev()[0] !== $anchor[0]) $btn.insertAfter($anchor);
      return;
    }
    // Only move when not already there, same as getCompanySummaryNode():
    // this runs on every toggleBusinessFields() call.
    const $slot = twoincSelectWooHelper.companyFieldAffordanceSlot();
    if ($btn.parent()[0] !== $slot[0]) $slot.append($btn);
  },

  /**
   * Show the "select a different sole trader" link only where it means
   * something: sole-trader mode (TWO-40 §7). Gated on mode + tokens only,
   * no `#company_id`-content check — that field is permanently hidden in
   * every mode, so there's no reason to lean on its DOM value here.
   */
  syncDifferentSoleTraderLink: function () {
    const show = twoincSoleTrader.mode === "sole_trader" && !!twoincSoleTrader.tokens;
    // Built lazily, only when about to be shown: this runs on every mode
    // switch, and building it eagerly would insert a hidden button into
    // the address form of every merchant who never sees this feature.
    if (!show && !jQuery("#" + twoincSoleTrader.differentSoleTraderBtnId).length) return;
    twoincSoleTrader.getDifferentSoleTraderBtnNode().toggle(show);
  },

  /**
   * A mode chip was clicked. Business is immediate; Sole trader switches mode
   * then opens the hosted signup in the same synchronous gesture as the click.
   */
  onModeChipClick: function (mode) {
    if (mode === "business") {
      // Same isDeciding() guard the real Business chip's own wiring uses,
      // so this shared entry point doesn't regress if called elsewhere.
      if (!twoincSoleTrader.isDeciding()) twoincSoleTrader.setMode("business");
      return;
    }
    // A signup the buyer hasn't finished is still on screen, so this click
    // is asking for it back, not for anything new: raise it and stop.
    // Checked on the chip itself, not the refocus that usually precedes it
    // — a chip activated from the keyboard fires `click` with no
    // `mousedown`, so a raise hung off the refocus would leave Enter/Space
    // as the one route that can't get the buyer back to their popup.
    if (twoincSoleTrader.refocusOpenPopups()) return;
    // Re-clicking once already adopted is the same re-signup the "select a
    // different sole trader" link launches, not a no-op — the chip is a
    // second, equally deliberate way to ask for it. `autoselect: false` so
    // the hosted flow offers a choice rather than handing back the
    // registration already adopted.
    if (twoincSoleTrader.mode === "sole_trader" && twoincSoleTrader.soleTraderAdopted) {
      twoincSoleTrader.launchSignup({ autoselect: false });
      return;
    }
    twoincSoleTrader.setMode("sole_trader");
    // Always the hosted signup, no conditional fast path: a company may
    // only ever be filled in by the buyer's own trip through that flow. The
    // passive email-driven autofill probe this used to consult could
    // populate fields off a Two session cookie the buyer never
    // authenticated against.
    twoincSoleTrader.launchSignup();
  },

  /**
   * Is a sole-trader autofill flight or a signup popup currently
   * outstanding (TWO-40 §7)? The guard every other way to leave/interrupt
   * sole-trader mode checks before acting: the widget/chips deliberately
   * survive this window, so paths once unreachable while
   * `mode === "sole_trader"` (Business chip, reopenSearch(), an ordinary
   * pick) are reachable now, and acting on them mid-wait races the flow's
   * own resolution.
   */
  isBusy: function () {
    return twoincSoleTrader.flightDepth > 0 || twoincSoleTrader.activePopupWatchers.length > 0;
  },

  /**
   * Is sole-trader mode still deciding what it is, as opposed to already
   * adopted with `activePopupWatchers` only nonzero because the poll hasn't
   * yet noticed the popup closed? `isBusy()` alone over-blocks a direct exit
   * from sole-trader mode once `soleTraderAdopted` is true and the outcome
   * is already settled. ORed with `soleTraderReconfirming`, since
   * `soleTraderAdopted` is a one-way latch that doesn't turn back off for a
   * "select a different sole trader" re-signup.
   */
  isDeciding: function () {
    return (
      twoincSoleTrader.isBusy() &&
      (!twoincSoleTrader.soleTraderAdopted || twoincSoleTrader.soleTraderReconfirmingCount > 0)
    );
  },

  /**
   * Switch mode and toggle the company-search suppression. No token/buyer
   * work happens here — that is owned by the chip-click handler.
   */
  setMode: function (mode) {
    // Only an actual transition resets adoption/reconfirmation state: a
    // redundant same-mode `setMode("sole_trader")` must not zero a live
    // re-signup's own `soleTraderReconfirmingCount` mid-flight.
    const isTransition = mode !== twoincSoleTrader.mode;
    twoincSoleTrader.mode = mode;
    if (isTransition) {
      twoincSoleTrader.soleTraderAdopted = false;
      twoincSoleTrader.soleTraderReconfirmingCount = 0;
    }
    twoincSoleTrader.updateChips();
    twoincSoleTrader.syncDifferentSoleTraderLink();
    // Before the branch below, so a chip click made while the dropdown is
    // already open hides the query row in the click's own gesture — the
    // business branch destroys this dropdown a few lines down, so the
    // restore has to happen while the row still exists.
    twoincSelectWooHelper.syncSoleTraderSurfaces();

    if (mode === "sole_trader") {
      // Sole trader is its own company-capture mode: it renders through the
      // picker but carries a synthetic id, so neither manual entry nor an
      // ordinary registry pick's surfaces are right for it. Snapshotted
      // first so it can be restored on the way out.
      if (twoincSoleTrader.savedCaptureMode === null) {
        twoincSoleTrader.savedCaptureMode = twoincCompanyCapture.mode;
      }
      twoincCompanyCapture.mode = "sole_trader";
      // The search widget teardown is deliberately NOT done here: tearing
      // it down the instant mode switches would destroy the dropdown before
      // the autofill round trip (or the signup popup it can lead to) has
      // had a chance to run — the window `beginFlight()` says the
      // dropdown+spinner must survive. `lockCapturedFields()` does this
      // instead, once `setCompany()` actually has a company to show.
    } else {
      twoincSoleTrader.leaveSoleTraderMode();
      const $display = jQuery("#billing_company_display");
      if ($display.data("select2")) {
        // The one teardown this whole switch does — `lockCapturedFields()`
        // no longer destroys the widget on adoption, so it's alive on every
        // switch back to business, not just the pre-adoption edge case.
        // close() before destroy(): destroy() alone on an open widget skips
        // selectWoo's own close cleanup.
        $display.select2("close");
        $display.select2("destroy");
      }
      twoincSoleTrader.setCompany("", "");
      twoincDomHelper.toggleBusinessFields();
      Twoinc.getInstance().enableCompanySearch();
      // The buyer may have been in manual entry when they switched to sole
      // trader, in which case the restored mode is `manual` and
      // enableCompanySearch just early-returned — without this the link back
      // to search stays hidden with no other route back to the picker.
      if (twoincCompanyCapture.mode === "manual") {
        twoincSelectWooHelper.getSearchCompanyBtnNode().show();
      }
    }
  },

  /**
   * The state/DOM bookkeeping every real exit from sole-trader mode needs,
   * regardless of what happens to the search widget on the way out
   * (TWO-40 §7): `setMode`'s own business branch tears the widget down, but
   * a pick made directly off the still-live widget must not also go
   * through that teardown, since it would blank the pick before `write()`
   * ever runs. Split out so both paths share identical "leaving" semantics.
   */
  leaveSoleTraderMode: function () {
    twoincSoleTrader.showNote(false);
    jQuery("#billing_company, #company_id").prop("readonly", false);
    if (twoincSoleTrader.savedCaptureMode !== null) {
      twoincCompanyCapture.mode = twoincSoleTrader.savedCaptureMode;
      twoincSoleTrader.savedCaptureMode = null;
    }
    // A popup-close poll left over from a resolved adoption/re-signup keeps
    // `isBusy()`/`isDeciding()` true purely on its own 300ms cadence. This
    // is the one place every caller has already committed to leaving
    // sole-trader mode, so whatever that poll was still going to decide is
    // moot — left running it would race a deferred manual-entry switch,
    // wrongly refusing it while the stale busy state persists.
    twoincSoleTrader.abandonSoleTraderFlow();
  },

  /**
   * Give up on everything the sole-trader flow still has outstanding, as
   * one operation: the popup windows and the records tracking them
   * (TWO-40 §14). Called only from `leaveSoleTraderMode()`.
   *
   * Closing comes before dropping the records, since the records hold the
   * only handles there are — closing after would leave the window on
   * screen with nothing tracking it, letting the next chip click open a
   * second popup over it. Every tracked window is closed here, not just the
   * undecided ones `closeAbandonedPopups()` acts on, since mode has already
   * left `sole_trader` by the time this runs.
   */
  abandonSoleTraderFlow: function () {
    twoincSoleTrader.activePopupWatchers.forEach(function (watcher) {
      if (watcher.win.closed || typeof watcher.win.close !== "function") return;
      watcher.win.close();
    });
    twoincSoleTrader.stopAllPopupWatchers();
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
   * leaves the live instance in place, one fewer destroy/rebuild than
   * every other re-attach path in the file relies on `attach()` to do
   * safely. Any fragment replace that discards the underlying `<select>`
   * without calling destroy is still covered by `attach()`'s own orphan
   * sweep (`sweepOrphanedDropdown`, TWO-25469).
   *
   * Seeds the widget's underlying `<select>` with an option for the
   * adopted sole trader and selects it (TWO-40 §7), the same
   * synthetic-`<option>` mechanism `loadUserMetaInputs()` uses to restore a
   * returning buyer's pick — so the rendered selection reads the sole
   * trader's name like an ordinary pick, and `getCompanyName()` (which
   * reads this in sole-trader mode) has something to find.
   *
   * `.trigger("change")`, not `select2:select`: select2's own documented
   * mechanism for a programmatic selection to update its rendered display,
   * deliberately not re-entering `select2:select`'s own write path
   * (`setCompany()`, already called above this).
   */
  lockCapturedFields: function (companyId, companyName) {
    const $display = jQuery("#billing_company_display");
    if ($display.data("select2")) {
      $display.select2("close");
    } else if ($display.length) {
      // Attached before the seed below, so that seed's own closing
      // `.trigger("change")` is what renders the selection: manual entry
      // destroys this widget and the Sole trader chip isn't hidden there,
      // so an adoption can land with no picker attached, and
      // `getCompanyName()` needs the picker's rendered container to read a
      // name from at all.
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
   * Click-to-reopen (TWO-40 §7): once a sole trader is adopted, the
   * captured fields readonly-lock and the query row is suppressed, leaving
   * no way back to an ordinary company search except the "select a
   * different sole trader" link, which only leads back into the same
   * hosted signup. Clicking into either captured field instead reverts to
   * business mode and lands the buyer in the reopened dropdown, same as
   * `exitManualCompanyEntry()` does leaving manual entry.
   *
   * Refused while `isDeciding()`, not the wider `isBusy()`: a captured
   * field only readonly-locks once `lockCapturedFields()` runs (deferred
   * for the whole autofill/popup wait), so reverting mode out from under
   * that wait would drop a completed signup, since the ACCEPTED handler
   * also gates on `mode === "sole_trader"`. Once adopted, refusing the
   * click just because the popup-close poll hasn't caught up would
   * reintroduce that bug for the length of the poll.
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
   * Open the hosted signup popup, falling back to the visible link if the
   * browser blocks the window. Re-entrancy-guarded (TWO-40 §7): a second
   * activation while one is already opening is dropped, and a later
   * activation is dropped for as long as an already-open popup's outcome
   * is still undecided.
   *
   * A re-signup (`options.autoselect === false`) is also refused while a
   * different one is already outstanding: `openingSignup` only guards two
   * clicks in the same synchronous gesture, not a later sequential one —
   * closing one re-signup and re-clicking is exactly the case that made
   * `soleTraderReconfirmingCount` a count rather than a boolean.
   */
  launchSignup: function (options) {
    if (twoincSoleTrader.openingSignup) return;
    // One live undecided popup at a time. "Live" is load-bearing: a
    // hand-closed record stays undecided until its own poll notices, and a
    // relaunch is deliberately allowed to open alongside it — reading
    // "undecided" alone would mis-attribute an inbound ACCEPTED (see
    // `findPopupWatcher`). Scoped to each popup's own outcome rather than
    // `isDeciding()`, which would strand a chip click when no popup exists
    // and only a stale flight is outstanding.
    if (
      twoincSoleTrader.signupConfirming ||
      twoincSoleTrader.activePopupWatchers.some(function (watcher) {
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
        // different sole trader" link, and a re-click of the chip once
        // already adopted — are a genuinely new decision launched from a
        // stale-true `soleTraderAdopted`; see that flag's own comment.
        //
        // Incremented only once a popup has actually opened: a blocked
        // re-signup calls neither `watchPopupClose` nor the ACCEPTED
        // handler, so incrementing unconditionally would strand the count
        // above zero until an unrelated `setMode()` reset it.
        const isReconfirming = !!(options && options.autoselect === false);
        if (isReconfirming) {
          twoincSoleTrader.soleTraderReconfirmingCount += 1;
        }
        twoincSoleTrader.closeDropdownOnSettle = true;
        twoincSoleTrader.watchPopupClose(win, isReconfirming);
      }
    } finally {
      // Released once the synchronous open has returned, blocked or not —
      // held any longer and a blocked popup would lock the buyer out of
      // retrying via the fallback link.
      twoincSoleTrader.openingSignup = false;
    }
  },

  /**
   * Keep the search dropdown's spinner up for as long as the signup popup
   * is open, and settle it the moment the buyer closes the window
   * (TWO-40 §7). `window.closed` polling is the only signal a same-origin
   * opener has for "the popup went away", with no cooperation from the
   * popup and no event for it. If nothing was adopted by close time, hand
   * the checkout back to an ordinary company search.
   *
   * Reads `soleTraderAdopted`, not `#company_id`'s raw value, which can
   * hold an unrelated id from an earlier capture and would wrongly read as
   * "already adopted". Also skips the revert while `signupConfirming`:
   * the ACCEPTED handler's own `fetchCurrentBuyer()` can still be resolving
   * when this poll notices the window closed, and that handler is the sole
   * authority once a signup has completed.
   *
   * @param {Window} win the popup returned by `window.open`
   * @param {boolean} [isReconfirming] whether this popup was a re-signup —
   *   only decrement `soleTraderReconfirmingCount` for the popup that
   *   actually incremented it, so an unrelated popup's poll can't steal a
   *   decrement meant for a different, still-open re-signup.
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
   * Everything one popup's window going away settles. Called by that
   * popup's own poll above, and — only on the mode-chip abandon path —
   * synchronously by `abandonPopupsForChipClick()`. Factored out so the
   * settle keeps one owner (TWO-40 §14) for `flightDepth`,
   * `soleTraderReconfirmingCount` and `closeDropdownOnSettle`.
   *
   * @param {Object} watcher the record whose window has gone
   * @param {boolean} chipOwnsOutcome a mode-chip click is mid-gesture and
   *   owns the mode and dropdown from here
   */
  settleClosedPopup: function (watcher, chipOwnsOutcome) {
    twoincSoleTrader.stopWatchingPopup(watcher.id);
    if (chipOwnsOutcome) {
      // Consumed, not honoured: the chip decides what happens to the
      // dropdown, and closing it here would destroy the button whose
      // `click` hasn't been dispatched yet.
      twoincSoleTrader.closeDropdownOnSettle = false;
    }
    twoincSoleTrader.settleFlight();
    if (watcher.isReconfirming && !watcher.decided) {
      // Abandoned without a decision — this settle owns the decrement. A
      // decided popup's decrement belongs to the ACCEPTED handler instead.
      twoincSoleTrader.soleTraderReconfirmingCount = Math.max(
        0,
        twoincSoleTrader.soleTraderReconfirmingCount - 1
      );
    }
    if (
      // Skipped on the chip path: `setMode`'s business branch destroys the
      // dropdown the chip lives in, and reverting here would make the
      // Registered company chip's own "already in business mode" no-op
      // swallow the click.
      !chipOwnsOutcome &&
      twoincSoleTrader.mode === "sole_trader" &&
      !twoincSoleTrader.soleTraderAdopted &&
      !twoincSoleTrader.signupConfirming &&
      // A popup relaunched inside this poll's stale window owns the mode
      // now — reverting under it would drop its eventual ACCEPTED on the
      // `mode !== "sole_trader"` gate.
      //
      // "Still on screen" is the question, not "still undecided": a popup
      // whose ACCEPTED resolved to no buyer is decided yet still open, and
      // a retry inside it posts a second ACCEPTED a revert would drop on
      // that same gate.
      !twoincSoleTrader.activePopupWatchers.some(function (other) {
        return !other.win.closed;
      })
    ) {
      twoincSoleTrader.setMode("business");
    }
  },

  /**
   * Close an abandoned signup popup when the buyer comes back to the
   * checkout.
   *
   * A window `focus` listener, not `visibilitychange`: the hosted signup is
   * a separate window, so the checkout's own tab never leaves `visible` for
   * the round trip and that event never fires. Bound lazily from
   * `watchPopupClose`, left bound for the window's lifetime like the
   * `message` listener.
   *
   * The target check is not defensive noise: jQuery's `.trigger("focus")`
   * does not dispatch natively — it walks the propagation path itself,
   * window included. This file triggers focus that way on the company
   * fields (`focusVisibleCompanyField`, `releaseFocusFromCompanyField`), so
   * without the check, opening the dropdown would close the popup.
   *
   * The refocus only SCHEDULES the abandon — which of three things the
   * buyer meant depends on what they clicked, and window `focus` fires
   * before that click's `mousedown` — so the decision has to outlive the
   * focus handler by `refocusChipGraceMs`, resolved by the capture-phase
   * `mousedown` below:
   *
   *  - Sole trader chip → cancel the abandon; re-clicking asks for that
   *    popup back and `onModeChipClick` raises it.
   *  - any other mode chip → abandon now, in the mousedown, so the chip's
   *    `click` handler runs after against settled state — left to the
   *    timer it would land after that click and the chip's `isDeciding()`
   *    guard would wrongly refuse it.
   *  - anything else (alt-tab back, a click on the page) → the timer fires
   *    and abandons.
   *
   * Capture phase, on `document` rather than the chips: chips are rebuilt
   * on every dropdown open, and capture reaches them regardless.
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
   * Close every signup popup whose outcome is still open, and nothing else.
   * `window.close()` on a handle this page's own `window.open()` returned
   * is permitted regardless of origin, so this can be a real close.
   *
   * Closing the window is the whole action — spinner, mode revert and
   * dropdown close happen exactly as for a popup closed by hand:
   * `watchPopupClose`'s poll sees `.closed` within its next 300ms tick and
   * runs its own terminal branch, keeping one owner for the settle
   * (TWO-40 §14).
   *
   * Decided popups are left alone: a popup whose ACCEPTED resolved to no
   * buyer is decided yet still on screen, and the buyer's retry inside it
   * posts a second ACCEPTED — closing it would take the retry with it.
   *
   * This is the no-chip refocus only — a chip click is resolved before
   * this ever runs; see `bindWindowRefocusListener` and
   * `abandonPopupsForChipClick`.
   */
  closeAbandonedPopups: function () {
    twoincSoleTrader.abandonablePopups().forEach(function (watcher) {
      if (typeof watcher.win.close !== "function") return;
      watcher.win.close();
    });
  },

  /**
   * Abandon the signup popups because the buyer came back to the checkout
   * by clicking a mode chip other than Sole trader. Same close as
   * `closeAbandonedPopups`, but runs in the chip's own `mousedown` and
   * drains each popup's settle synchronously rather than leaving it to the
   * 300ms poll, so the chip's `click` handler a moment later sees no
   * outstanding flight or live popup. Safe to drain early only because
   * `chipOwnsOutcome` holds back the steps that touch the dropdown — see
   * `settleClosedPopup`.
   */
  abandonPopupsForChipClick: function () {
    twoincSoleTrader.abandonablePopups().forEach(function (watcher) {
      if (typeof watcher.win.close === "function") watcher.win.close();
      twoincSoleTrader.settleClosedPopup(watcher, true);
    });
  },

  /**
   * Bring the still-undecided signup popups back to the front. `focus()`
   * on a window handle needs no cooperation from the hosted flow however
   * cross-origin it is.
   *
   * @returns {boolean} whether there was a popup to raise
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
   * Decided popups are excluded: a popup whose ACCEPTED resolved to no
   * buyer is decided yet still on screen, and a retry inside it posts a
   * second ACCEPTED — closing that window would take the retry with it.
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
   * `event.source` is the authoritative answer — a WindowProxy stays
   * reference-comparable across origins. An exact match wins even when
   * already `decided`, so a replayed ACCEPTED resolves to the popup it
   * came from rather than stealing a different, still-undecided popup's
   * identity.
   *
   * The fallbacks cover a popup that closes in the same turn it posts,
   * which can arrive with `source` already null. Both scan newest first: a
   * forward scan can return a stale hand-closed record ahead of the live
   * popup that actually sent the message, marking the wrong one decided.
   *
   * An unmatched non-null `source` deliberately falls back too, rather
   * than refusing to pair: mis-marking a record in an unattributable
   * replay is cheaper than stranding `soleTraderReconfirmingCount` on any
   * browser whose `source` is not reference-equal to what `window.open`
   * returned.
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
   *   address and phone number are written too (§2.6, §5)
   * @returns {void}
   */
  setCompany: function (companyId, companyName, buyer) {
    if (companyId && twoincSoleTrader.mode === "sole_trader") {
      // The moment there is actually a sole trader captured — not just a
      // mode switch (TWO-40 §7) — is the moment there is nothing left to
      // search for. Locking here, not on every switch into sole-trader
      // mode, is what lets the dropdown+spinner survive the autofill/popup
      // round trip.
      twoincSoleTrader.lockCapturedFields(companyId, companyName);
      // Read by `watchPopupClose()` in place of `#company_id`'s raw value.
      twoincSoleTrader.soleTraderAdopted = true;
    }
    twoincCompanyCapture.write(companyName, companyId);
    // The display select too, when this is the clearing call setMode("business")
    // makes. select2("destroy") leaves the picker's appended <option> selected,
    // so without this a company picked before the sole-trader detour stayed on
    // that select after being cleared from both posted fields (TWO-25288).
    if (!companyName) {
      jQuery("#billing_company_display").val("");
    }
    const instance = Twoinc.getInstance();
    // The buyer's address, written regardless of the merchant's
    // address-lookup switch (TWO-40 §5): that switch legitimately gates an
    // ordinary company-search pick's address write in configurations that
    // have nothing to do with sole-trader signup, but a buyer who just
    // enrolled must still have their address land. Explicit bypass rather
    // than making the switch context-aware.
    const buyerAddress = buyer && (buyer.billing_address || buyer.address);
    if (companyId && buyerAddress) {
      instance.setAddress(buyerAddress);
      instance.registryAddressApplied = true;
    }
    if (companyId && buyer && buyer.phone_number) {
      jQuery("#billing_phone").val(buyer.phone_number);
    }
    // Re-evaluate which company fields are shown, after the write above
    // (TWO-25326 §12): `#company_id`'s visibility depends on the value it
    // now holds. Every route into sole-trader capture toggles the fields
    // before the autofill lands, so without this the minted `TWO:…`
    // identifier lands in a field made visible on the strength of being
    // empty, and stays on screen until an unrelated toggle happens.
    twoincDomHelper.toggleBusinessFields();
    // Explicit rather than DOM-read: this function is the authority on what
    // was just captured, so the summary should not depend on write order
    // (TWO-25288).
    twoincSelectWooHelper.renderCompanySummary(companyName, companyId);
    twoincSoleTrader.syncDifferentSoleTraderLink();
    if (companyId) {
      instance.getApproval();
    }
  },

  /**
   * Mint the delegation + autofill tokens. Invokes cb(true) once tokens are
   * available (also binding the signup postMessage listener), cb(false) on
   * any failure. Tokens are short-lived, so `scheduleTokenRefresh()` re-mints.
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
        // flight — same guard `refresh()` uses for availability. Without
        // it, a slower request for the country the buyer just left can
        // land after a newer one and overwrite `tokens` with delegated
        // authority for the wrong jurisdiction.
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
   * sole trader", which reads `tokens` long after adoption.
   *
   * Started once, from the first successful mint, not eagerly on page
   * load: a buyer who never touches the sole-trader flow never mints a
   * token and has nothing to refresh.
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
   * The 30-minute refresh tick. Skipped, silently, while the signup popup is
   * outstanding — `isBusy()` is the same guard the other paths use, and that
   * flight's own settle leaves `tokens` fresh regardless. A failed re-mint
   * (network error, expired session) is left for the next scheduled tick,
   * same tolerance `fetchTokens` itself already has for its callers.
   *
   * Deliberately does NOT also call `beginFlight()`/`settleFlight()` itself
   * (round-1 review, rejected): holding the flag for a background round trip
   * nobody asked for would only over-block the Business chip,
   * `reopenSearch()` and click-to-reopen. `fetchTokens`'s own
   * country-staleness guard (round-2 review) is what keeps a late response
   * from overwriting `tokens` for the wrong jurisdiction.
   *
   * @returns {void}
   */
  refreshTokens: function () {
    if (twoincSoleTrader.isBusy()) return;
    twoincSoleTrader.fetchTokens(function () {});
  },

  /**
   * `pagehide` fires on a bfcache-eligible navigation too, where the page is
   * only frozen and JS timer state (including this interval) survives the
   * freeze/resume untouched. Tearing the interval down on that path would
   * leave a buyer restored from bfcache with a dead refresh loop for the
   * rest of the session, so only a real unload (`event.persisted` false)
   * stops it.
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
   * `window.open()`, not an iframe-in-overlay: the signup/OTP flow depends
   * on a third party that only works in a real popup window. The call
   * stays synchronous with the click that triggered it — an
   * async-delayed `window.open()` is blocker bait in every browser — which
   * is why the chip-click path opens on tokens minted up front rather than
   * issuing a request first.
   *
   * Brand overlays need nothing added here: a branded deployment resolves
   * this URL's host from the brand registry's own URL template (see
   * WC_Twoinc_Helper::get_environment_host and the brand's
   * `checkout_url_template`). A `?brand=`/`?brandVersion=` query-string
   * form also exists, but is a development-loop affordance, not the
   * mechanism to build on.
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
    // PDEV-4669: server-vetted country only — a DOM read would let the buyer
    // pick their own verification flow.
    const country = (twoincSoleTrader.tokens.country || "").toUpperCase();
    if (country) url += "&country=" + encodeURIComponent(country);
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
        // `findPopupWatcher`. Marked decided at receipt so its close poll
        // must not treat it as abandoned or spend its reconfirming
        // decrement (that belongs to this handler's callback below).
        const watcher = twoincSoleTrader.findPopupWatcher(event.source);
        // A replayed ACCEPTED resolves to its own, already-decided popup;
        // only the receipt that actually settles a popup may spend its
        // decrement below.
        const newlyDecided = !!watcher && !watcher.decided;
        if (watcher) {
          watcher.decided = true;
        }
        twoincSoleTrader.beginFlight();
        // Held for the duration of this fetch: the popup can close the
        // instant "ACCEPTED" is posted, well before this resolves and
        // writes `#company_id` — `watchPopupClose()`'s own poll checks
        // this before deciding the buyer abandoned signup with nothing
        // captured.
        twoincSoleTrader.signupConfirming = true;
        twoincSoleTrader.fetchCurrentBuyer(function (buyer) {
          // Authenticated path (TWO-40 §8): the server has just told this
          // browser who the buyer is, so the email they authenticated with
          // is the answer, full stop. Re-checking it against the
          // checkout's own contact field is a confirmed bug: a buyer who
          // signs up under a different address completes OTP, the stale
          // email match disagrees with the server, and the same popup
          // reopens forever.
          const resolved = !!buyer;
          twoincSoleTrader.signupConfirming = false;
          // Decremented here rather than only on popup close so a resolved
          // re-signup un-blocks the Business chip/`reopenSearch()`
          // immediately, not after another 300ms poll cycle. `newlyDecided`
          // covers a late or replayed ACCEPTED, which must not spend a
          // second decrement against one increment.
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
          // Last, after the capture above has actually landed: this used
          // to settle before the write, so on the ordinary path the
          // spinner came down and the dropdown closed while the company
          // name and number were still unwritten. "Flow complete" is the
          // write, not the response.
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
      // Monotonic supersession counter for the order-intent request, same
      // idiom as `addressLookupSeq` above. Bumped when a request is issued
      // and by every abandon, so a response is only allowed to act if it
      // is still the newest question asked. Without it: two checks can
      // overlap and arrive in reverse order, letting an older verdict win
      // over a company/cart the buyer already moved on from; or a
      // response can arrive after the check was abandoned by a Place
      // Order click, painting a verdict onto a checkout already mid-submit.
      seq: 0,
      // The seq of the request currently in flight, or null. This is the
      // only record that a check is running between the interval being
      // disarmed and the response arriving, so abandonOrderIntentCheck()
      // has to consult it.
      inFlightSeq: null,
      // The jqXHR of the request in flight, so a superseded one can be
      // dropped instead of left to run. Without this, rapid edits stacked
      // one POST per second against a 30s timeout — up to thirty
      // outstanding requests, all but the last already unwanted.
      inFlightXhr: null,
      // Ticks spent waiting for a readable cart total. The interval body
      // cannot proceed without one and used to retry forever, leaking a
      // 1s timer for the life of the page. See the `!gross_amount` branch.
      // Reset in exactly one place — where a check is armed — because
      // that is the only place it can be stale by the time it matters.
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

    // Enable company search, then again on a delay to catch a billing
    // fragment that WooCommerce had not rendered yet when initialize()
    // ran. This retry is the only one this code owns: `updated_checkout`
    // does not re-attach the picker itself.
    //
    // Wrapped rather than passed by reference (TWO-25337): `setTimeout`
    // invokes a bare method reference with the global as its receiver, so
    // `this` inside enableCompanySearch would be `window` and the
    // deferred pass would write `billingCompanySelect` onto `window`
    // instead of this instance.
    //
    // Pre-existing, not fixed here (TWO-25338): the deferred re-run
    // leaves the picker's `select2:select`/`select2:open` handlers
    // duplicated, since they're bound unnamespaced and selectWoo's
    // re-init `.off(".select2")` can't match them. The duplicate
    // `select2:select` costs nothing beyond idempotent re-renders and
    // re-entering `getApproval()`'s already-running guard; the duplicate
    // `select2:open` costs two no-op focus nudges.
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
      // Disarms any in-flight order-intent request. That response is the
      // only writer of `#tracking_id`; in practice none is lost, since
      // WooCommerce serialises the form after this handler runs, so a
      // response that hadn't already landed would have missed the
      // submission anyway.
      Twoinc.getInstance().abandonOrderIntentCheck();
    });

    $body.on("checkout_error", function () {
      // Abandon, then re-arm. The buyer is still on the page and about to
      // correct a field, but `checkout_error` does not fire
      // `updated_checkout`, so nothing else would run another check — the
      // tile would sit blank for the rest of the page. `getApproval()`
      // no-ops when the form is not ready, so this costs nothing on errors
      // unrelated to this gateway.
      // Re-arm only if a check was actually interrupted: unconditionally,
      // `getApproval()`'s own clear would wipe a perfectly good verdict
      // that the abandon had just been careful to leave alone.
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
      // and captures nothing. For a guest that pass is the only one that ever
      // supplies a company, so without this the restored pair carries no
      // pairing tag and a restored sole trader never reaches `sole_trader`
      // mode.
      twoincDomHelper.restoreCapturedCompany();
    }

    // Seed the country tracker here — after the two restore passes above,
    // not next to the binding that reads it (TWO-24867 / TWO-25326).
    //
    // `loadStorageInputs()` writes #billing_country with `selectElem.value =`
    // and fires no `change`. Seeded before it, the tracker would hold the
    // country the page was rendered with while the field held the restored
    // one, and the first re-render afterwards would read the difference as
    // a real country change — destroying the company and address that same
    // restore had just put back.
    //
    // Seeding at all is what tells the two first-event cases apart: with no
    // seed the first country the page ever sees is adopted rather than
    // acted on — right for the re-render WooCommerce fires at init, wrong
    // for a buyer who changes country before any re-render happens.
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
    // Clear the verdict, not the loading state. This runs on every
    // `updated_checkout`, and WooCommerce fires that for a shipping-method
    // change or a coupon — neither of which has any bearing on a request
    // already in flight.
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
   * Retire whatever order-intent request is in flight.
   *
   * Bumping the counter is what makes the response a no-op; the abort is
   * purely so the connection is not held open for an answer nobody will
   * read. The order matters: the counter moves first, so the `.fail` that
   * jQuery synchronously runs for an abort already fails its own
   * `stillCurrent()` check and cannot deselect the gateway or paint a
   * decline.
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
    // Only touch the UI when there was actually something in flight.
    // `#place_order` fires on clicks that never submit — an HTML5
    // constraint failure, WooCommerce's own client-side validation — and
    // `checkout_error` fires for errors unrelated to this gateway, such as
    // a missing postcode. Resetting unconditionally would wipe a
    // perfectly good verdict in both cases, and neither fires
    // `updated_checkout`, so nothing would bring it back.
    // `inFlightSeq` is included because the interval is disarmed before
    // the request goes out, so for the whole duration of the XHR every
    // other flag here reads falsy — an abandon in that window would
    // otherwise skip the reset and leave the loader on screen with its
    // response orphaned.
    // One question, not two: resetting for a merely armed check is safe
    // because every route that arms a check calls `clearIntentVerdicts()`
    // in the same breath, so "armed" already implies nothing of ours is
    // on screen.
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

    // Returned so callers can tell "I stopped something" from "there was
    // nothing to stop" — `checkout_error` re-arms only in the first case.
    return wasRunning;
  }

  /**
   * Check the company approval status by creating an order intent
   */
  getApproval() {
    if (!this.isReadyApprovalCheck()) {
      // A form that has become incomplete cannot answer the question a
      // request in flight is asking. Orphan it, and take the loading state
      // down with it — otherwise the spinner runs until a response the
      // checkout will refuse to use finally arrives.
      // A pending paint counts as well as a request in flight: once
      // `stillCurrent()` has released `inFlightSeq` the response is banked
      // and only the paint is left, and letting it land writes a verdict
      // about a form the buyer has since emptied.
      if (
        this.orderIntentCheck.inFlightSeq !== null ||
        this.orderIntentCheck.renderInterval !== null
      ) {
        this.abandonOrderIntentCheck();
      }
      return;
    }

    // Clear the previous verdict here — and only clear it. The loading
    // state goes up where the request is actually issued, in the interval
    // body below.
    //
    // Clearing at this one choke point is the whole of TWO-25326's third
    // requirement, and it has to be here rather than per-caller: several
    // of the routes in did no clearing of their own, so the buyer changing
    // company kept reading "<old company> is not available for this
    // order" until the new result arrived.
    //
    // Showing the loader here too was tried and reverted: it decoupled the
    // loading state's lifetime from the request's, producing stranded,
    // blanked and duplicated spinners. Tied to the request instead, the
    // loader is up exactly while a request is outstanding, by
    // construction rather than by patching every exit.
    //
    // Above the interval guard on purpose: a call arriving while a check
    // is already armed is a newer question, so the older verdict is stale
    // from this moment either way.
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
        // Bounded, not forever: there are carts where a total never
        // succeeds (a 100%-discounted order's total of 0 is falsy every
        // tick; a theme whose totals markup `getPrice()` can't read never
        // yields one). An unbounded interval would leak for the life of
        // the page and keep `pendingCheck` re-entering the 3s poller.
        //
        // Ten ticks: the only legitimate reason to wait is a totals block
        // WooCommerce is still re-rendering, which is sub-second. Giving
        // up costs nothing — the next blur or `updated_checkout` arms a
        // fresh check.
        if (++Twoinc.getInstance().orderIntentCheck.priceWaitTicks < 10) return;
        // Disarm quietly: no loading state is up during the price wait —
        // it goes up with the request — so there is nothing of this
        // check's to take off screen, and abandonOrderIntentCheck()'s
        // blanket reset would instead wipe whatever else was there.
        // Deliberately does not touch an outstanding request either —
        // that is a live question this wait knows nothing about.
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
        // This body has already been answered — render the cached verdict
        // and disarm: leaving the interval running would re-render the
        // cached verdict every second forever, and leave `pendingCheck`
        // permanently set, keeping the 3s poller re-entering
        // `getApproval()` indefinitely.
        clearInterval(Twoinc.getInstance().orderIntentCheck.interval);
        Twoinc.getInstance().orderIntentCheck.interval = null;
        Twoinc.getInstance().orderIntentCheck.pendingCheck = false;
        // And retire anything in flight: a request issued for an earlier
        // body can still be outstanding here, and its answer would land
        // afterwards and paint over the verdict this branch is about to
        // show — the cached one being, by construction, the answer to the
        // body the form holds right now.
        Twoinc.getInstance().supersedeInFlightOrderIntent();
        twoincDomHelper.togglePaySubtitleDesc(
          ...Twoinc.getInstance().orderIntentLog[hashedBody].split("|")
        );
        return;
      }
      if (!Twoinc.getInstance().isReadyApprovalCheck()) {
        // Nothing of this check is on screen yet — the loading state goes
        // up with the request, below — so this is a disarm, and
        // abandonOrderIntentCheck()'s reset is a no-op unless an earlier
        // check left a request or a paint outstanding. Reachable whenever
        // the buyer empties a required field in the second between arming
        // and this tick.
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

      // Retire the previous request before issuing this one: the interval
      // is disarmed before a request goes out, so nothing stops a second
      // check arming and POSTing while the first was still outstanding —
      // at one per second against a 30s timeout, up to thirty in flight,
      // all but the last already superseded. This also claims this
      // request's place in the queue, so both handlers can tell whether
      // they are still the newest question asked (see `seq`/`inFlightSeq`).
      Twoinc.getInstance().supersedeInFlightOrderIntent();
      const seq = Twoinc.getInstance().orderIntentCheck.seq;
      Twoinc.getInstance().orderIntentCheck.inFlightSeq = seq;
      // The company this request is about, captured now rather than
      // re-read when its verdict is painted, and read from
      // `customerCompany` — the same record the request body above is
      // built from, rather than `#billing_company`/`#company_id`, which
      // can diverge from it (see `clearCompanyIfCountryStale()`).
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
        // Bounded, like the company-search transport already is. A request
        // that never settles calls neither handler, and both the loader
        // coming down and the verdict appearing hang off those handlers —
        // so a hung connection would mean "Checking availability" for the
        // rest of the page. A timeout arrives as a `.fail` with status 0,
        // which paints the generic decline and is deliberately not cached.
        timeout: 30000,
        data: jsonBody
      });
      Twoinc.getInstance().orderIntentCheck.inFlightXhr = approvalResponse;

      approvalResponse.done(function (response) {
        if (!stillCurrent()) return;

        // A 200 whose JSON body parses to `null` — or to anything that is
        // not an object — makes every read below a TypeError. It throws
        // after `stillCurrent()` has released `inFlightSeq`/`inFlightXhr`
        // and before the paint is armed, so the loader would be stranded
        // for the rest of the page with nothing left able to reset it.
        // Normalising to `{}` sends it down the not-approved branch,
        // which is the right reading of an unusable body.
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

        // Display messages and update order intent logs. The hash is
        // passed rather than read back off a shared slot: because the
        // interval is disarmed before the request goes out, a second
        // check could be armed and overwrite that slot while the first
        // was still in flight, mis-filing the first response under the
        // second request's body.
        //
        // `false` is "this is not a failure" — read from the jQuery
        // callback we are in rather than sniffed off the payload: jQuery
        // hands `.done` the parsed response body, so a `status` field in
        // that body would otherwise be read as an HTTP status.
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
      // `isFailure &&`: on the success path `response` is the parsed
      // response body, so an API that returns a field called `status`
      // would otherwise send a perfectly good 200 down the HTTP-error
      // branch below.
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

      // Cache the verdict against the request body that produced it — but
      // only when it is a verdict.
      //
      // The cached branch disarms the timer and issues no request, so a
      // cached answer is permanent for the rest of the page. That is right
      // for an answer and catastrophic for a hiccup: one dropped
      // connection would decline this cart and company until the buyer
      // reloaded.
      //
      // A declining 200 is an answer. So is most of the 4xx range — the
      // backend refusing this order with a reason. Not cacheable: anything
      // on the transport (status 0, our own timeout), any 5xx, and the
      // four 4xx codes that mean "ask again" rather than "no" — 401 and
      // 403 (a session or key that can be refreshed), 408 (a timeout the
      // server noticed first) and 429 (rate limiting).
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
    // Bounded, and cancellable. This is the only code that takes the
    // loading state down, so an overlay that never clears would mean
    // "Checking availability" for the rest of the page. The timer is kept
    // on the instance rather than a local so abandonOrderIntentCheck() can
    // reach it: a Place Order click resets the tile, and an unreachable
    // copy would paint a verdict back onto a checkout already mid-submit.
    let renderWaitTicks = 0;
    // The paint is tied to the check that produced it. Neither the issue
    // path nor the cached branch clears `renderInterval`, so a paint
    // still pending from an earlier response would fire afterwards and
    // put a stale verdict over the loader — or over the verdict — of the
    // check that superseded it.
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
        // Give up on this paint only, rather than calling
        // abandonOrderIntentCheck(): that helper also bumps the
        // supersession counter and clears `pendingCheck`, neither of
        // which has anything to do with an overlay refusing to clear —
        // bumping the counter here would silently orphan a newer check
        // already armed while this paint was waiting.
        clearInterval(this.orderIntentCheck.renderInterval);
        this.orderIntentCheck.renderInterval = null;

        // Reset unconditionally: getting here means `paintSeq === seq`
        // (the guard above would have returned otherwise), and issuing a
        // request bumps `seq` after this paint's `paintSeq` was captured
        // — so an outstanding request implies `paintSeq !== seq`, and
        // `inFlightSeq` is always null at this line. A neutral tile is
        // therefore always the right end state here.
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
    // Record the billing country, and nothing else (TWO-24867). A
    // re-render can move the field with no `change` event, and without
    // this the tracker would hold the pre-re-render country for the rest
    // of the page, so a later genuine switch back to that value would
    // read as no change and be swallowed.
    //
    // Deliberately not `syncBillingCountry()`: these re-renders restore
    // the country and the company together, so clearing the capture here
    // would destroy what the same re-render just put back. Throwing away
    // a captured company needs the buyer's gesture, and the `change`
    // event is the only signal of one there is.
    //
    // Record-only is still not the whole answer: a country that moved to
    // something the captured company does not belong to leaves that
    // company captured and approved, surfacing as an opaque
    // order-creation failure. `clearCompanyIfCountryStale` below is the
    // discriminator — it fires on the countries disagreeing, not on the
    // country having moved, so it stays silent on the restore-together
    // case above (TWO-25333).
    const movedCountry = twoincSelectWooHelper.currentCountry();
    if (twoincSelectWooHelper.countryDidChange(movedCountry)) {
      // Invalidating in-flight work is safe here: this discards answers
      // to questions asked under a country that is no longer selected,
      // never captured state, so it is not something the buyer can lose.
      twoincSelectWooHelper.companySearchSeq += 1;
      Twoinc.getInstance().addressLookupSeq += 1;

      // Before updateElements() below: clearing before the approval pass
      // is the order in which `updateElements` sees the state the rest of
      // this event's work should be derived from.
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

    // TWO-25326 §7.1: called directly here, not only via
    // `toggleBusinessFields()`. `updated_checkout` fires on every
    // WooCommerce checkout AJAX refresh (shipping-method change, coupon
    // apply, quantity change), not only the payment-method/country
    // switches that call `toggleBusinessFields()`, and the server
    // re-renders a fresh, empty `.twoinc-company-search-tile-slot` on
    // every one of those refreshes.
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
      // Only when the blur actually moved the number (TWO-25333 — see the
      // picker's select handler for why the number and the country have
      // to be written together). This is a blur, not a change: tabbing
      // through an untouched `#company_id` fires it too, and re-pinning
      // there would launder a stale pair into a consistent-looking one —
      // the number would still be the previous country's company while
      // `country_prefix` got rewritten to the new one, and
      // `clearCompanyIfCountryStale` could never fire on it again.
      // Normalised on both sides, requiring a value: `organization_number`
      // is seeded null and written from parsed JSON by the sole-trader
      // prefill, so a raw `!==` would read 123456789 as different from
      // "123456789" and re-pin on a blur that moved nothing, and a blur
      // on an empty untouched field would count as movement ("" !== null).
      const previousNumber = twoincUtilHelper.blankToEmpty(
        Twoinc.getInstance().customerCompany.organization_number
      );
      const numberMoved = twoincUtilHelper.blankToEmpty(typed) !== previousNumber;
      // Stored raw, deliberately: normalising on the way in would change
      // the organisation number this plugin POSTs on the order intent
      // (`customerCompany` goes into `buyer.company` verbatim in
      // getApproval). Every comparison against it goes through
      // `blankToEmpty` rather than trusting its shape.
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
   * Bring everything that depends on the billing country back into step
   * with the field (TWO-24867). Reached only from the `change` handler on
   * #billing_country — the closest thing this checkout has to a buyer
   * gesture on the country.
   *
   * Everything destructive lives behind that gesture on purpose.
   * WooCommerce can also move the country with no `change` at all, and
   * running this from `updated_checkout` instead would destroy a country
   * and company restored together by the same re-render (TWO-25326).
   * `onUpdatedCheckout` therefore only records the country instead.
   */
  syncBillingCountry() {
    const country = twoincSelectWooHelper.currentCountry();
    const changed = twoincSelectWooHelper.countryDidChange(country);

    // Unconditional, and before the guard below: this pass is idempotent
    // and the events the guard swallows are exactly the ones that just
    // re-rendered the billing fields underneath it (TWO-24867).
    twoincDomHelper.toggleBusinessFields();

    // Everything past here is destructive, so only a real country change
    // gets to run it (TWO-25326). The rest of what this handler used to
    // do on those events is already re-run by `onUpdatedCheckout`.
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
    // The order-intent request is retired on this path too, but not from
    // here: `clearSelectedCompany()` below resets `customerCompany`
    // wholesale, so `self.getApproval()` at the end of this function finds
    // an incomplete form and retires the in-flight request through its
    // own readiness guard.
    // The company-search spinner, below — belt and braces: bumping the
    // counter above orphans the one an in-flight search is showing (its
    // `always()` sees a stale sequence and returns before hiding it), and
    // `clearSelectedCompany()` clearing it via widget re-attach is
    // otherwise only an incidental consequence of an unrelated call.
    twoincSelectWooHelper.toggleCompanySearchSpinner(false);

    // Skipped entirely while sole-trader mode owns the field: this
    // rebuilds the search widget and wipes `#company_id`/`#billing_company`
    // unconditionally, including a company already adopted this
    // sole-trader session and the dropdown a flight/popup wait is
    // deliberately keeping alive. `refresh()` below (sole-trader
    // availability, re-evaluated for the new country) decides whether to
    // revert instead, via `hide()`'s own `isBusy()` guard.
    if (twoincSoleTrader.mode !== "sole_trader") {
      twoincSelectWooHelper.clearSelectedCompany();
    }

    // After clearSelectedCompany, deliberately: that function resets
    // `customerCompany` to {} wholesale, so setting the country prefix
    // before it would discard it immediately and leave getApproval() and
    // getDueInDays() below running on an undefined country for the three
    // seconds until the deferred re-read inside clearSelectedCompany puts
    // it back (TWO-24867).
    self.customerCompany.country_prefix = country;

    // Sole trader availability is per-country; re-evaluate the toggle.
    twoincSoleTrader.refresh();

    self.getApproval();
  }

  /**
   * Drop a captured company that belongs to a country the checkout has
   * since moved away from (TWO-25333).
   *
   * The gap this closes: `onUpdatedCheckout` records a country that moved
   * with no `change` event and deliberately does not clear the capture,
   * since those re-renders restore the country and the company together
   * (TWO-24867 / TWO-25326). But when the country really did move away
   * from the captured company, that company survives and `getApproval()`
   * posts an internally-consistent stale pair the intent check approves,
   * while the order payload pairs that `company_id` with the order's
   * actual billing country — a mismatch that reaches the Two API at order
   * creation as an opaque failure. Discriminating instead of always/never
   * clearing is what avoids reintroducing TWO-25326: in the
   * restore-together case the recorded country and the captured
   * company's own country agree by construction, so this stays silent
   * exactly where clearing would be destructive.
   *
   * Called only from `onUpdatedCheckout` — `syncBillingCountry` already
   * clears unconditionally on a real country change, which is strictly
   * stronger.
   *
   * Not grounds to clear:
   *   - No organisation number on `customerCompany` (a name with no id is
   *     not a capture, TWO-25326 §6).
   *
   *     Known residual gap: `customerCompany` is populated from the DOM
   *     on a timer, so `#company_id` can hold a real capture while this
   *     object still holds nulls (during `initialize()`'s deferred seed,
   *     and for three seconds after `clearSelectedCompany`). A silent
   *     country move inside one of those windows is missed, and the
   *     deferred re-read then un-pins the witness via `getCompanyData()`,
   *     which reads `#billing_country` live. Benign today because
   *     `organization_number` is empty there and every downstream guard
   *     refuses on that. Closing it properly means stopping DOM re-reads
   *     from overwriting a pinned `country_prefix` — a change to
   *     `getCompanyData()`'s contract, left for its own ticket.
   *   - An unknown country on either side — same rule as the
   *     address-lookup guard and `countryDidChange`: only two countries
   *     that are both known and different are evidence of anything.
   *   - The DOM already holding a different company from the one
   *     recorded: then the record is stale, not the fields (a re-render
   *     swapped in another saved country+company pair), and clearing
   *     would destroy what the re-render just restored.
   *
   * Compared case-insensitively: `currentCountry()` upper-cases,
   * `getCompanyData()` reads `#billing_country` raw.
   *
   * @param {string} country upper-cased ISO code the checkout has moved to
   * @returns {void}
   */
  clearCompanyIfCountryStale(country) {
    const company = this.customerCompany || {};
    if (!company.organization_number) return;

    const capturedCountry = twoincUtilHelper.blankToEmpty(company.country_prefix).toUpperCase();
    // `!country` is unreachable from the only caller today: `countryDidChange`
    // already returns false on an empty reading. Kept as the guard a
    // second caller would need.
    if (!country || !capturedCountry || capturedCountry === country) return;

    // Every comparison below goes through `blankToEmpty`: `organization_number`
    // is seeded null and written from parsed JSON by the sole-trader
    // prefill, so it is not guaranteed to be a string, while `.val()`
    // always is — an un-normalised compare would turn a type mismatch
    // into either a laundered stale pair or a destructive clear.
    const domNumber = twoincUtilHelper.blankToEmpty(jQuery("#company_id").val());
    const domName = twoincUtilHelper.blankToEmpty(jQuery("#billing_company").val());
    const recordedNumber = twoincUtilHelper.blankToEmpty(company.organization_number);
    const recordedName = twoincUtilHelper.blankToEmpty(company.company_name);

    // The DOM holds a different company than the record: both halves
    // present and both diverged. Then it is the record that is stale, not
    // the fields — a re-render swapped in another saved address, country
    // and company together — and clearing would destroy what that
    // re-render just restored.
    //
    // Requiring only the number to diverge would be fail-open: a buyer
    // typing into `#company_id` without blurring produces the same
    // divergence, and this branch would then pin the new country onto a
    // number no capture path had witnessed, next to the previous
    // company's name.
    //
    // This rule holds on WooCommerce's own re-render paths because
    // `#company_id` is a registered billing field
    // (`$fields['billing']['company_id']` in WC_Twoinc_Checkout), living
    // in the same billing fragment as `#billing_company`, so every
    // WC-driven re-render writes both from the same vintage. One mirror
    // moving alone is therefore evidence of something other than a
    // re-render.
    //
    // Anything else falls through to the clear, deliberately fail-closed:
    // a diverged number with an empty `#billing_company` is not trusted,
    // since taking the name from the record instead would pair company
    // A's name with company B's number and leave `isReadyApprovalCheck()`
    // refusing forever with no deferred re-read to recover it.
    //
    // Read field by field rather than through `getCompanyData()`: in
    // company-search mode that takes the name from `getCompanyName()`,
    // which reads the `checkoutInputs` sessionStorage snapshot rather
    // than the DOM, so the name would come from a different moment than
    // the number and the country. `#billing_company` is the field
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
    //   - Whitespace, on either side. The record picks it up because the
    //     manual blur handler stores what the field holds; the DOM picks
    //     it up from a paste or a trailing space typed with no blur.
    //
    // `country_prefix: country` rather than a fresh `currentCountry()`
    // read: written as the argument so the value this pairs the company
    // with is provably the one the change was detected against.
    //
    // `company_name: domName` needs no fallback: the condition guarantees
    // `domName` is non-empty, and falling back to the record's name would
    // pair company A's name with company B's number — the two-moment
    // pair this whole function exists to prevent.
    if (domNumber && domName && domNumber !== recordedNumber && domName !== recordedName) {
      this.customerCompany = {
        company_name: domName,
        country_prefix: country,
        organization_number: domNumber
      };
      return;
    }

    // No supersession bump here, deliberately: the only caller has
    // already bumped both counters, unconditionally, on the country
    // having moved before it reaches this.
    twoincSelectWooHelper.clearSelectedCompany();

    // After clearSelectedCompany, for the reason spelled out in
    // syncBillingCountry: it resets `customerCompany` to {} wholesale, so
    // an assignment made before it is dropped and leaves getApproval()
    // and getDueInDays() with no country for the three seconds until its
    // deferred re-read runs.
    this.customerCompany.country_prefix = country;
  }
}

let instance = null;
let isTwoincSelected = null;
jQuery(function () {
  if (window.twoinc) {
    // WooCommerce core's own payment-method radio handler fires a bare
    // `payment_method_selected` event on document.body, never
    // `update_checkout`. This gateway's buyer surcharge fee
    // (apply_cart_fee) is conditional on the chosen payment method, so
    // without an explicit recalculation trigger here the fee would
    // neither appear when switching to this gateway nor disappear when
    // switching away, until something unrelated happened to fire
    // update_checkout first.
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
        // country change). Re-check on every updated_checkout; and when
        // company search is enabled for other methods, wire it
        // immediately — that state exists precisely for checkouts where
        // this gateway isn't offered.
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
