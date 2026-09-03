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

  /** A wc-ajax proxy endpoint, by its key in the `api_proxy` bootstrap. */
  proxyUrl: function (key) {
    return (window.twoinc.api_proxy || {})[key] || "";
  },

  proxyCsrfToken: function () {
    return (window.twoinc.api_proxy || {}).csrf_token || "";
  },

  /** Backoff after a 429: the server's Retry-After, clamped, 60s when absent. */
  retryAfterMs: function (jqXHR) {
    let seconds = 0;
    if (jqXHR && typeof jqXHR.getResponseHeader === "function") {
      seconds = parseInt(jqXHR.getResponseHeader("Retry-After"), 10);
    }
    if (!(seconds > 0)) seconds = 60;
    return Math.min(seconds, 300) * 1000;
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

  /** WooCommerce is billing-first, so the form the buyer meets first IS the invoice one. */
  primary: function () {
    return twoincAddressRoles.invoice();
  },

  /** `#`-prefixed selector of one field on a role's form. */
  field: function (role, name) {
    return "#" + role + "_" + name;
  },

  /** Live (not saved/session) value of one field on a role's form, trimmed. */
  value: function (role, name) {
    return (jQuery(twoincAddressRoles.field(role, name)).val() || "").trim();
  },

  /** One role's country, upper-cased, or "" when absent/unset (TWO-24867). */
  country: function (role) {
    return twoincAddressRoles.value(role, "country").toUpperCase();
  },

  /**
   * Whether the delivery address is part of this order at all. WooCommerce
   * keeps shipping fields in the DOM permanently, gated on "Ship to a
   * different address?"; unchecked, it ignores them on submit and uses
   * billing. Absence of the checkbox means the theme always shows the form, so
   * that's in-play.
   */
  deliveryFormIsInPlay: function () {
    const $toggle = jQuery("#ship-to-different-address-checkbox");
    return $toggle.length === 0 || $toggle.is(":checked");
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
 * The name field moves with the control's mount (see `nameFieldSelector`).
 */
let twoincCompanyCapture = {
  /**
   * Capture state, one record per address ROLE. Keyed by role rather than held
   * flat so a control mounted on a second role cannot inherit the primary
   * role's pairing tag, provenance or capture mode.
   */
  records: {},

  /** The record for one role, created on first use. */
  record: function (role) {
    const key = role || twoincAddressRoles.primary();
    if (!twoincCompanyCapture.records[key]) twoincCompanyCapture.records[key] = { mode: "search" };
    return twoincCompanyCapture.records[key];
  },

  /**
   * Which of the three company-capture UIs is the buyer's ACTIVE input surface
   * (#486, Doug): `'search'` (the registry search panel, the default),
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
   * This accessor is the PRIMARY role's mode; `modeFor`/`setModeFor` reach any
   * other role's.
   *
   * @type {'search'|'manual'|'sole_trader'}
   */
  get mode() {
    return twoincCompanyCapture.record().mode;
  },

  set mode(value) {
    twoincCompanyCapture.record().mode = value;
  },

  modeFor: function (role) {
    return twoincCompanyCapture.record(role).mode;
  },

  setModeFor: function (role, value) {
    twoincCompanyCapture.record(role).mode = value;
  },

  /** Attribute holding the name/number pairing tag. */
  PAIRING_ATTR: "data-two-company-pairing",

  /** Attribute marking a value as plugin-written rather than buyer-typed. */
  PROVENANCE_ATTR: "data-two-plugin-written",

  /**
   * In tile placement `#billing_company` is the buyer's own address line and
   * may hold a different company, so the capture keeps its own hidden carrier.
   * The tile hosts the primary role's control only.
   */
  nameFieldSelector: function (role) {
    const key = role || twoincAddressRoles.primary();
    return twoincSelectWooHelper.isTileLocation() && key === twoincAddressRoles.primary()
      ? "#company_name"
      : twoincAddressRoles.field(key, "company");
  },

  nameField: function (role) {
    return jQuery(twoincCompanyCapture.nameFieldSelector(role));
  },

  isNameField: function (element, role) {
    return jQuery(element).is(twoincCompanyCapture.nameFieldSelector(role));
  },

  /**
   * `#company_id` is registered server-side on the invoice role alone, so any
   * other role's number field resolves to markup that does not exist.
   */
  numberFieldSelector: function (role) {
    const key = role || twoincAddressRoles.primary();
    return key === twoincAddressRoles.invoice() ? "#company_id" : "#" + key + "_company_id";
  },

  numberField: function (role) {
    return jQuery(twoincCompanyCapture.numberFieldSelector(role));
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
   * call. THE only sanctioned writer of the role's number field.
   *
   * @param {*} companyName
   * @param {*} companyId
   * @param {Object} [options]
   * @param {string} [options.country] country the capture belongs to; defaults
   *   to the invoice-role country the form currently holds
   * @param {string} [options.role] address role captured for; defaults to primary
   * @returns {void}
   */
  write: function (companyName, companyId, options) {
    const opts = options || {};
    const role = opts.role || twoincAddressRoles.primary();
    const name = twoincUtilHelper.blankToEmpty(companyName);
    const number = twoincUtilHelper.blankToEmpty(companyId);
    const $name = twoincCompanyCapture.nameField(role);
    const $number = twoincCompanyCapture.numberField(role);

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
      twoincCompanyCapture.forgetPairing(role);
    }

    // Pin the country alongside the number so the pair can never be assembled
    // from two different moments (TWO-25333); only on a capturing write, and
    // on EVERY role's own record — `deliveryIsOrderCompanySource()` below
    // reads the delivery role's own pin when it becomes the fallback source.
    if (number) {
      twoincCompanyCapture.record(role).countryPrefix =
        opts.country || twoincAddressRoles.country(role);
    }

    // `buyer.company` on the order intent is billing (invoice) first,
    // shipping (delivery) only as a fallback when billing has captured no
    // company number at all (Doug 2026-08-31 §2).
    const instance = Twoinc.getInstance();
    if (role === twoincAddressRoles.invoice()) {
      // RAW `companyName`/`companyId` onto the record, exactly as before this
      // rule existed — this branch is unconditional, invoice always wins.
      instance.customerCompany.company_name = companyName;
      instance.customerCompany.organization_number = companyId;
      if (number) {
        instance.customerCompany.country_prefix = opts.country || twoincAddressRoles.country(role);
      } else {
        // Billing just lost its capture — shipping may now qualify as the
        // fallback. A qualifying shipping capture overrides the blanks just
        // written above; nothing qualifying leaves them blank with
        // `country_prefix` untouched, same invariant as before this rule.
        twoincCompanyCapture.syncOrderCompany();
      }
    } else if (
      !twoincCompanyCapture.hasCapture(twoincAddressRoles.invoice()) &&
      twoincCompanyCapture.deliveryFormExistsAndInPlay()
    ) {
      // The fallback role's own write reaches the order intent only while
      // billing has nothing AND the shipping form is genuinely part of this
      // order (§2) — same RAW-onto-record, country-pinned-only-on-capture
      // shape as the invoice branch above. Not gated on `hasCapture(delivery)`
      // itself: a CLEARING write (no number) must still blank
      // `customerCompany` when shipping was the source a moment ago.
      instance.customerCompany.company_name = companyName;
      instance.customerCompany.organization_number = companyId;
      if (number) {
        instance.customerCompany.country_prefix = opts.country || twoincAddressRoles.country(role);
      }
    }
  },

  /**
   * Is the delivery/shipping role currently the source `customerCompany`
   * should read from — billing has captured nothing, AND the shipping form
   * is genuinely part of this order (Doug 2026-08-31 §2)?
   *
   * Not merely present in the DOM (WooCommerce keeps shipping fields there
   * permanently) but in play (the "ship to a different address?" checkbox,
   * where present, is checked) and existing at all (a virtual/no-shipping
   * cart has no shipping country field for a capture to even attach a
   * country to).
   *
   * @returns {boolean}
   */
  deliveryIsOrderCompanySource: function () {
    if (twoincCompanyCapture.hasCapture(twoincAddressRoles.invoice())) return false;
    return (
      twoincCompanyCapture.deliveryFormExistsAndInPlay() &&
      twoincCompanyCapture.hasCapture(twoincAddressRoles.delivery())
    );
  },

  /**
   * Structural half of `deliveryIsOrderCompanySource()` — the shipping form
   * genuinely exists and is part of this order — WITHOUT asking whether it
   * currently holds a capture. `write()`'s own delivery-role branch needs
   * this half alone: a CLEARING write (no number) must still be allowed to
   * blank `customerCompany` when shipping was the source a moment ago, which
   * a `hasCapture(delivery)` gate would refuse the instant the clear itself
   * makes that false.
   *
   * @returns {boolean}
   */
  deliveryFormExistsAndInPlay: function () {
    const delivery = twoincAddressRoles.delivery();
    return (
      jQuery(twoincAddressRoles.field(delivery, "country")).length > 0 &&
      twoincAddressRoles.deliveryFormIsInPlay()
    );
  },

  /**
   * Re-derive `customerCompany` from whichever role currently qualifies as
   * the order-intent source, for every caller that mutates a role's capture
   * WITHOUT going through `write()` (manual-entry toggles, a country change,
   * the "ship to a different address?" checkbox) — `write()`'s own callers
   * get this inline, above, with the RAW value it was actually passed;
   * everyone else reads it back off the DOM.
   */
  syncOrderCompany: function () {
    const instance = Twoinc.getInstance();
    const invoice = twoincAddressRoles.invoice();
    // Read the DOM, not the cached `hasCapture()` truth from before this call:
    // a caller reaching this (a deferred re-read, a country change, a
    // checkbox toggle) may run after something wrote straight to the DOM
    // without going through `write()`, so `customerCompany` itself cannot be
    // trusted as the read source here.
    // Live, same as the invoice-only `getCompanyData()` this generalises:
    // country is read off the field, not the pin `write()` records, so a
    // country the buyer changed after capturing without re-searching is
    // reflected here rather than replayed from an earlier moment.
    if (twoincCompanyCapture.hasCapture(invoice)) {
      instance.customerCompany.company_name = twoincUtilHelper.blankToEmpty(
        twoincCompanyCapture.nameField(invoice).val()
      );
      instance.customerCompany.organization_number = twoincUtilHelper.blankToEmpty(
        twoincCompanyCapture.numberField(invoice).val()
      );
      instance.customerCompany.country_prefix = twoincAddressRoles.country(invoice);
      return;
    }
    if (!twoincCompanyCapture.deliveryIsOrderCompanySource()) {
      instance.customerCompany.company_name = "";
      instance.customerCompany.organization_number = "";
      return;
    }
    const delivery = twoincAddressRoles.delivery();
    instance.customerCompany.company_name = twoincUtilHelper.blankToEmpty(
      twoincCompanyCapture.nameField(delivery).val()
    );
    instance.customerCompany.organization_number = twoincUtilHelper.blankToEmpty(
      twoincCompanyCapture.numberField(delivery).val()
    );
    instance.customerCompany.country_prefix = twoincAddressRoles.country(delivery);
  },

  /**
   * Has Two captured a company — a registry pick or an adopted sole trader?
   *
   * Keyed on the org number rather than the name: manual entry captures a name
   * alone, and it is the number that makes a capture Two's rather than
   * WooCommerce's own field content.
   *
   * @returns {boolean}
   */
  hasCapture: function (role) {
    return twoincUtilHelper.blankToEmpty(twoincCompanyCapture.numberField(role).val()) !== "";
  },

  /** sessionStorage key holding the last capture mode and the pair it described. */
  CAPTURE_MODE_KEY: "twoincCaptureMode",

  /** Roles past the primary get their own key; the primary keeps the bare one. */
  captureModeKey: function (role) {
    const key = role || twoincAddressRoles.primary();
    return key === twoincAddressRoles.primary()
      ? twoincCompanyCapture.CAPTURE_MODE_KEY
      : twoincCompanyCapture.CAPTURE_MODE_KEY + "_" + key;
  },

  /**
   * Which capture UI produced the pair the fields hold RIGHT NOW.
   *
   * The chip alone does not answer it: switching into sole-trader mode clears
   * nothing, so an earlier pick stays on the fields for the whole signup round
   * trip. Adoption is the discriminator — until one lands, the pair still
   * belongs to the mode `savedCaptureMode` holds.
   *
   * @returns {string}
   */
  capturedMode: function (role) {
    const mode = twoincCompanyCapture.modeFor(role);
    const soleTrader = twoincCompanyCapture.soleTraderFor(role);
    if (!soleTrader || soleTrader.mode !== "sole_trader") return mode;
    if (soleTrader.soleTraderAdopted) return "sole_trader";
    return soleTrader.savedCaptureMode === null ? mode : soleTrader.savedCaptureMode;
  },

  /**
   * Every role's own sole-trader controller (TWO-40), registered by
   * `TwoCompanySearch`'s constructor. Each `TwoCompanySearch` instance owns an
   * independent controller (own mode, flight, adoption state) — this is the
   * lookup that lets role-keyed helpers like `capturedMode` reach the right
   * one without every caller threading a `TwoCompanySearch` instance through.
   */
  soleTraderRegistry: {},

  /**
   * The `TwoCompanySearch` control that owns each address role, registered by
   * the control itself. Role-scoped code reached from outside a control (a
   * retype guard bound by role, not by instance) needs the RIGHT instance's
   * surfaces, and there is more than one control on the page.
   */
  controllerRegistry: {},

  /** The control owning one role, falling back on the primary role's. */
  controllerFor: function (role) {
    const registry = twoincCompanyCapture.controllerRegistry;
    return registry[role || twoincAddressRoles.primary()] || registry[twoincAddressRoles.primary()];
  },

  soleTraderFor: function (role) {
    const key = role || twoincAddressRoles.primary();
    return twoincCompanyCapture.soleTraderRegistry[key] || null;
  },

  /**
   * Record which capture UI produced the company now on the form, against the
   * pair it describes, so a later restore can read the mode back rather than
   * infer it. Nothing about a captured value carries that fact: a `TWO:`
   * organisation number is minted for registered companies in some countries
   * too, so its shape says nothing about how the buyer was captured.
   *
   * A restored sole trader leaves the capture axis at `search` — that is what
   * `enableCompanySearch()` gates on — so adoption is what carries the fact
   * forward across a second return.
   */
  rememberCaptureMode: function (role) {
    sessionStorage.setItem(
      twoincCompanyCapture.captureModeKey(role),
      JSON.stringify({
        mode: twoincCompanyCapture.capturedMode(role),
        tag: twoincCompanyCapture.pairingTag(
          twoincCompanyCapture.nameField(role).val(),
          twoincCompanyCapture.numberField(role).val()
        )
      })
    );
  },

  /**
   * The recorded capture mode for one name/number pair, `""` when none was
   * recorded for it. Tag-matched, so a record left behind by a different
   * company can never be read as describing the one being restored.
   */
  recallCaptureMode: function (companyName, companyId, role) {
    const raw = sessionStorage.getItem(twoincCompanyCapture.captureModeKey(role));
    if (!raw) return "";
    let record;
    try {
      record = JSON.parse(raw);
    } catch (e) {
      return "";
    }
    if (!record || record.tag !== twoincCompanyCapture.pairingTag(companyName, companyId)) {
      return "";
    }
    return twoincUtilHelper.blankToEmpty(record.mode);
  },

  /** Drop the pairing tag and both provenance markers. */
  forgetPairing: function (role) {
    twoincCompanyCapture
      .nameField(role)
      .removeAttr(twoincCompanyCapture.PAIRING_ATTR)
      .removeAttr(twoincCompanyCapture.PROVENANCE_ATTR);
    twoincCompanyCapture.numberField(role).removeAttr(twoincCompanyCapture.PROVENANCE_ATTR);
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
   * mid-keystroke costs more than a stale line. The role's registry-address
   * provenance is
   * cleared instead, tidied up on the next manual-entry switch or country
   * change.
   *
   * @returns {boolean} whether a stale capture was dropped
   */
  guardCompanyRetype: function (role) {
    const $name = twoincCompanyCapture.nameField(role);
    const $number = twoincCompanyCapture.numberField(role);
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

    twoincCompanyCapture.write($name.val(), "", { role: role });

    // `write()` above already recomputed `customerCompany` (billing-first,
    // shipping-fallback), so a retype on EITHER role can change what the
    // order intent sees — re-check it regardless of which role this is.
    Twoinc.getInstance().getApproval();

    // The retyped role's own surfaces — its address provenance and its own
    // number label (Doug 2026-09-01).
    Twoinc.getInstance().addressStateFor(role).registryApplied = false;

    // `#company_id` visibility depends on the value just cleared (TWO-25326
    // §12); the verdict on screen was about the company just uncaptured.
    twoincDomHelper.clearIntentVerdicts();
    twoincDomHelper.toggleBusinessFields();
    twoincCompanyCapture.controllerFor(role).renderCompanySummary();
    return true;
  }
};

/**
 * Company capture control: the anchored popover from
 * `assets/js/company-search-panel.js` — vendored verbatim from the Magento
 * plugin, where it is maintained — plus everything WooCommerce-specific around
 * it: the transport, the chips' meaning, the two mount points, manual entry and
 * the read-only number label.
 *
 * DOM ORDER IS THE DESIGN. The panel is a real child of the wrapper around the
 * company-name input, with exactly three children of its own — search row,
 * results host, mode chips — so the browser's own tab order walks the control
 * the way it reads and no key handling is needed to make Tab behave.
 */
class TwoCompanySearch {
  /**
   * Every DOM id and class this control builds or owns is an option, so a
   * second instance on the same page owns its own nodes rather than reusing
   * the first's.
   *
   * @param {Object} [options]
   * @param {string} [options.role] address role this control captures for.
   * @param {string} [options.addressFieldSelector] company-name input in the
   *   address form.
   * @param {string} [options.tileFieldSelector] company-name input this class
   *   builds inside the payment tile.
   * @param {string} [options.searchCompanyBtnId] id of the link back into search.
   * @param {string} [options.tileRowId] id of the row built inside the tile slot.
   * @param {string} [options.companySummaryId] id of the company-number label;
   *   brand overlays style it by that name (TWO-25288).
   * @param {string} [options.companySearchTileSlotClass] class of the tile slot.
   * @param {string} [options.soleTraderSpinnerClass] class of the in-flight
   *   spinner — a class, not an id, so a fragment swap that orphans a duplicate
   *   host cannot leave one animating forever (TWO-40).
   * @param {string} [options.soleTraderSpinnerHostClass] class marking its host.
   * @param {string} [options.differentSoleTraderBtnId] id of the "select a
   *   different sole trader" link this instance's sole-trader controller owns.
   * @param {string} [options.soleTraderNoteSlotClass] class of the DOM node the
   *   signup-prompt note (and its in-flight/error state) renders into.
   */
  constructor(options) {
    options = options || {};
    this.role = options.role || twoincAddressRoles.primary();
    this.addressFieldSelector = options.addressFieldSelector || "#billing_company_display";
    this.tileFieldSelector = options.tileFieldSelector || "#twoinc_tile_company_name";
    this.searchCompanyBtnId = options.searchCompanyBtnId || "search_company_btn";
    this.tileRowId = options.tileRowId || "twoinc_tile_company_row";
    this.companySummaryId = options.companySummaryId || "twoinc_company_summary";
    this.companySearchTileSlotClass =
      options.companySearchTileSlotClass || "twoinc-company-search-tile-slot";
    this.differentSoleTraderBtnId =
      options.differentSoleTraderBtnId || "select_different_sole_trader_btn";
    this.soleTraderNoteSlotClass =
      options.soleTraderNoteSlotClass || "twoinc-sole-trader-note-slot";
    this.soleTraderSpinnerClass = options.soleTraderSpinnerClass || "twoinc-sole-trader-spinner";
    this.soleTraderSpinnerHostClass = options.soleTraderSpinnerHostClass || "twoinc-name-searching";

    // One sole-trader controller per instance, never a shared global (TWO-40):
    // `createSoleTraderController` closes over `this` for country/DOM reads
    // and owns this instance's own mode/flight/adoption state.
    this.soleTrader = createSoleTraderController(this);
    twoincCompanyCapture.soleTraderRegistry[this.role] = this.soleTrader;
    twoincCompanyCapture.controllerRegistry[this.role] = this;
  }

  /**
   * The mode-chips container INSIDE this instance's own panel.
   *
   * `company-search-panel.js` builds every panel's chip row under the same
   * literal class (`CompanySearchPanel.CLASSES.CHIPS`) regardless of which
   * `TwoCompanySearch` owns it, so a bare `jQuery('.' + CHIPS_CLASS)` matches
   * every mounted instance's row at once once a second instance exists. Scoped
   * through this instance's own field wrapper instead of the panel's private
   * DOM handle, which is not part of `CompanySearchPanel`'s public surface.
   *
   * @returns {jQuery}
   */
  modeChipsNode() {
    return jQuery(this.companyFieldSelector())
      .closest("." + this.fieldWrapClass)
      .find(".two-company-mode-chips");
  }

  /** This control's panel, built on first `attach()`. */
  panel = null;

  /** The Twoinc singleton, so a pick can be written onto it. */
  twoincInstance = null;

  /** The jqXHR of the search currently on the wire, and the bind it belongs to. */
  activeRequest = null;
  activeToken = null;

  /**
   * Hard ceiling on a single company-search request, ms (TWO-25232).
   * Deliberately wider than the backend's own retry envelope for the
   * upstream provider lookup — this is the backstop for a request that never
   * arrives, not for a slow-but-arriving one.
   */
  companySearchTimeoutMs = 30000;

  /**
   * Characters the buyer must type before company search runs (TWO-25288) —
   * the single source of this threshold: the panel's own gate and the
   * min-chars hint both read it, so the number shown and the number enforced
   * can't drift apart.
   */
  companySearchMinLength = 3;

  /** Debounce between the last keystroke and the request, ms. */
  companySearchDebounceMs = 300;

  /** Companies asked for per search. */
  companySearchLimit = 50;

  /** Shared class on every chip inside the panel. */
  modeChipClass = "two-company-mode-chip";

  /** Class of the wrapper the panel anchors against. */
  fieldWrapClass = "two-company-field-wrap";

  /** `window` is page-wide, so the viewport listener is bound at most once. */
  fieldWrapRefreshBound = false;
  fieldWrapRefreshTimer = null;

  /**
   * Sequence number of the most recently dispatched company-search request,
   * bumped by every country change too so a response for a country the buyer
   * has left cannot paint.
   */
  companySearchSeq = 0;

  /**
   * Backoff after a 429. Typing is the one route that can trip the limit
   * legitimately, and every further keystroke would otherwise fire into it and
   * hold the window open for the rest of the buyer's session.
   */
  companySearchBackoffUntil = 0;

  /**
   * The last billing country this page has acted on (TWO-24867/TWO-25326).
   * `null` until first seen; every setter goes through `countryDidChange`, so
   * none can leave this out of step with the field.
   */
  lastObservedCountry = null;

  companySearchUnavailableText() {
    return (
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_search_unavailable) ||
      "Company search is temporarily unavailable. Please try again."
    );
  }

  /**
   * Hint stating the search threshold (TWO-25288), the query field's
   * watermark. A fixed number rather than a countdown — the buyer is told what
   * the field needs, not how far off they are.
   */
  companySearchTooShortText() {
    const template =
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_search_too_short) ||
      "Enter %d or more characters";
    // Matches gettext's positional form (`%1$d`) as well as bare `%d`: a
    // translator may reorder arguments via `#, php-format` placeholders. The
    // msgid itself stays `%d` — changing it would invalidate catalogues.
    return template.replace(/%(\d+\$)?d/, this.companySearchMinLength);
  }

  /**
   * Manual entry captures no company number, and Two's method requires one
   * that only the address-step lookup can capture — so with company search out
   * of the address area the chip is a dead end (TWO-25503).
   */
  manualEntryIsAvailable() {
    return window.twoinc.company_search_location === "address_area";
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
   * Whether the control renders in the payment tile rather than the address
   * form. Only the primary role has a tile mount (TWO-40) — the tile row and
   * its input are built under one shared id, so a second instance answering
   * yes here would anchor its panel to the primary's tile input.
   */
  isTileLocation() {
    if (this.role !== twoincAddressRoles.primary()) return false;
    return window.twoinc.company_search_location === "payment_tile";
  }

  /** Selector of the input the panel is anchored to right now. */
  companyFieldSelector() {
    return this.isTileLocation() ? this.tileFieldSelector : this.addressFieldSelector;
  }

  // -------------------------------------------------------------- transport

  /**
   * The six-member transport the panel asks for. Split out so the panel stays
   * platform-free: it owns when to search, this owns how.
   */
  searchApi() {
    return {
      MIN_INPUT_LENGTH: this.companySearchMinLength,
      SEARCH_DEBOUNCE_MS: this.companySearchDebounceMs,
      minInputLengthMessage: () => {
        return this.companySearchTooShortText();
      },
      noResultsMessage: () => {
        return (
          (window.wc_country_select_params && wc_country_select_params.i18n_no_matches) ||
          "No matches found"
        );
      },
      abortActiveRequest: (token) => {
        if (!this.activeRequest || this.activeToken !== token) return false;
        const request = this.activeRequest;
        this.activeRequest = null;
        this.activeToken = null;
        request.abort();
        return true;
      },
      searchCompanies: (params) => {
        return this.searchCompanies(params);
      }
    };
  }

  /**
   * Issue one company search.
   *
   * Resolves rather than rejects on every outcome: the panel distinguishes
   * "aborted" (paint nothing) from "unavailable" (say the search is down) from
   * a result set, and a rejection would collapse all three into one.
   *
   * @param {Object} params `{config, token, term, getCountryCode}`
   * @returns {Promise<Object>}
   */
  searchCompanies(params) {
    // Before the sequence bump: a search dropped during backoff must not
    // invalidate an in-flight one whose results are already on the wire.
    if (Date.now() < this.companySearchBackoffUntil) {
      return Promise.resolve({ unavailable: true });
    }
    const seq = ++this.companySearchSeq;
    const searchParams = new URLSearchParams({
      // Read per request, never captured when the panel was built (TWO-24867):
      // the panel outlives a country change on every path that does not rebuild
      // it, and a captured value searched the previous country's register while
      // the form said otherwise.
      country: params.getCountryCode(),
      limit: this.companySearchLimit,
      offset: 0,
      q: params.term,
      csrf_token: twoincUtilHelper.proxyCsrfToken()
    });

    const request = jQuery.ajax({
      url: twoincUtilHelper.proxyUrl("company_search_url"),
      data: searchParams.toString(),
      dataType: "json",
      timeout: this.companySearchTimeoutMs
    });
    this.activeRequest = request;
    this.activeToken = params.token;

    return new Promise((resolve) => {
      request.done((data) => {
        if (seq !== this.companySearchSeq) {
          resolve({ aborted: true });
          return;
        }
        // `degraded` marks an HTTP 200 whose (near-empty) result set is
        // unreliable because the upstream provider lookup timed out. The field
        // may not be deployed yet, so absent must read as not degraded.
        if (data && data.degraded === true) {
          resolve({ unavailable: true });
          return;
        }
        resolve({ items: this.toResultItems(data) });
      });

      request.fail((jqXHR, textStatus) => {
        // An abort is routine — every keystroke supersedes the last search —
        // and must stay silent. A timeout or transport error must not: left
        // silent it renders as "no companies found", a wrong answer rather
        // than a missing one.
        if (textStatus === "abort" || seq !== this.companySearchSeq) {
          resolve({ aborted: true });
          return;
        }
        if (jqXHR && jqXHR.status === 429) {
          this.companySearchBackoffUntil = Date.now() + twoincUtilHelper.retryAfterMs(jqXHR);
        }
        resolve({ unavailable: true });
      });

      request.always(() => {
        if (this.activeRequest !== request) return;
        this.activeRequest = null;
        this.activeToken = null;
      });
    });
  }

  /**
   * Shape the search response into the rows the panel renders.
   *
   * @param {Object} response
   * @returns {Array<Object>}
   */
  toResultItems(response) {
    const items = [];
    const rawItems = response && Array.isArray(response.items) ? response.items : [];

    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i];
      // `national_identifier` is optional in the search response — the company
      // may have none in its home registry — and dropping the hit entirely
      // would remove a selectable company.
      const identifier =
        item.national_identifier && item.national_identifier.id
          ? String(item.national_identifier.id)
          : "";
      items.push({
        id: item.name,
        text: item.name,
        // TWO-25326 §12: `identifier` stays raw on `company_id` — that is what
        // gets posted — while what the buyer READS goes through the shared
        // composer, which drops an internally minted number along with the
        // brackets that would otherwise be left empty around it. `highlight` is
        // the server's own pre-marked-up label, so it is passed through rather
        // than re-encoded; the plain name is the fallback for a response that
        // omits it.
        html: twoincUtilHelper.composeCompanyLabel(item.highlight || item.name || "", identifier),
        company_id: identifier,
        lookup_id: item.lookup_id,
        approved: false
      });
    }

    return items;
  }

  // ------------------------------------------------------------------ panel

  /**
   * Build the panel, or re-point the existing one at the current mount.
   *
   * One panel per control: the mount moves between the address form and the
   * payment tile, and the panel's own `fieldSelector` is what carries that, so
   * rebuilding would leave the control with two anchors.
   *
   * @returns {Object|null} the panel, or null where the script did not load
   */
  ensurePanel() {
    if (typeof window.TwoCompanySearchPanel !== "function") return null;

    if (!this.panel) {
      this.panel = new window.TwoCompanySearchPanel({
        fieldSelector: this.companyFieldSelector(),
        config: {},
        search: this.searchApi(),
        translate: (text) => {
          return this.translatePanelText(text);
        },
        getCountryCode: () => {
          return this.currentCountry();
        },
        getChips: () => {
          return this.chips();
        },
        isChipVisible: (mode) => {
          return this.isChipVisible(mode);
        },
        getSelectedMode: () => {
          return this.selectedMode();
        },
        onSelect: (item) => {
          this.onPick(item);
        },
        getDisplayText: () => {
          return twoincUtilHelper.blankToEmpty(twoincCompanyCapture.nameField(this.role).val());
        },
        onExitManualEntry: () => {
          this.exitManualCompanyEntry();
        }
      });
    } else {
      this.panel.fieldSelector = this.companyFieldSelector();
    }

    return this.panel;
  }

  /**
   * The panel's own source strings, mapped onto this plugin's localised text.
   * Keyed on the English string because the panel is vendored verbatim and
   * carries no message ids of its own.
   *
   * @param {string} text
   * @returns {string}
   */
  translatePanelText(text) {
    const map = {
      "Search for company": this.searchCompanyText(),
      "Company search is unavailable right now. Please try again shortly.":
        this.companySearchUnavailableText()
    };
    return map[text] || text;
  }

  /**
   * Point the panel at whatever host is current and build it there.
   *
   * Called from every path that can have replaced the host: `initialize()` and
   * its retry, `updated_checkout`, the tile rebuild, and the returns from
   * manual entry and sole-trader mode. Idempotent — the panel adopts a panel
   * already in the wrapper rather than building a second one.
   *
   * @param {Twoinc} [twoincInstance]
   * @returns {Object|null} the panel
   */
  attach(twoincInstance) {
    if (twoincInstance) this.twoincInstance = twoincInstance;

    const panel = this.ensurePanel();
    if (!panel) return null;

    panel.bind();
    this.syncFieldWrapMetrics();
    this.bindFieldWrapRefresh();
    twoincDomHelper.toggleTooltip(this.companyFieldSelector(), window.twoinc.text.tooltip_company);
    return panel;
  }

  /**
   * Pin the panel's drop point to the INPUT's own height.
   *
   * The panel is positioned against the wrapper, which also carries the
   * sole-trader link in normal flow — so a `100%` anchor drops the panel a
   * link-height too low the moment one is adopted.
   *
   * Width is never pinned here. A measured width latches: it only re-runs on
   * a re-attach or a viewport resize, so any layout change that widens the
   * wrapper's parent without either — a checkout column settling after the
   * tile is built — left the control and its panel stuck at the old, narrower
   * pixel value. The stylesheet sizes the input off the wrapper instead, so
   * the two agree at every width with nothing to go stale.
   */
  syncFieldWrapMetrics() {
    const $field = jQuery(this.companyFieldSelector());
    const $wrap = $field.closest("." + this.fieldWrapClass);
    if (!$field.length || !$wrap.length) return;

    const el = $wrap.get(0);
    const height = $field.outerHeight();
    if (height) el.style.setProperty("--two-company-input-height", height + "px");
    else el.style.removeProperty("--two-company-input-height");
  }

  /**
   * Keep that pin current across a viewport change, not only on the next
   * re-bind — a buyer who rotates a tablet without typing would otherwise see
   * the panel drift off the field.
   */
  bindFieldWrapRefresh() {
    if (this.fieldWrapRefreshBound) return;
    this.fieldWrapRefreshBound = true;
    jQuery(window).on("resize.twoCompanyWrap orientationchange.twoCompanyWrap", () => {
      clearTimeout(this.fieldWrapRefreshTimer);
      this.fieldWrapRefreshTimer = setTimeout(() => this.syncFieldWrapMetrics(), 150);
    });
  }

  // ------------------------------------------------------------------ chips

  /**
   * The three capture modes, in the order PrestaShop offers them. Rebuilt on
   * every sync rather than mutated, so a chip cannot outlive the mode it means.
   */
  chips() {
    const cfg = this.soleTrader.config();

    return [
      {
        mode: "registered",
        text: (cfg.text && cfg.text.registered_business) || "Registered company",
        onActivate: () => {
          this.onRegisteredChip();
        }
      },
      {
        mode: "sole_trader",
        text: (cfg.text && cfg.text.sole_trader) || "Sole trader",
        onActivate: () => {
          this.soleTrader.onModeChipClick("sole_trader");
        }
      },
      {
        mode: "manual",
        text: this.enterManuallyText(),
        onActivate: () => {
          this.activateManualEntry();
        }
      }
    ];
  }

  /**
   * Sole trader is offered only where the registry does not already register
   * them; manual entry only where a captured number is not required.
   *
   * @param {string} mode
   * @returns {boolean}
   */
  isChipVisible(mode) {
    if (mode === "sole_trader") return this.soleTrader.isAvailable();
    if (mode === "manual") return this.manualEntryIsAvailable();
    return true;
  }

  /**
   * Which chip reads as selected. The two mode axes cross — a buyer can be in
   * `business` sole-trader mode while the capture mode is `manual` — so this
   * resolves them in one place rather than letting each chip decide.
   *
   * @returns {string}
   */
  selectedMode() {
    if (twoincCompanyCapture.modeFor(this.role) === "manual") return "manual";
    if (this.soleTrader.mode === "sole_trader") return "sole_trader";
    return "registered";
  }

  /**
   * "Registered company". Refused while sole-trader mode is still DECIDING
   * what it is: acting mid-wait races the flight/popup's own resolution, which
   * could silently reassert or drop what the click just tried to undo.
   */
  onRegisteredChip() {
    // On the CLICK, which is the only event Enter and Space produce: behind the
    // guard below this chip did nothing at all for a keyboard buyer, leaving
    // the signup up with no way to dismiss it.
    this.soleTrader.abandonPopupsForChipClick();
    if (this.soleTrader.mode === "business" || this.soleTrader.isDeciding()) return;
    this.soleTrader.setMode("business");
    this.openCompanySearchDropdown();
  }

  /**
   * Switch out of company search into manual entry. Deferred because the
   * sole-trader revert below can re-enter this file's own mode handling, and
   * doing that from inside the still-unwinding click event would reorder it
   * against the panel's own chip rebuild.
   */
  activateManualEntry() {
    // On the CLICK path, so Enter/Space take the popup down too (TWO-25503),
    // and before the guard below, which an outstanding signup makes refuse.
    this.soleTrader.abandonPopupsForChipClick();

    if (this.soleTrader.isDeciding()) return;

    // Captured synchronously: the deferred callback can't otherwise tell "was
    // already in sole-trader mode" from "switched into it during the defer".
    const leavingSoleTrader = this.soleTrader.mode === "sole_trader";

    setTimeout(() => {
      if (
        leavingSoleTrader &&
        this.soleTrader.mode === "sole_trader" &&
        !this.soleTrader.isDeciding()
      ) {
        this.soleTrader.setMode("business");
      }
      this.enterManualCompanyEntry();
    }, 0);
  }

  /** Repaint the chips and the query row against the current modes. */
  syncModeChips() {
    const panel = this.panel;
    if (panel) panel.syncChips();
  }

  // ------------------------------------------------------------ open / close

  /**
   * Open the panel and put the caret in its query field.
   *
   * @returns {boolean} whether there was a panel to open
   */
  openCompanySearchDropdown() {
    const panel = this.panel;
    if (!panel || !panel.isBound()) return false;
    panel.open();
    return true;
  }

  /**
   * Is the panel's own host on screen? Asked before opening from a control that
   * lives somewhere else: in tile placement the panel sits inside a payment box
   * WooCommerce collapses for every other method, so opening it there would
   * leave the buyer's click with no visible effect at all.
   *
   * @returns {boolean}
   */
  companySearchIsReachable() {
    return this.isOnScreen(jQuery(this.companyFieldSelector()));
  }

  closeCompanySearchDropdown() {
    const panel = this.panel;
    if (panel) panel.close();
  }

  /** No production caller: the tests' read of the panel's open state. */
  companySearchDropdownIsOpen() {
    const panel = this.panel;
    return !!panel && panel.isOpen();
  }

  // -------------------------------------------------------------- selection

  /**
   * The buyer picked a company off the registry list.
   *
   * @param {Object} item the result row
   */
  onPick(item) {
    const instance = this.twoincInstance || Twoinc.getInstance();

    // The panel deliberately survives a sole-trader autofill flight or an open
    // signup popup, so a pick can land while `mode === "sole_trader"`. Refused
    // while still genuinely deciding, the same guard every other sole-trader
    // exit uses; once adopted, a pick is the buyer choosing a different
    // company.
    if (this.soleTrader.mode === "sole_trader") {
      if (this.soleTrader.isDeciding()) return;
      this.soleTrader.mode = "business";
      this.soleTrader.soleTraderAdopted = false;
      this.soleTrader.soleTraderReconfirmingCount = 0;
      this.soleTrader.updateChips();
      this.soleTrader.syncDifferentSoleTraderLink();
      this.syncSoleTraderSurfaces();
      this.soleTrader.leaveSoleTraderMode();
    }

    // The single write path (TWO-40 §5): posted fields, instance record,
    // pairing tag and provenance in one call.
    twoincCompanyCapture.write(item.id, item.company_id, {
      country: this.currentCountry(),
      role: this.role
    });

    // A capture changes which company-name surface the buyer should be looking
    // at, and this is the primary path that creates one (TWO-25503).
    twoincDomHelper.toggleBusinessFields();

    this.renderCompanySummary(item.id, item.company_id);

    // Leave any loader alone: getApproval() below only arms a check.
    twoincDomHelper.clearIntentVerdicts();

    instance.getApproval();

    if (window.twoinc.enable_address_lookup === "yes") {
      instance.addressLookup(item, this.role);
    }
  }

  /**
   * Paint the company-name field with a name the plugin captured rather than
   * the buyer picked — a sole-trader adoption or a restore.
   *
   * @param {string} name
   */
  setDisplayName(name) {
    const panel = this.panel;
    if (panel && panel.isBound()) {
      panel.setDisplayText(name);
      return;
    }
    jQuery(this.companyFieldSelector()).val(twoincUtilHelper.blankToEmpty(name));
  }

  // -------------------------------------------------------------- sole trader

  /**
   * The element the sole-trader spinner paints over: the input box of whichever
   * company-NAME surface is currently visible. The box, not the field row, so
   * vertically centring doesn't float the spinner over the label too.
   */
  soleTraderSpinnerHost() {
    const $surface = this.companyNameSurface();
    if (!$surface.length) return $surface;
    const $wrap = $surface.find("." + this.fieldWrapClass).first();
    if ($wrap.length) return $wrap;
    return this.companyFieldAffordanceSlot();
  }

  /**
   * Show the sole-trader spinner for exactly as long as the flow is running.
   * Derived from state on every call, since mode and `flightDepth` move
   * independently and the host moves with the visible name surface.
   */
  syncSoleTraderSpinner() {
    jQuery("." + this.soleTraderSpinnerClass).remove();
    jQuery("." + this.soleTraderSpinnerHostClass).removeClass(this.soleTraderSpinnerHostClass);

    if (this.soleTrader.mode !== "sole_trader" || this.soleTrader.flightDepth === 0) return;

    const $host = this.soleTraderSpinnerHost();
    if ($host.length === 0) return;
    $host
      .addClass(this.soleTraderSpinnerHostClass)
      .append(
        '<span class="twoinc-search-spinner ' +
          this.soleTraderSpinnerClass +
          '" aria-hidden="true"></span>'
      );
  }

  /**
   * Everything the sole-trader flow's panel surfaces derive from `mode` and
   * `flightDepth`. One call site per state change so the chips and the spinner
   * cannot be re-synced by different callers and drift apart.
   */
  syncSoleTraderSurfaces() {
    this.syncModeChips();
    this.syncSoleTraderSpinner();
  }

  // ------------------------------------------------------------------ country

  /**
   * The country this control's address role currently holds, upper-cased, or ""
   * when absent/unset (TWO-24867). The single reader for every
   * country-sensitive path, so they cannot disagree on "the current country".
   */
  currentCountry() {
    return twoincAddressRoles.country(this.role);
  }

  /**
   * Whether a `change` on #billing_country is a REAL country change, as
   * opposed to WooCommerce re-emitting one during its own re-render
   * (TWO-25326). Records the new value as a side effect, so the caller must
   * invoke this exactly once per event and act on its answer.
   *
   * An empty reading is neither a change nor recorded: WooCommerce replaces
   * #billing_country wholesale on some re-renders, and a poll landing
   * mid-replacement would otherwise clear the captured company for nothing.
   * The first known country is not a change either — there is no previous
   * country to have moved away from.
   *
   * @param {string} country upper-cased ISO code currently in the field
   * @returns {boolean}
   */
  countryDidChange(country) {
    if (!country) {
      return false;
    }
    const previous = this.lastObservedCountry;
    this.lastObservedCountry = country;
    return !!previous && country !== previous;
  }

  // ----------------------------------------------------------------- surfaces

  /**
   * Is this row actually on screen? The class test alone is not enough: a row
   * inside a collapsed payment tile carries no `hidden` class of its own, and
   * naming it as the visible surface strands the number label and the
   * sole-trader link inside something the buyer cannot see (TWO-25503).
   *
   * @param {Object} $el
   * @returns {boolean}
   */
  isOnScreen($el) {
    if (!$el || !$el.length) return false;
    let node = $el.get(0);
    while (node && node.nodeType === 1) {
      if (node.classList.contains("hidden") || node.hasAttribute("hidden")) return false;
      // WooCommerce collapses a payment box by writing `display: none` inline,
      // which is what makes a relocated row unreachable without ever putting a
      // class on it.
      if (node.style && node.style.display === "none") return false;
      node = node.parentElement;
    }
    return true;
  }

  /** WooCommerce's own company row for this control's address role. */
  nativeCompanyRowSelector() {
    return twoincAddressRoles.field(this.role, "company") + "_field";
  }

  /**
   * The row that is the buyer's visible company-NAME surface right now.
   *
   * THE one place that decides it (TWO-25503). Every surface that has to sit
   * beside the company name — the read-only number label, the sole-trader link,
   * the in-flight spinner — asks here instead of re-deriving it.
   *
   * @returns {Object} jQuery
   */
  companyNameSurface() {
    const $native = jQuery(this.nativeCompanyRowSelector());

    const $search = this.isTileLocation()
      ? jQuery("#" + this.tileRowId)
      : jQuery(this.addressFieldSelector + "_field");
    if (this.isOnScreen($search)) return $search;
    if (this.isOnScreen($native)) return $native;

    return $native.length ? $native : $search;
  }

  /**
   * The slot a company-field affordance button hangs in, inside the native
   * company row.
   */
  companyFieldAffordanceSlot() {
    return this.affordanceSlotIn(
      jQuery(this.nativeCompanyRowSelector()),
      twoincAddressRoles.field(this.role, "company")
    );
  }

  /**
   * The affordance slot inside one company field row, self-healing when the
   * theme's markup lacks core's wrapper — the pay-for-order view renders the
   * row without one (TWO-25503).
   *
   * Falling back to the row itself would append the button as a sibling of both
   * the label and the input rather than right after the input, which is the
   * overlap-with-the-label bug this helper exists to avoid.
   *
   * @param {Object} $row the field row
   * @param {string} inputSelector the input the wrapper belongs around
   * @returns {Object} jQuery
   */
  affordanceSlotIn($row, inputSelector) {
    const $input = $row.find(inputSelector).first();
    if (!$input.length) {
      const $any = $row.find(".woocommerce-input-wrapper").first();
      return $any.length ? $any : $row;
    }

    // The panel is the input's own sibling inside this wrapper, so a link
    // appended here lands below both rather than between them.
    const $wrap = $input.closest("." + this.fieldWrapClass);
    if ($wrap.length) return $wrap;

    // The wrapper CONTAINING the input, never merely the row's first: a
    // fragment swap can leave a stale empty wrapper ahead of the live one.
    const $existing = $input.closest(".woocommerce-input-wrapper");
    if ($existing.length) return $existing;

    const $wrapper = jQuery('<span class="woocommerce-input-wrapper"></span>');
    $input.before($wrapper);
    $wrapper.append($input);
    return $wrapper;
  }

  // ---------------------------------------------------------------- placement

  /**
   * Render the company-search control into the payment tile, or leave it in the
   * address form, per `window.twoinc.company_search_location` (TWO-25326 §7.1).
   *
   * REBUILT into the tile, never moved there: WooCommerce replaces the whole
   * `.woocommerce-checkout-payment` fragment on every payment-method, coupon,
   * shipping or quantity change, so a form row relocated into it is a row
   * WooCommerce can destroy with no warning.
   *
   * The tile input carries no `name` and holds no capture — it is painted from
   * the capture pair, since this fragment is replaced wholesale.
   */
  syncCompanySearchTileLocation() {
    const $slot = jQuery("." + this.companySearchTileSlotClass);

    if (!this.isTileLocation()) {
      $slot.addClass("hidden");
      // Ahead of the slot check: the slot lives in Two's gateway description,
      // so a checkout not offering Two has no other re-bind.
      this.rebindUnlessManual();
      return;
    }

    if (!$slot.length) return;

    let $row = $slot.find("#" + this.tileRowId);
    if (!$row.length) {
      $row = jQuery(
        '<div id="' +
          this.tileRowId +
          '" class="twoinc-inp-container form-row form-row-wide">' +
          '<label for="' +
          this.tileFieldSelector.replace("#", "") +
          '"></label>' +
          '<span class="woocommerce-input-wrapper">' +
          '<input type="text" id="' +
          this.tileFieldSelector.replace("#", "") +
          '" autocomplete="off">' +
          "</span>" +
          "</div>"
      );
      // Reuses the address row's own already-translated label rather than a
      // second string to keep in step with it.
      $row.find("label").text(this.companyNameLabelText());
      $slot.append($row);
    }

    const show = twoincCompanyCapture.modeFor(this.role) !== "manual";
    $row.toggleClass("hidden", !show);
    $slot.toggleClass("hidden", !show);

    if (show) this.attach();
  }

  /**
   * Re-bind the panel to whatever host is current, unless manual entry has
   * released the field.
   *
   * The re-bind is per instance and the host is per instance, so every path
   * that can have replaced a host — `updated_checkout`,
   * `toggleBusinessFields()` — runs this on each control rather than only the
   * one with a tile mount. WooCommerce replaces the shipping fields on the
   * same refreshes it replaces the payment fragment on, and `ensurePanel()`
   * registers no MutationObserver, so a control that is not re-bound here
   * stays a bare input.
   */
  rebindUnlessManual() {
    if (twoincCompanyCapture.modeFor(this.role) === "manual") return;
    this.attach();
  }

  /**
   * The company-name label, reusing the row WooCommerce renders rather than a
   * second string to keep in step with it. Core's optional/required markers go:
   * this field is neither posted nor validated.
   */
  companyNameLabelText() {
    const $label = jQuery("label[for='" + this.addressFieldSelector.replace("#", "") + "']")
      .first()
      .clone();
    $label.find(".optional, .required, abbr").remove();
    return twoincUtilHelper.blankToEmpty($label.text()).trim() || "Company name";
  }

  // ------------------------------------------------------------------ capture

  /**
   * The captured company name. The capture pair's own name field is the single
   * source: every capture path — registry pick, sole-trader adoption, manual
   * entry, user-meta restore, storage restore — writes it.
   */
  getCompanyName() {
    return twoincUtilHelper.blankToEmpty(twoincCompanyCapture.nameField(this.role).val());
  }

  /**
   * Throw away the captured company and everything derived from it.
   */
  clearSelectedCompany() {
    this.setDisplayName("");
    this.attach();

    // Gated on PROVENANCE (TWO-40 §5), not capture mode: in manual entry the
    // capture name field is the buyer's own typed input, and this runs on every
    // country change, so clearing unconditionally would wipe a name typed for
    // reasons of their own.
    const plugin_wrote_name = twoincCompanyCapture.isPluginWritten(
      twoincCompanyCapture.nameField(this.role)
    );
    twoincCompanyCapture.write(
      plugin_wrote_name ? "" : twoincCompanyCapture.nameField(this.role).val(),
      "",
      { role: this.role }
    );

    // This role's own address form, never the other's (Doug 2026-09-01).
    // `clearAddress()`, not a blank `setAddress()` payload: the latter leaves
    // line 2 untouched by design (TWO-40 §2.6), which would strand the
    // outgoing company's registry-written line 2 on the form.
    if (window.twoinc.enable_address_lookup === "yes") {
      Twoinc.getInstance().clearAddress(this.role);
    }
    Twoinc.getInstance().addressStateFor(this.role).registryApplied = false;
    // Not a blind `{}` (Doug 2026-08-31 §2): `write()` above already
    // recomputed this, but a shipping fallback may be the reason it isn't
    // empty — clearing billing's own capture doesn't mean nothing is
    // captured any more.
    twoincCompanyCapture.syncOrderCompany();

    // Clearing a capture changes the visible company-name surface exactly as
    // creating one does (TWO-25503).
    twoincDomHelper.toggleBusinessFields();
    this.renderCompanySummary();
    twoincDomHelper.togglePaySubtitleDesc();

    // Guarded by the company-search counter: three seconds is long enough for
    // the buyer to change country again, or to pick a company, and this closure
    // would then overwrite `customerCompany` from whatever the DOM held at that
    // moment, undoing the newer capture.
    const seq = this.companySearchSeq;
    setTimeout(() => {
      if (seq !== this.companySearchSeq) return;
      // Resolver-based, so it is right to call from either role's clear: it
      // re-reads both roles' DOM and decides which (if either) the order
      // intent reads.
      twoincCompanyCapture.syncOrderCompany();
      this.renderCompanySummary();
    }, 3000);
  }

  // ------------------------------------------------------------------ summary

  /**
   * The read-only company-number label, built hidden on first use (TWO-25288;
   * scope narrowed TWO-25326 §7).
   *
   * ONE <span> and no <input>: the captured number is a value the buyer is
   * shown, not a field they fill in.
   *
   * Re-anchored on every call, not just on creation: WooCommerce core's
   * `address-i18n.js` detaches and re-appends every `.form-row` in the billing
   * wrapper by priority on every checkout load, and this is a plain `<div>` that
   * never takes part in that resort. Guarded on `$node.prev()` so an
   * unconditional `insertAfter` doesn't collapse a text selection and restart
   * brand-overlay transitions when nothing drifted.
   */
  getCompanySummaryNode() {
    let $node = jQuery("#" + this.companySummaryId);
    const isNew = !$node.length;

    let $field = this.companyNameSurface();
    if (!$field.length)
      $field = jQuery(twoincCompanyCapture.numberFieldSelector(this.role) + "_field");
    if (!$field.length) $field = jQuery(this.nativeCompanyRowSelector());
    if (!$field.length) return $node;

    if (isNew) {
      $node = jQuery(
        '<div id="' +
          this.companySummaryId +
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
   * Render the captured company's number, read-only (TWO-25288).
   *
   * Both arguments are optional. Callers that already hold the values pass them
   * (the pick handler, sole-trader autofill, the user-meta restore, which
   * writes #company_id after this runs); everyone else omits them and the
   * current inputs are read.
   */
  renderCompanySummary(companyName, companyId) {
    const data =
      companyName === undefined && companyId === undefined
        ? this.readCapturedCompany()
        : { company_name: companyName, organization_number: companyId };

    // Display-normalised (TWO-25326 §12): an internally minted number reads
    // back as "" here, so a sole trader's captured company shows no number
    // label. The raw value stays on `#company_id`, which is what gets posted.
    const number = twoincUtilHelper.formatCompanyNumber(data.organization_number);

    const $node = this.getCompanySummaryNode();
    if (!$node.length) return;

    $node.find(".twoinc-company-summary-id").text(number);

    // Visible only in `search` mode (never `manual`, which clears #company_id;
    // never `sole_trader`, whose minted number isn't the buyer's own registry
    // identifier) with a non-synthetic number. Deliberately not gated on Two
    // being the selected method: the number belongs to the captured company,
    // not to Two's tile.
    const visible = Boolean(number && twoincCompanyCapture.modeFor(this.role) === "search");
    $node.toggleClass("hidden", !visible);
  }

  /**
   * Read the captured company straight out of the live inputs (TWO-25288) —
   * the capture pair's own fields, written by every capture mode.
   */
  readCapturedCompany() {
    return {
      company_name: twoincUtilHelper.blankToEmpty(twoincCompanyCapture.nameField(this.role).val()),
      organization_number: twoincUtilHelper.blankToEmpty(
        twoincCompanyCapture.numberField(this.role).val()
      )
    };
  }

  // ------------------------------------------------------------ manual entry

  /**
   * The link back out of manual entry and into company search, built hidden on
   * first use (TWO-25288). A real `<button type="button">` so it can't submit
   * the checkout form and so Enter/Space activate it natively.
   *
   * Bound directly on the element rather than delegated from document.body: a
   * delegated click handler was found live not to fire even though the mouse
   * event demonstrably reached this button.
   */
  getSearchCompanyBtnNode() {
    const id = this.searchCompanyBtnId;

    let $btn = jQuery("#" + id);
    if ($btn.length) return $btn;

    $btn = jQuery("<button></button>")
      .attr({ id: id, type: "button" })
      .text(this.searchCompanyText())
      .hide()
      .on("click", () => {
        this.exitManualCompanyEntry();
      })
      .on("keydown", (e) => {
        if (e.which !== 13 && e.which !== 32) return;
        e.preventDefault();
        e.stopPropagation();
        this.exitManualCompanyEntry();
      });

    this.companyFieldAffordanceSlot().append($btn);
    return $btn;
  }

  /**
   * Switch the company field from search to manual entry (TWO-25288). Reached
   * only from the manual-entry chip's activation, keyboard or mouse.
   */
  enterManualCompanyEntry() {
    // Guards the deferred activation landing AFTER an async sole-trader switch
    // raced in during the same tick: without it this would force the capture
    // mode back to `manual` and wipe the synthetic id that switch just wrote.
    if (this.soleTrader.mode === "sole_trader" || this.soleTrader.isDeciding()) return;
    // The chip stays on screen through the switch, so a fast second press
    // queues a second deferred call that would re-clear the field the buyer
    // has by then started typing into.
    if (twoincCompanyCapture.modeFor(this.role) === "manual") return;

    twoincCompanyCapture.setModeFor(this.role, "manual");

    jQuery(this.companyFieldSelector()).val("");
    twoincCompanyCapture.nameField(this.role).val("");
    twoincCompanyCapture.numberField(this.role).val("");

    // This role's own registry address too, mirroring clearSelectedCompany —
    // but ONLY when a registry lookup actually wrote it. Reaching manual entry
    // does not imply one ran, and clearing unconditionally would blank a
    // logged-in buyer's own account-prefilled address for no reason.
    const addressState = Twoinc.getInstance().addressStateFor(this.role);
    if (addressState.registryApplied) {
      Twoinc.getInstance().clearAddress(this.role);
      addressState.registryApplied = false;
    }
    // Billing-first, shipping-fallback (Doug 2026-08-31 §2): manual entry on
    // EITHER role drops that role's own number, which can change what the
    // order intent resolves to regardless of which role owns it.
    twoincCompanyCapture.syncOrderCompany();

    if (this.panel) {
      this.panel.releaseField();
      // The panel's own return link renders beside the search field, which
      // manual entry hides; WooCommerce's own company field for this role is
      // where the buyer types, so the link belongs beside that instead.
      this.panel.removeBackToSearchLink();
    }

    this.getSearchCompanyBtnNode().show();

    twoincDomHelper.toggleBusinessFields();

    // Releasing the field leaves focus on nothing, so a keyboard or AT user
    // loses their place mid-checkout.
    this.focusVisibleCompanyField(twoincAddressRoles.field(this.role, "company"));

    Twoinc.getInstance().getApproval();
  }

  /**
   * Switch the company field back from manual entry to search (TWO-25288).
   */
  exitManualCompanyEntry() {
    twoincCompanyCapture.setModeFor(this.role, "search");

    twoincCompanyCapture.nameField(this.role).val("");
    twoincCompanyCapture.numberField(this.role).val("");
    // Billing-first, shipping-fallback (Doug 2026-08-31 §2) — see
    // `enterManualCompanyEntry`'s own comment.
    twoincCompanyCapture.syncOrderCompany();

    this.getSearchCompanyBtnNode().hide();
    twoincDomHelper.toggleBusinessFields();

    // After toggleBusinessFields deliberately: the panel anchors against a
    // field that is only laid out once shown.
    Twoinc.getInstance().enableCompanySearch();

    if (!this.openCompanySearchDropdown()) {
      this.focusVisibleCompanyField(this.companyFieldSelector());
    }

    Twoinc.getInstance().getApproval();
  }

  /**
   * Move focus to a company field, if it is actually focusable (TWO-25288).
   * Guarded rather than a bare `.focus()`: the target may be absent on surfaces
   * like the pay-for-order page, and `.focus()` on an empty set is a silent
   * no-op that reads as success.
   */
  focusVisibleCompanyField(selector) {
    const $field = jQuery(selector);
    if (!$field.length || $field.prop("disabled")) return false;
    $field.trigger("focus");
    return jQuery(document.activeElement).is($field);
  }
}

/**
 * The PRIMARY (billing/invoice) `TwoCompanySearch` instance. Owns the payment
 * tile relocation and every invoice-scoped extra (address lookup, sole-trader
 * user-meta restore, required-field cues) — see `twoincSelectWooHelperShipping`
 * below for the delivery/shipping role's own instance.
 */
let twoincSelectWooHelper = new TwoCompanySearch({
  addressFieldSelector: "#billing_company_display",
  tileFieldSelector: "#twoinc_tile_company_name"
});

/**
 * The SECOND `TwoCompanySearch` instance, on the delivery/shipping role
 * (TWO-40, Doug 2026-08-31): billing's own second-address-panel counterpart,
 * same class, own DOM ids/classes so it owns its own nodes rather than
 * reusing the billing instance's. No `tileFieldSelector` — shipping company
 * capture has no payment-tile relocation concept, the search control's only
 * mount is the shipping address panel itself.
 */
let twoincSelectWooHelperShipping = new TwoCompanySearch({
  role: twoincAddressRoles.delivery(),
  addressFieldSelector: "#shipping_company_display",
  searchCompanyBtnId: "search_shipping_company_btn",
  companySummaryId: "twoinc_shipping_company_summary",
  differentSoleTraderBtnId: "select_different_sole_trader_btn_shipping",
  soleTraderNoteSlotClass: "twoinc-sole-trader-note-slot-shipping",
  soleTraderSpinnerClass: "twoinc-sole-trader-spinner-shipping",
  soleTraderSpinnerHostClass: "twoinc-name-searching-shipping"
});

/**
 * Every mounted company-search control, for the flows that must treat the two
 * symmetrically (bootstrap binding, per-refresh re-binding). A list rather
 * than two named calls so a third role cannot be added without those flows
 * picking it up.
 */
let twoincCompanySearchControls = [twoincSelectWooHelper, twoincSelectWooHelperShipping];

// Back-compat alias: every flow that predates the shipping instance and is
// genuinely invoice-scoped by design (order-intent, order restore from user
// meta, the billing-country change handler) keeps addressing the billing
// controller under this name rather than threading `twoincSelectWooHelper`
// through every one of those call sites.
let twoincSoleTrader = twoincSelectWooHelper.soleTrader;

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
        '#billing_company_display, label[for="billing_company_display"], #billing_company, label[for="billing_company"]',
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
      "#company_name_field",
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
    // `adoptSoleTraderBuyer()` never swaps its own search field away). Only
    // manual entry takes it away, handing the name over to the native field,
    // and is reachable only via `enterManualCompanyEntry` — never as a side
    // effect of Two being unavailable, of the merchant's admin setting, or of
    // the billing country: the control is mounted for every country
    // (TWO-25232), and a country the lookup returns nothing for reports that
    // through the dropdown like any other empty search. WHERE the control
    // renders is `company_search_location`'s business, below; never whether
    // it's active.
    const showCompanySearch = twoincCompanyCapture.mode !== "manual";

    // The capture pair's own rows are hidden but posted; in tile placement the
    // stock address row stays, whatever the tile shows.
    if (showCompanySearch && !twoincSelectWooHelper.isTileLocation()) {
      visibleTargets.push("#billing_company_display_field");
    } else {
      visibleTargets.push("#billing_company_field");
    }

    // The shipping company row, same shown-for-every-country rule as
    // billing's above, minus the tile relocation (shipping has no tile mount
    // — TWO-40) and minus the required-cue logic below (shipping's company
    // was never a required checkout field). Independent capture mode: the
    // buyer can be in manual entry on one address and search on the other.
    // Gated on the shipping form actually existing at all (no country field
    // means a virtual/no-shipping cart), so this is a no-op on a checkout that
    // never renders a shipping address in the first place.
    const hasShippingAddress =
      jQuery(twoincAddressRoles.field(twoincAddressRoles.delivery(), "country")).length > 0;
    if (hasShippingAddress) {
      allTargets.push("#shipping_company_display_field", "#shipping_company_field");
      if (twoincCompanyCapture.modeFor(twoincAddressRoles.delivery()) !== "manual") {
        visibleTargets.push("#shipping_company_display_field");
      } else {
        visibleTargets.push("#shipping_company_field");
      }
    }

    if (isTwoincSelected) {
      visibleTargets.push(
        "#invoice_email_field",
        "#purchase_order_number_field",
        "#project_field",
        "#department_field"
      );
      requiredTargets.push("#billing_phone_field");

      const companyRows = ["#billing_company_display_field", "#billing_company_field"];
      const visibleCompanyRow = visibleTargets.filter(function (target) {
        return companyRows.indexOf(target) >= 0;
      })[0];
      if (visibleCompanyRow) requiredTargets.push(visibleCompanyRow);
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
    twoincSelectWooHelper.soleTrader.syncDifferentSoleTraderLink();

    if (hasShippingAddress) {
      // Before renderCompanySummary() for the same reason billing's re-bind is
      // (above): the summary anchors against the field this control mounts on.
      twoincSelectWooHelperShipping.rebindUnlessManual();
      twoincSelectWooHelperShipping.renderCompanySummary();
      twoincSelectWooHelperShipping.soleTrader.syncDifferentSoleTraderLink();
    }
  },
  /**
   * Mirror each company field's visibility onto its enclosing wrapper
   * (TWO-25288). The pay-for-order page lays company inputs out in
   * per-field wrappers with their own hidden state, which the function
   * above doesn't touch — a no-op on the checkout page, which has no such
   * wrappers.
   */
  syncCompanyFieldWrappers: function () {
    jQuery(
      "#billing_company_display_field, #billing_company_field, #company_name_field, #company_id_field"
    ).each(function () {
      const $field = jQuery(this);
      const $wrapper = $field.closest(".twoinc-inp-container");
      if (!$wrapper.length) return;
      $wrapper.toggleClass("hidden", $field.hasClass("hidden"));
    });
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
  /**
   * Bumped by every pay-box paint. A deferred retire captures it at paint time
   * and compares before hiding, so it retires only its own notice — the box
   * being visible is not proof it is still the one that was painted, since a
   * later path can repaint the SAME box with a longer-lived message.
   */
  payBoxPaintSeq: 0,
  togglePaySubtitleDesc: function (action, errSelector, companyLabel) {
    twoincDomHelper.payBoxPaintSeq += 1;
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
              // A picker's empty-field hint is an element child, so without
              // this it would be snapshotted as though the buyer had chosen an
              // option of that name. Excluded from `subs` too, or
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
    // Alongside the field snapshot, since the same restore consumes both.
    twoincCompanyCapture.rememberCaptureMode();
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
        let skipIds = ["company_id", "company_name", "billing_company", "billing_company_display"];
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
    if (window.twoinc.user_meta_exists) {
      twoincSelectWooHelper.setDisplayName(window.twoinc.billing_company);
      // Both values passed explicitly: `#company_id` is written further down
      // this function, so reading the DOM here would render an empty number.
      twoincSelectWooHelper.renderCompanySummary(
        window.twoinc.billing_company,
        window.twoinc.company_id
      );
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

    // Paint the restored name into the search field too. It is the visible
    // company-NAME surface for a restored capture and `toggleBusinessFields()`
    // hides the native field that would otherwise display it, so an unpainted
    // field left a returning guest looking at a watermark over a hidden field
    // holding their own company.
    if (restoredName) twoincSelectWooHelper.setDisplayName(restoredName);

    // A restored sole trader: this restore path writes straight to the
    // capture layer above rather than through `twoincSoleTrader.setCompany()`
    // (the only place that sets `mode`/`soleTraderAdopted` and syncs the
    // "select a different sole trader" link), so without this a returning
    // buyer has no way back into a fresh signup.
    //
    // Keyed on the RECORDED capture mode, never on the number's shape: a
    // `TWO:` identifier is minted for registered companies in some countries
    // too, so a shape test reads those buyers as sole traders. With no record
    // — a capture predating one, or a fresh browser session behind a user-meta
    // echo — nothing is adopted, which is the safe direction.
    if (twoincCompanyCapture.recallCaptureMode(restoredName, restoredId) === "sole_trader") {
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
        .post(cfg.fees_url, { csrf_token: cfg.csrf_token })
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
      .post(cfg.select_url, { days: days, csrf_token: cfg.csrf_token })
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
 * Prefetched autofill answers by country — the buyer object, or `false` for
 * "nobody on the cookie". An absent entry means unresolved.
 *
 * Keyed by country because the delegated authority each was fetched under is.
 * Shared by every controller because the answer describes the buyer, not the
 * role: the billing and delivery panels each own an instance, and a signup
 * completed through one must not leave the other prompting the same buyer to
 * sign up again.
 */
const soleTraderAutofillByCountry = {};

/** Countries with a lookup outstanding, so two controllers make one request. */
const soleTraderAutofillPending = {};

/**
 * Set by a rate-limited lookup. Page-global, unlike the maps above: the limit
 * is on the endpoint, which one country's tokens reach as readily as another's.
 */
let soleTraderAutofillBackoffUntil = 0;

/**
 * Sole trader checkout — presentation only (TWO-24754).
 *
 * All business logic (country eligibility, token minting) lives in
 * WC_Twoinc_Sole_Trader; this module renders a Business / Sole trader
 * toggle, suppresses company search in sole-trader mode, opens Two's
 * hosted signup popup, and autofills the company fields from
 * GET /autofill/v1/buyer/current. Mirrors the Magento reference flow.
 */
function createSoleTraderController(companySearch) {
  const controller = {
    mode: "business", // 'business' | 'sole_trader'
    availabilityByCountry: {},
    tokens: null,

    /** The country `tokens` were minted for — their delegated authority is scoped to it. */
    tokenCountry: null,

    /** Backoff after a 429: callers gate on `!tokens`, so a failed mint otherwise re-mints every render. */
    tokenMintBackoffUntil: 0,
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
    /** @type {Function|null} the bound `visibilitychange` listener, paired with the above */
    visibilityHandler: null,
    /**
     * @type {Function|null} the bound capture-phase `mousedown` listener that
     * settles a chip click's own effect on an open popup, independently of
     * whatever the deferred path is doing.
     */
    chipMousedownHandler: null,
    /**
     * @type {number|null} the pending abandon a return to the checkout
     * scheduled, or `null` when none is outstanding.
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

    config: function () {
      return (window.twoinc && window.twoinc.sole_trader) || {};
    },

    // Delegated rather than a second copy of the same two lines (TWO-24867):
    // sole-trader availability is decided per country and cached per country,
    // so it disagreeing with the country the search and the change guard use
    // would be a cache keyed on one answer and read with another.
    currentCountry: function () {
      return companySearch.currentCountry();
    },

    isAvailable: function () {
      const country = controller.currentCountry();
      return controller.availabilityByCountry[country] === true;
    },

    /**
     * Re-evaluate the toggle after every checkout update or country change.
     * Availability is decided server-side by the registry answer for the
     * billing country (there is no merchant toggle — TWO-25163); responses
     * are cached per country for the page's lifetime.
     */
    refresh: function () {
      const cfg = controller.config();
      const $noteSlot = jQuery("." + companySearch.soleTraderNoteSlotClass);
      if (!cfg.availability_url || $noteSlot.length === 0) {
        controller.hide();
        return;
      }
      const country = controller.currentCountry();
      if (!country) {
        controller.hide();
        return;
      }
      if (country in controller.availabilityByCountry) {
        controller.apply(controller.availabilityByCountry[country]);
        return;
      }
      jQuery
        .get(cfg.availability_url, { country: country, csrf_token: cfg.csrf_token })
        .done(function (response) {
          const available = !!(
            response &&
            response.success &&
            response.data &&
            response.data.available
          );
          controller.availabilityByCountry[country] = available;
          // The buyer may have changed country while the request was in
          // flight; only apply if the answer is still for the current one.
          if (controller.currentCountry() === country) {
            controller.apply(available);
          }
        })
        .fail(function (jqXHR) {
          // A 429 caches like an answer, or every `updated_checkout` re-requests
          // into the limit. Other failures stay uncached: a cached "no" would
          // hide sole trader all page over one dropped connection.
          if (jqXHR && jqXHR.status === 429) {
            controller.availabilityByCountry[country] = false;
            window.setTimeout(function () {
              delete controller.availabilityByCountry[country];
            }, twoincUtilHelper.retryAfterMs(jqXHR));
          }
          // Fail-soft: no sole trader option, checkout proceeds as business.
          if (controller.currentCountry() === country) {
            controller.apply(false);
          }
        });
    },

    apply: function (available) {
      if (available) {
        controller.render();
      } else {
        controller.hide();
      }
      // The mode chip lives inside the company-search panel, not here —
      // re-sync so an availability change while it's open adds/removes live.
      companySearch.syncModeChips();
    },

    hide: function () {
      jQuery("." + companySearch.soleTraderNoteSlotClass)
        .addClass("hidden")
        .empty();
      jQuery("#" + companySearch.differentSoleTraderBtnId).hide();
      // Refused while `isBusy()`, same as the Business chip: this runs from
      // `refresh()` on every `updated_checkout` (coupon, shipping, quantity —
      // not only country), so an unconditional revert would drop a signup
      // still completing in the popup. `watchPopupClose` re-checks adoption
      // once it settles, so deferring here loses nothing.
      if (controller.mode === "sole_trader" && !controller.isBusy()) {
        controller.setMode("business");
      }
    },

    render: function () {
      const cfg = controller.config();
      const $container = jQuery("." + companySearch.soleTraderNoteSlotClass);
      $container.empty().removeClass("hidden");

      // Bell-icon note + signup link — shown only when sole-trader mode is
      // active and signup is needed, and as the fallback when an
      // auto-launched popup is blocked. The mode chips themselves are NOT
      // built here — they render as children of the company-search panel, see
      // TwoCompanySearch#chips().
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
          controller.launchSignup();
        })
        .appendTo($note);
      $container.append($note);

      controller.retireTokens();
      // Minted here rather than at click time, since `window.open()` outside
      // the click's own gesture is blocker bait. Tokens are country-scoped,
      // not email-scoped, so one mint per page serves every launch.
      //
      // The callback re-decides the "select a different sole trader" link: a
      // sole trader restored from a previous order is already adopted before
      // any mint has happened, and that link only shows once `tokens` is real.
      if (!controller.tokens) {
        controller.fetchTokens(function () {
          controller.syncDifferentSoleTraderLink();
          controller.prefetchAutofill();
        });
      } else {
        controller.prefetchAutofill();
      }
    },

    /**
     * Resolve the autofill answer up front, on the same trigger as the token
     * mint, so the chip click has it already. Holds no flight, for the same
     * reason `refreshTokens` does not.
     */
    prefetchAutofill: function () {
      // A failed mint leaves no tokens, and the lookup then answers `null`
      // unconditionally — latching a false "nobody" over a real registration.
      if (!controller.tokens) return;
      // Tokens are minted once, for the country the buyer had then, so after a
      // country change there is no authority to ask under and the chip falls
      // back to the signup popup.
      const country = controller.currentCountry();
      if (controller.tokenCountry !== country) return;
      if (soleTraderAutofillPending[country]) return;
      if (controller.heldAutofill() !== null) return;
      if (Date.now() < soleTraderAutofillBackoffUntil) return;
      soleTraderAutofillPending[country] = true;
      controller.fetchCurrentBuyer(function (buyer, failed, response) {
        delete soleTraderAutofillPending[country];
        // A dropped request is not an answer: held, it would latch "nobody"
        // for the life of the page and block the next render's retry. A rate
        // limit is the one failure retrying makes worse.
        if (failed) {
          // `Retry-After` is not CORS-safelisted and this request is
          // cross-origin, so the server's own value is unreadable here —
          // `retryAfterMs`'s default stands in.
          if (response && response.status === 429) {
            soleTraderAutofillBackoffUntil = Date.now() + twoincUtilHelper.retryAfterMs();
          }
          return;
        }
        controller.holdAutofill(buyer || false, country);
      });
    },

    /**
     * Retire tokens minted for a country the buyer has since left — their
     * delegated authority is scoped to it, and the next `render()` mints for
     * the country now on the field.
     *
     * Refused while busy, since an outstanding signup's own buyer lookup
     * still needs them; called from `render()` rather than the country change
     * itself so a refusal is retried on the next one, instead of stranding
     * the page on authority for a country it has left.
     */
    retireTokens: function () {
      if (controller.tokenCountry === controller.currentCountry()) return;
      if (controller.isBusy()) return;
      controller.tokens = null;
      controller.tokenCountry = null;
    },

    /** @returns {Object|boolean|null} the answer held for this role's country, `null` if none */
    heldAutofill: function () {
      const country = controller.currentCountry();
      if (!country) return null;
      const held = soleTraderAutofillByCountry[country];
      return held === undefined ? null : held;
    },

    holdAutofill: function (buyer, country) {
      soleTraderAutofillByCountry[country] = buyer;
    },

    /**
     * Selected-chip state, delegated to the group's own owner — the chips live
     * inside the company-search panel, not here.
     */
    updateChips: function () {
      companySearch.syncModeChips();
    },

    showNote: function (show) {
      jQuery("." + companySearch.soleTraderNoteSlotClass)
        .find(".twoinc-sole-trader-note")
        .toggleClass("hidden", !show);
    },

    /**
     * A sole-trader round trip has started (TWO-40 §7). The busy state is
     * shown over the company-NAME field — the same in-field spinner an
     * ordinary company search uses — rather than in the query row it hides,
     * so it's visible for the link-click entry point too, which never has a
     * dropdown open to paint in.
     */
    beginFlight: function () {
      controller.flightDepth += 1;
      if (controller.flightDepth === 1) {
        // The note slot and the chip group — the two places busy state is
        // ever visible. Both scoped to THIS instance: the note-slot class is
        // per-instance, and the chip row is found within this instance's own
        // field wrap, since every instance's panel shares the same chip-row
        // class (TWO-40).
        jQuery("." + companySearch.soleTraderNoteSlotClass)
          .add(companySearch.modeChipsNode())
          .addClass("twoinc-sole-trader-toggle--busy");
      }
      companySearch.syncSoleTraderSurfaces();
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
      controller.flightDepth = Math.max(0, controller.flightDepth - 1);
      if (controller.flightDepth === 0) {
        jQuery("." + companySearch.soleTraderNoteSlotClass)
          .add(companySearch.modeChipsNode())
          .removeClass("twoinc-sole-trader-toggle--busy");
        if (controller.closeDropdownOnSettle) {
          controller.closeDropdownOnSettle = false;
          companySearch.closeCompanySearchDropdown();
        }
      }
      companySearch.syncSoleTraderSurfaces();
    },

    /**
     * The "select a different sole trader" link, built hidden on first use
     * (TWO-40 §7). Same visual slot and shape as the "search for company"
     * link manual entry already offers. One link covers both "pick a
     * different existing registration" and "register a new one" — that
     * choice happens inside the hosted signup's own UI.
     */
    getDifferentSoleTraderBtnNode: function () {
      const id = companySearch.differentSoleTraderBtnId;
      let $btn = jQuery("#" + id);
      if ($btn.length) {
        controller.placeDifferentSoleTraderBtn($btn);
        return $btn;
      }

      $btn = jQuery("<button></button>")
        .attr({ id: id, type: "button" })
        .text(
          (controller.config().text && controller.config().text.select_different) ||
            "Select a different sole trader"
        )
        .hide()
        // Bound directly on the element, click AND Enter/Space, for the same
        // reasons documented on getSearchCompanyBtnNode — a delegated click on
        // document.body was proven not to reach that button live.
        .on("click", function (event) {
          event.preventDefault();
          controller.launchSignup({ autoselect: false });
        })
        .on("keydown", function (event) {
          if (event.which !== 13 && event.which !== 32) return;
          event.preventDefault();
          event.stopPropagation();
          controller.launchSignup({ autoselect: false });
        });

      controller.placeDifferentSoleTraderBtn($btn);
      return $btn;
    },

    /**
     * The slot the "select a different sole trader" link hangs in: the input
     * wrapper INSIDE whichever company-name field is the visible one.
     *
     * TWO-40 §7 makes an adopted sole trader show through the live search
     * widget, so the search row takes the slot whenever it is the visible
     * surface — a button appended inside a hidden field never renders.
     *
     * Inside the row's wrapper rather than after the row (TWO-25503, Doug):
     * as a sibling it stacked against the row's own bottom margin and needed a
     * hardcoded negative margin to look right, which over-pulled it onto the
     * field itself. Inside, it sits where `#search_company_btn` already does.
     *
     * @returns {jQuery}
     */
    differentSoleTraderBtnSlot: function () {
      // Follows `companyNameSurface()` in both mount locations rather than
      // deciding once at creation (TWO-25503): this link is built late, only on
      // adoption, so a home chosen at that moment is a home chosen from whatever
      // happened to be visible then — which is how it has twice ended up in the
      // wrong region.
      const helper = companySearch;
      const $surface = helper.companyNameSurface();
      if ($surface.find(helper.companyFieldSelector()).length) {
        return helper.affordanceSlotIn($surface, helper.companyFieldSelector());
      }
      return helper.companyFieldAffordanceSlot();
    },

    /**
     * Re-anchor the link on every call, the same way `getCompanySummaryNode()`
     * does — this runs on every `toggleBusinessFields()`, and the visible
     * company-name surface can have changed since the last one.
     */
    placeDifferentSoleTraderBtn: function ($btn) {
      const $slot = controller.differentSoleTraderBtnSlot();
      // Position as well as parenthood: the link belongs last in the slot, after
      // the input, and anything appended to that slot after it — the company
      // summary on a re-render — leaves it stranded mid-slot otherwise.
      if ($btn.parent()[0] === $slot[0] && $slot.children().last()[0] === $btn[0]) return;
      $slot.append($btn);
    },

    /**
     * Show the "select a different sole trader" link only where it means
     * something: sole-trader mode (TWO-40 §7). Gated on mode + tokens only,
     * no `#company_id`-content check — that field is permanently hidden in
     * every mode, so there's no reason to lean on its DOM value here.
     */
    syncDifferentSoleTraderLink: function () {
      const show = controller.mode === "sole_trader" && !!controller.tokens;
      // Built lazily, only when about to be shown: this runs on every mode
      // switch, and building it eagerly would insert a hidden button into
      // the address form of every merchant who never sees this feature.
      if (!show && !jQuery("#" + companySearch.differentSoleTraderBtnId).length) return;
      controller.getDifferentSoleTraderBtnNode().toggle(show);
    },

    /**
     * A mode chip was clicked. Business is immediate; Sole trader switches
     * mode, then adopts the prefetched registration or opens the hosted
     * signup when there is none. Synchronous throughout, in both arms.
     */
    onModeChipClick: function (mode) {
      if (mode === "business") {
        // Reached only from tests today — the Registered company chip carries
        // its own click handler, and that is where this mode's abandon and
        // guard live. Kept as the shared entry point's business arm, matching
        // that handler's guard so calling it cannot diverge from the chip.
        if (!controller.isDeciding()) controller.setMode("business");
        return;
      }
      // Cancel any abandon the buyer's return armed, here rather than only in
      // the capture-phase mousedown (TWO-25503): Enter and Space produce no
      // mousedown, so keyboard-activating this chip raised the popup and then
      // let the still-armed timer close it 150ms later.
      clearTimeout(controller.refocusAbandonTimer);
      controller.refocusAbandonTimer = null;
      // A signup the buyer hasn't finished is still on screen, so this click
      // is asking for it back, not for anything new: raise it and stop.
      // Checked on the chip itself, not the refocus that usually precedes it
      // — a chip activated from the keyboard fires `click` with no
      // `mousedown`, so a raise hung off the refocus would leave Enter/Space
      // as the one route that can't get the buyer back to their popup.
      if (controller.refocusOpenPopups()) return;
      // Re-clicking once already adopted is the same re-signup the "select a
      // different sole trader" link launches, not a no-op — the chip is a
      // second, equally deliberate way to ask for it. `autoselect: false` so
      // the hosted flow offers a choice rather than handing back the
      // registration already adopted.
      if (controller.mode === "sole_trader" && controller.soleTraderAdopted) {
        controller.launchSignup({ autoselect: false });
        return;
      }
      controller.setMode("sole_trader");
      // Autofill first, hosted signup only when there is nobody to autofill
      // (TWO-40). The answer's subject is a cookie first-party to Two itself,
      // so it can only report a registration this buyer already declared.
      //
      // Read, never fetched: `render()` resolves it, and an unresolved answer
      // means the popup rather than a wait, so both arms stay in the click's
      // own gesture — see `openPopup`.
      const autofilled = controller.heldAutofill();
      if (autofilled) {
        // Same criterion as the post-signup path: a buyer object at all.
        controller.setCompany(autofilled.organization_number, autofilled.company_name, autofilled);
        controller.showNote(false);
        return;
      }
      controller.launchSignup();
    },

    /**
     * Is a sole-trader round trip or a signup popup currently outstanding
     * (TWO-40 §7)? The guard every other way to leave/interrupt
     * sole-trader mode checks before acting: the widget/chips deliberately
     * survive this window, so paths once unreachable while
     * `mode === "sole_trader"` (Business chip, reopenSearch(), an ordinary
     * pick) are reachable now, and acting on them mid-wait races the flow's
     * own resolution.
     */
    isBusy: function () {
      return controller.flightDepth > 0 || controller.activePopupWatchers.length > 0;
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
        controller.isBusy() &&
        (!controller.soleTraderAdopted || controller.soleTraderReconfirmingCount > 0)
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
      const isTransition = mode !== controller.mode;
      controller.mode = mode;
      if (isTransition) {
        controller.soleTraderAdopted = false;
        controller.soleTraderReconfirmingCount = 0;
      }
      if (mode === "sole_trader") {
        // Sole trader is its own company-capture mode: it renders through the
        // panel but carries a synthetic id, so neither manual entry nor an
        // ordinary registry pick's surfaces are right for it. Snapshotted first
        // so it can be restored on the way out, and written BEFORE the chip sync
        // below — `selectedMode()` reads both axes, and manual entry wins the tie.
        if (controller.savedCaptureMode === null) {
          controller.savedCaptureMode = twoincCompanyCapture.mode;
        }
        twoincCompanyCapture.mode = "sole_trader";
      }

      controller.updateChips();
      controller.syncDifferentSoleTraderLink();
      // Before the branch below, so a chip click made while the panel is already
      // open hides the query row in the click's own gesture.
      companySearch.syncSoleTraderSurfaces();

      // Nothing is torn down on the way IN: the panel and its spinner have to
      // survive the autofill round trip and the signup popup it can lead to.
      // `lockCapturedFields()` closes the panel once there is a company to show.
      if (mode !== "sole_trader") {
        controller.leaveSoleTraderMode();
        controller.setCompany("", "");
        twoincDomHelper.toggleBusinessFields();
        Twoinc.getInstance().enableCompanySearch();
        // The buyer may have been in manual entry when they switched to sole
        // trader, in which case the restored mode is `manual` and
        // enableCompanySearch just early-returned — without this the link back
        // to search stays hidden with no other route back to the picker.
        if (twoincCompanyCapture.mode === "manual") {
          companySearch.getSearchCompanyBtnNode().show();
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
      controller.showNote(false);
      twoincCompanyCapture
        .nameField()
        .add(twoincCompanyCapture.numberFieldSelector())
        .prop("readonly", false);
      if (controller.savedCaptureMode !== null) {
        twoincCompanyCapture.mode = controller.savedCaptureMode;
        controller.savedCaptureMode = null;
      }
      // A popup-close poll left over from a resolved adoption/re-signup keeps
      // `isBusy()`/`isDeciding()` true purely on its own 300ms cadence. This
      // is the one place every caller has already committed to leaving
      // sole-trader mode, so whatever that poll was still going to decide is
      // moot — left running it would race a deferred manual-entry switch,
      // wrongly refusing it while the stale busy state persists.
      controller.abandonSoleTraderFlow();
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
      controller.activePopupWatchers.forEach(function (watcher) {
        if (watcher.win.closed || typeof watcher.win.close !== "function") return;
        watcher.win.close();
      });
      controller.stopAllPopupWatchers();
    },

    /**
     * Close the panel and lock the captured fields, once a sole trader is
     * actually adopted. Split out of `setMode()` — see its comment — so
     * switching mode alone leaves the panel and its spinner alone; this is the
     * only moment there is nothing left to search for.
     *
     * The adopted name is painted into the company-name field the same way a
     * registry pick is, so an adopted sole trader reads as a company that was
     * searched and picked (TWO-40 §7 direction (a)).
     */
    lockCapturedFields: function (companyId, companyName) {
      // An adoption can land with no panel bound — manual entry releases the
      // field and the Sole trader chip is not hidden there.
      companySearch.attach(Twoinc.getInstance());
      companySearch.closeCompanySearchDropdown();
      companySearch.setDisplayName(companyName);

      jQuery("#" + companySearch.searchCompanyBtnId).hide();
      twoincCompanyCapture
        .nameField(companySearch.role)
        .add(twoincCompanyCapture.numberFieldSelector(companySearch.role))
        .prop("readonly", true);
    },

    /**
     * Click-to-reopen (TWO-40 §7): once a sole trader is adopted, the
     * captured fields readonly-lock and the query row is suppressed, leaving
     * no way back to an ordinary company search except the "select a
     * different sole trader" link, which only leads back into the same
     * hosted signup. Clicking into a locked captured field instead reverts to
     * business mode and lands the buyer in the reopened dropdown, same as
     * `exitManualCompanyEntry()` does leaving manual entry. In tile placement the
     * lock lands on hidden `#company_name`, so the chips are the route back.
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
      if (controller.mode !== "sole_trader" || controller.isDeciding()) return;
      controller.setMode("business");
      const helper = companySearch;
      // Reached from the captured fields in the ADDRESS area, which stay on
      // screen while the panel's own host — the payment tile — is collapsed.
      if (!helper.companySearchIsReachable()) return;
      if (!helper.openCompanySearchDropdown()) {
        helper.focusVisibleCompanyField(helper.companyFieldSelector());
      }
    },

    /**
     * Open the hosted signup popup, falling back to the visible link if the
     * browser blocks the window. Re-entrancy-guarded (TWO-40 §7): a second
     * activation while one is already opening is dropped, and an activation
     * while an already-open popup's outcome is undecided raises that popup
     * instead of opening a second one.
     *
     * A re-signup (`options.autoselect === false`) is also refused while a
     * different one is already outstanding: `openingSignup` only guards two
     * clicks in the same synchronous gesture, not a later sequential one —
     * closing one re-signup and re-clicking is exactly the case that made
     * `soleTraderReconfirmingCount` a count rather than a boolean.
     */
    launchSignup: function (options) {
      if (controller.openingSignup) return;
      // One live undecided popup at a time. "Live" is load-bearing: a
      // hand-closed record stays undecided until its own poll notices, and a
      // relaunch is deliberately allowed to open alongside it — reading
      // "undecided" alone would mis-attribute an inbound ACCEPTED (see
      // `findPopupWatcher`). Scoped to each popup's own outcome rather than
      // `isDeciding()`, which would strand a chip click when no popup exists
      // and only a stale flight is outstanding.
      if (controller.signupConfirming) return;
      // The abandon a return to the checkout armed goes, whatever this
      // activation then does: left running it closes the popup 150ms later,
      // raised or freshly opened. Only the mode chips cancel it on their own.
      clearTimeout(controller.refocusAbandonTimer);
      controller.refocusAbandonTimer = null;
      // Raised, not silently dropped: the popup that would answer this
      // activation is already on screen, and a refusal that does nothing at all
      // reads as a dead control to a buyer who cannot see it.
      if (controller.refocusOpenPopups()) return;
      if (options && options.autoselect === false && controller.soleTraderReconfirmingCount > 0) {
        return;
      }
      controller.openingSignup = true;
      try {
        const win = controller.openPopup(options);
        controller.showNote(!win);
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
            controller.soleTraderReconfirmingCount += 1;
          }
          controller.closeDropdownOnSettle = true;
          controller.watchPopupClose(win, isReconfirming);
        }
      } finally {
        // Released once the synchronous open has returned, blocked or not —
        // held any longer and a blocked popup would lock the buyer out of
        // retrying via the fallback link.
        controller.openingSignup = false;
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
      controller.bindWindowRefocusListener();
      controller.beginFlight();
      const watcher = { id: null, win: win, isReconfirming: !!isReconfirming, decided: false };
      watcher.id = setInterval(function () {
        if (!win.closed) return;
        controller.settleClosedPopup(watcher, false);
      }, 300);
      controller.activePopupWatchers.push(watcher);
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
      controller.stopWatchingPopup(watcher.id);
      if (chipOwnsOutcome) {
        // Consumed, not honoured: the chip decides what happens to the
        // dropdown, and closing it here would destroy the button whose
        // `click` hasn't been dispatched yet.
        controller.closeDropdownOnSettle = false;
      }
      controller.settleFlight();
      if (watcher.isReconfirming && !watcher.decided) {
        // Abandoned without a decision — this settle owns the decrement. A
        // decided popup's decrement belongs to the ACCEPTED handler instead.
        controller.soleTraderReconfirmingCount = Math.max(
          0,
          controller.soleTraderReconfirmingCount - 1
        );
      }
      if (
        // Skipped on the chip path: `setMode`'s business branch destroys the
        // dropdown the chip lives in, and reverting here would make the
        // Registered company chip's own "already in business mode" no-op
        // swallow the click.
        !chipOwnsOutcome &&
        controller.mode === "sole_trader" &&
        !controller.soleTraderAdopted &&
        !controller.signupConfirming &&
        // A popup relaunched inside this poll's stale window owns the mode
        // now — reverting under it would drop its eventual ACCEPTED on the
        // `mode !== "sole_trader"` gate.
        //
        // "Still on screen" is the question, not "still undecided": a popup
        // whose ACCEPTED resolved to no buyer is decided yet still open, and
        // a retry inside it posts a second ACCEPTED a revert would drop on
        // that same gate.
        !controller.activePopupWatchers.some(function (other) {
          return !other.win.closed;
        })
      ) {
        controller.setMode("business");
      }
    },

    /**
     * Close an abandoned signup popup when the buyer comes back to the
     * checkout.
     *
     * A window `focus` listener AND a `visibilitychange` one. The hosted signup
     * is a separate window, so a round trip to it and back leaves the checkout's
     * own tab `visible` throughout and only `focus` reports it; a buyer who
     * fetches their code from another TAB of the same window is the reverse.
     * Which of the two Chrome reports for an in-window tab switch is not
     * established, so both are bound and the arming guard absorbs a duplicate.
     * Bound lazily from `watchPopupClose`, left bound for the window's lifetime
     * like the `message` listener.
     *
     * The target check is not defensive noise: jQuery's `.trigger("focus")`
     * does not dispatch natively — it walks the propagation path itself,
     * window included. This file triggers focus that way on the company field
     * (`focusVisibleCompanyField`), so without the check, opening the dropdown
     * would close the popup.
     *
     * The refocus only SCHEDULES the abandon — which of three things the
     * buyer meant depends on what they activated, and window `focus` fires
     * before that gesture completes — so the decision has to outlive the focus
     * handler by `refocusChipGraceMs`:
     *
     *  - Sole trader chip → cancel the abandon; activating it asks for that
     *    popup back and `onModeChipClick` raises it.
     *  - any other mode chip → abandon now, so the chip's own handler runs
     *    against settled state — left to the timer it would land afterwards
     *    and the chip's `isDeciding()` guard would wrongly refuse it.
     *  - anything else (alt-tab back, a click on the page) → the timer fires
     *    and abandons.
     *
     * Each chip resolves this from its own `click` handler, which is the only
     * event Enter and Space produce. The capture-phase `mousedown` below is the
     * pointer's earlier shortcut to the same decision, not the only route to it.
     * Capture phase, on `document` rather than the chips: chips are rebuilt
     * on every dropdown open, and capture reaches them regardless.
     *
     * @returns {void}
     */
    bindWindowRefocusListener: function () {
      if (controller.refocusHandler) return;
      controller.refocusHandler = function (event) {
        if (event && event.target && event.target !== window && event.target !== document) return;
        controller.scheduleRefocusAbandon();
      };
      window.addEventListener("focus", controller.refocusHandler);

      // Paired with `focus` because neither signal covers the case alone. A
      // return from another TAB of the same window is a visibility change;
      // a return from another WINDOW leaves visibility untouched. Whether
      // Chrome also emits a window `focus` for the first is not something
      // this plugin should depend on, so both are bound and the arming
      // guard below makes a duplicate harmless.
      controller.visibilityHandler = function () {
        // Fires on HIDE as well as show, and arming is coalesced onto the first
        // caller — so arming here would spend the grace the buyer's actual
        // return needs, leaving them a fraction of it or none.
        if (document.visibilityState === "hidden") return;
        controller.scheduleRefocusAbandon();
      };
      document.addEventListener("visibilitychange", controller.visibilityHandler);

      controller.chipMousedownHandler = function (event) {
        const target = event && event.target;
        const chip =
          target && typeof target.closest === "function"
            ? target.closest("." + companySearch.modeChipClass)
            : null;
        if (!chip) return;
        // Whatever the deferred path is or is not waiting on: a chip click is
        // the buyer saying which mode they want, and only Sole trader means
        // "give me that popup back".
        clearTimeout(controller.refocusAbandonTimer);
        controller.refocusAbandonTimer = null;
        if (chip.getAttribute("data-two-chip") === "sole_trader") return;
        controller.abandonPopupsForChipClick();
      };
      document.addEventListener("mousedown", controller.chipMousedownHandler, true);
    },

    /**
     * Arm the deferred abandon, decided when the grace elapses rather than now:
     * the buyer can arrive or leave again inside it, and the answer that matters
     * is the one at the moment the popup would actually go.
     *
     * A refused close is simply a wasted cycle — the next `focus` or visibility
     * change arms again, and nothing else keys off this timer (TWO-25503: the
     * chip handler used to, which is how a refused close took the chips with
     * it).
     *
     * @returns {void}
     */
    scheduleRefocusAbandon: function () {
      // Coalesced onto the FIRST arming. Nothing clears an armed timer, so a
      // second signal would not move the deadline — it would leave a SECOND
      // timer running past it, coming due against whatever popup exists by then
      // rather than the one the buyer walked away from. Window-targeted `focus`
      // arrives in bursts (a blur fires one, so the panel closing its own
      // dropdown produces a stream), and a single return can legitimately reach
      // both this and the visibility listener.
      if (controller.refocusAbandonTimer !== null) return;
      controller.refocusAbandonTimer = setTimeout(function () {
        controller.refocusAbandonTimer = null;
        if (!controller.checkoutIsInFront()) return;
        controller.closeAbandonedPopups();
      }, controller.refocusChipGraceMs);
    },

    /** Test seam / teardown: drop the window `focus` listener, the mousedown
     * listener that resolves it, and any abandon still scheduled.
     * @returns {void}
     */
    unbindWindowRefocusListener: function () {
      clearTimeout(controller.refocusAbandonTimer);
      controller.refocusAbandonTimer = null;
      if (controller.chipMousedownHandler) {
        document.removeEventListener("mousedown", controller.chipMousedownHandler, true);
        controller.chipMousedownHandler = null;
      }
      if (controller.visibilityHandler) {
        document.removeEventListener("visibilitychange", controller.visibilityHandler);
        controller.visibilityHandler = null;
      }
      if (!controller.refocusHandler) return;
      window.removeEventListener("focus", controller.refocusHandler);
      controller.refocusHandler = null;
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
     * The deferred path's own closer. A pointer activation of a chip resolves
     * before this runs, via the capture-phase mousedown; a keyboard one resolves
     * in the chip's `click` handler, which can land after this has already
     * fired. See `bindWindowRefocusListener` and `abandonPopupsForChipClick`.
     */
    closeAbandonedPopups: function () {
      controller.abandonablePopups().forEach(function (watcher) {
        if (typeof watcher.win.close !== "function") return;
        watcher.win.close();
      });
    },

    /**
     * Is the buyer actually looking at the checkout right now?
     *
     * A window `focus` fires when the browser WINDOW activates even while the
     * checkout is the background tab, so `focus` alone cannot tell "came back to
     * the checkout" from "opened the signup email in another tab of the same
     * window".
     *
     * Gates ONLY the deferred refocus path. The chip handlers decide for
     * themselves and must never consult this: in an iframed checkout it is false
     * for the whole session unless the frame itself holds focus, and a buyer who
     * clicks a chip has told us what they want whatever the frame owns.
     *
     * @returns {boolean}
     */
    checkoutIsInFront: function () {
      if (typeof document.hasFocus !== "function") return true;
      return document.hasFocus();
    },

    /**
     * Abandon the signup popups because the buyer chose a mode chip other than
     * Sole trader. Same close as `closeAbandonedPopups`, but drains each
     * popup's settle synchronously rather than leaving it to the 300ms poll, so
     * whatever runs next sees no outstanding flight or live popup. Safe to drain
     * early only because `chipOwnsOutcome` holds back the steps that touch the
     * dropdown — see `settleClosedPopup`.
     *
     * Reached from the chip's `mousedown` where there is one, and from its
     * `click` regardless, which is the only one Enter and Space produce.
     */
    abandonPopupsForChipClick: function () {
      controller.abandonablePopups().forEach(function (watcher) {
        if (typeof watcher.win.close === "function") watcher.win.close();
        controller.settleClosedPopup(watcher, true);
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
      const abandonable = controller.abandonablePopups();
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
      return controller.activePopupWatchers.filter(function (watcher) {
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
      controller.activePopupWatchers = controller.activePopupWatchers.filter(function (existing) {
        return existing.id !== id;
      });
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
      const watchers = controller.activePopupWatchers;
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
      controller.activePopupWatchers.forEach(function (watcher) {
        clearInterval(watcher.id);
        controller.settleFlight();
      });
      controller.activePopupWatchers = [];
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
      if (companyId && controller.mode === "sole_trader") {
        // The moment there is actually a sole trader captured — not just a
        // mode switch (TWO-40 §7) — is the moment there is nothing left to
        // search for. Locking here, not on every switch into sole-trader
        // mode, is what lets the dropdown+spinner survive the autofill/popup
        // round trip.
        controller.lockCapturedFields(companyId, companyName);
        // Read by `watchPopupClose()` in place of `#company_id`'s raw value.
        controller.soleTraderAdopted = true;
      }
      twoincCompanyCapture.write(companyName, companyId, { role: companySearch.role });
      // The visible field too, when this is the clearing call setMode("business")
      // makes: without it a company picked before the sole-trader detour stays
      // painted after being cleared from both posted fields (TWO-25288).
      if (!companyName) {
        companySearch.setDisplayName("");
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
        instance.setAddress(buyerAddress, companySearch.role);
        instance.addressStateFor(companySearch.role).registryApplied = true;
      }
      // This role's own phone field, where the form has one (WooCommerce
      // renders `#shipping_phone` only on stores that ask for it).
      if (companyId && buyer && buyer.phone_number) {
        jQuery(twoincAddressRoles.field(companySearch.role, "phone")).val(buyer.phone_number);
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
      companySearch.renderCompanySummary(companyName, companyId);
      controller.syncDifferentSoleTraderLink();
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
      const cfg = controller.config();
      if (!cfg.tokens_url) {
        if (cb) cb(false);
        return;
      }
      if (Date.now() < controller.tokenMintBackoffUntil) {
        if (cb) cb(false);
        return;
      }
      const country = controller.currentCountry();
      // A mint under an unreadable country would scope its authority to
      // nothing, and `tokenCountry` gates every later use of it.
      if (!country) {
        if (cb) cb(false);
        return;
      }
      jQuery
        .post(cfg.tokens_url, { csrf_token: cfg.csrf_token, country: country })
        .done(function (response) {
          // The buyer may have changed country while the request was in
          // flight — same guard `refresh()` uses for availability. Without
          // it, a slower request for the country the buyer just left can
          // land after a newer one and overwrite `tokens` with delegated
          // authority for the wrong jurisdiction.
          if (controller.currentCountry() !== country) {
            if (cb) cb(false);
            return;
          }
          if (response && response.success && response.data && response.data.autofill_token) {
            controller.tokens = response.data;
            controller.tokenCountry = country;
            controller.bindPopupMessageListener();
            controller.scheduleTokenRefresh();
            if (cb) cb(true);
          } else {
            if (cb) cb(false);
          }
        })
        .fail(function (jqXHR) {
          if (jqXHR && jqXHR.status === 429) {
            controller.tokenMintBackoffUntil = Date.now() + twoincUtilHelper.retryAfterMs(jqXHR);
          }
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
      if (controller.tokenRefreshIntervalId) return;
      controller.tokenRefreshIntervalId = setInterval(controller.refreshTokens, 30 * 60 * 1000);
      window.addEventListener("pagehide", controller.handlePageHide);
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
      if (controller.isBusy()) return;
      controller.fetchTokens(function () {});
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
      controller.stopTokenRefresh();
    },

    /**
     * @returns {void}
     */
    stopTokenRefresh: function () {
      clearInterval(controller.tokenRefreshIntervalId);
      controller.tokenRefreshIntervalId = null;
      window.removeEventListener("pagehide", controller.handlePageHide);
    },

    /**
     * Read the buyer on the Two cookie. Invokes cb(buyer) with the buyer
     * details, or cb(null) when none exist (404). No UI side effects — the
     * caller decides what to do with the result.
     *
     * A request that produced no answer invokes cb(null, true, response) — a
     * distinction that only matters to a caller which holds the answer.
     */
    fetchCurrentBuyer: function (cb) {
      if (!controller.tokens) {
        cb(null);
        return;
      }
      // The one call no server hop can make (its subject is the API-domain cookie the hosted signup set).
      const headers = { "two-delegated-authority-token": controller.tokens.autofill_token };
      const customHeaders = controller.tokens.custom_headers;
      if (customHeaders) {
        Object.keys(customHeaders).forEach(function (name) {
          headers[name] = customHeaders[name];
        });
      }
      // make_request() attaches client/client_v server-side; this is the one
      // call with no server hop to attach them from.
      const query = new URLSearchParams(window.twoinc.api_client_params || {}).toString();
      let refused = null;
      fetch(
        window.twoinc.twoinc_checkout_host +
          "/autofill/v1/buyer/current" +
          (query ? "?" + query : ""),
        {
          credentials: "include",
          headers: headers
        }
      )
        .then(function (response) {
          if (response.ok) return response.json();
          // Every non-2xx path must still drain the body. Abandoning an unread
          // response leaves the request in flight as far as the browser is
          // concerned, so the in-flight request count never returns to zero and
          // anything waiting on network-idle (tooling, analytics, some themes)
          // hangs.
          return response.text().then(function () {
            if (response.status === 404) return null;
            refused = response;
            throw new Error("autofill/v1/buyer/current failed");
          });
        })
        .then(
          function (json) {
            cb(json || null);
          },
          // Paired with the success handler rather than chained after it, so
          // a throw from the callback itself cannot re-enter it as a failure.
          function () {
            cb(null, true, refused);
          }
        );
    },

    /**
     * Open the hosted sole-trader signup in a real popup window (TWO-40 §7).
     *
     * `window.open()`, not an iframe-in-overlay: the signup/OTP flow depends
     * on a third party that only works in a real popup window. An
     * async-delayed `window.open()` is refused outright by WebKit, so neither
     * the token mint nor the autofill lookup is in this path — `render()`
     * resolves both up front and every caller reaches here inside the click's
     * own gesture. The visible note link is the fallback for a refusal.
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
      if (!controller.tokens) {
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
        company_name: companySearch.getCompanyName(),
        phone_number: read("phone"),
        billing_address: {
          street: read("address_1"),
          postal_code: read("postcode"),
          city: read("city"),
          region: read("state"),
          country_code: controller.currentCountry()
        }
      };
      let url =
        controller.tokens.signup_url +
        "?businessToken=" +
        encodeURIComponent(controller.tokens.delegation_token) +
        "&autofillToken=" +
        encodeURIComponent(controller.tokens.autofill_token) +
        "&autofillData=" +
        encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(prefill)))));
      // PDEV-4669: server-vetted country only — a DOM read would let the buyer
      // pick their own verification flow.
      const country = (controller.tokens.country || "").toUpperCase();
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
      if (controller.messageListenerBound) {
        return;
      }
      controller.messageListenerBound = true;
      // Kept on the module so it can be unbound again. A `window` listener
      // outlives everything else this module owns, so without a handle on it
      // there is no way to take one down — which matters to any harness that
      // re-evaluates this file against the same window.
      controller.messageHandler = function (event) {
        if (controller.mode !== "sole_trader" || !controller.tokens) {
          return;
        }
        const signupOrigin = new URL(controller.tokens.signup_url).origin;
        if (event.origin !== signupOrigin) {
          return;
        }
        if (event.data === "ACCEPTED") {
          // Attribute the message to the popup that sent it — see
          // `findPopupWatcher`. Marked decided at receipt so its close poll
          // must not treat it as abandoned or spend its reconfirming
          // decrement (that belongs to this handler's callback below).
          const watcher = controller.findPopupWatcher(event.source);
          // A replayed ACCEPTED resolves to its own, already-decided popup;
          // only the receipt that actually settles a popup may spend its
          // decrement below.
          const newlyDecided = !!watcher && !watcher.decided;
          if (watcher) {
            watcher.decided = true;
          }
          controller.beginFlight();
          // Held for the duration of this fetch: the popup can close the
          // instant "ACCEPTED" is posted, well before this resolves and
          // writes `#company_id` — `watchPopupClose()`'s own poll checks
          // this before deciding the buyer abandoned signup with nothing
          // captured.
          controller.signupConfirming = true;
          controller.fetchCurrentBuyer(function (buyer) {
            // Authenticated path (TWO-40 §8): the server has just told this
            // browser who the buyer is, so the email they authenticated with
            // is the answer, full stop. Re-checking it against the
            // checkout's own contact field is a confirmed bug: a buyer who
            // signs up under a different address completes OTP, the stale
            // email match disagrees with the server, and the same popup
            // reopens forever.
            const resolved = !!buyer;
            controller.signupConfirming = false;
            try {
              // Decremented here rather than only on popup close so a
              // resolved re-signup un-blocks the Business
              // chip/`reopenSearch()` immediately, not after another 300ms
              // poll cycle. `newlyDecided` covers a late or replayed
              // ACCEPTED, which must not spend a second decrement against
              // one increment.
              if (newlyDecided && watcher.isReconfirming) {
                controller.soleTraderReconfirmingCount = Math.max(
                  0,
                  controller.soleTraderReconfirmingCount - 1
                );
              }
              if (resolved) {
                // A signup replaces the cookie's buyer. Filed under the
                // country the tokens were minted under, which is what
                // `heldAutofill` keys on — not whatever the field reads by
                // the time the signup completes.
                controller.holdAutofill(buyer, controller.tokenCountry);
                controller.setCompany(buyer.organization_number, buyer.company_name, buyer);
                controller.showNote(false);
              } else {
                controller.showError();
              }
            } finally {
              // In a `finally`, and after the capture above has landed: a
              // throw from the writes would otherwise hold `flightDepth`
              // above zero for the life of the page, leaving `isBusy()` true
              // and every exit from sole-trader mode refused.
              controller.settleFlight();
            }
          });
        } else {
          controller.showError();
        }
      };
      window.addEventListener("message", controller.messageHandler);
    },

    /** Test seam: take the hosted-signup listener back off the window. */
    unbindPopupMessageListener: function () {
      if (!controller.messageHandler) return;
      window.removeEventListener("message", controller.messageHandler);
      controller.messageHandler = null;
      controller.messageListenerBound = false;
    },

    showError: function () {
      const cfg = controller.config();
      const $container = jQuery("." + companySearch.soleTraderNoteSlotClass);
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
  return controller;
}

class Twoinc {
  constructor() {
    if (instance) {
      throw "Twoinc is a singleton";
    }
    instance = this;

    this.isInitialized = false;
    this.isTwoincApproved = null;
    // Registry-address state per address ROLE, never shared between them
    // (Doug 2026-09-01): the two address forms are independent, so a capture
    // on one must not supersede the other's in-flight lookup nor decide
    // whether the other's address is the plugin's to clear. See
    // `addressStateFor()`.
    this.addressState = {};
    /** Timer that retires the busy-retry box a refused lookup painted. */
    this.addressLookupNoticeTimer = null;
    this.orderIntentCheck = {
      interval: null,
      pendingCheck: false,
      // Monotonic supersession counter for the order-intent request, same
      // idiom as the address lookup's own counter. Bumped when a request is issued
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
      renderInterval: null,
      // Backoff after a 429: `updated_checkout` re-arms a check per keystroke,
      // so one refusal otherwise becomes a request per second all window.
      rateLimitedUntil: 0,
      /** Timer from `scheduleRateLimitRetry`, so it can be cancelled and cleared. */
      rateLimitRetryTimer: null
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
  }

  /**
   * Bind the company-search panel to whichever company-name field is current.
   *
   * The mode gate only keeps the bootstrap and its retry off a field manual
   * entry has released; `syncCompanySearchTileLocation()` re-binds sole trader.
   * Gated per role, not on billing's mode: capture mode is independent per
   * address, so billing sitting in manual entry must not keep the shipping
   * control unmounted (TWO-40).
   */
  enableCompanySearch() {
    twoincCompanySearchControls.forEach((control) => {
      if (twoincCompanyCapture.modeFor(control.role) !== "search") return;
      control.attach(this);
    });
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

    // Enable company search, then again on a delay to catch a billing
    // fragment that WooCommerce had not rendered yet when initialize()
    // ran.
    //
    // Wrapped rather than passed by reference (TWO-25337): `setTimeout`
    // invokes a bare method reference with the global as its receiver, so
    // `this` inside enableCompanySearch would be `window`.
    this.enableCompanySearch();
    setTimeout(function () {
      self.enableCompanySearch();
    }, 800);

    // Disable or enable actions based on the account type
    $body.on("updated_checkout", Twoinc.getInstance().onUpdatedCheckout);

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
    $body.on("change", "#billing_company", function () {
      if (!twoincCompanyCapture.isNameField(this)) return;
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
    // Only ever fires for a real buyer edit: every plugin write to THIS field
    // goes through `.val()`, which dispatches nothing.
    //
    // In tile placement `#billing_company` is an address line, not the capture.
    $body
      .off("input.twoincCompanyPairing change.twoincCompanyPairing", "#billing_company")
      .on(
        "input.twoincCompanyPairing change.twoincCompanyPairing",
        "#billing_company",
        function () {
          if (!twoincCompanyCapture.isNameField(this)) return;
          twoincCompanyCapture.guardCompanyRetype();
        }
      );

    // Handle the country inputs change event. The tracker behind it is seeded
    // at the END of this function, not here — see the comment there.
    $body.on("change", "#billing_country", self.onCountryInputChange);

    // Shipping's own retype guard / country-change / click-to-reopen (Doug
    // 2026-08-31 §2, complete instance parity) — same three bindings as
    // billing's above, scoped to the delivery role and its own controller.
    $body
      .off(
        "input.twoincShippingCompanyPairing change.twoincShippingCompanyPairing",
        "#shipping_company"
      )
      .on(
        "input.twoincShippingCompanyPairing change.twoincShippingCompanyPairing",
        "#shipping_company",
        function () {
          if (!twoincCompanyCapture.isNameField(this, twoincAddressRoles.delivery())) return;
          twoincCompanyCapture.guardCompanyRetype(twoincAddressRoles.delivery());
        }
      );

    $body.on("change", "#shipping_country", self.onShippingCountryInputChange);

    $body.on("click", "#shipping_company, #shipping_company_id", function () {
      const soleTrader = twoincSelectWooHelperShipping.soleTrader;
      if (!soleTrader.soleTraderAdopted || !jQuery(this).prop("readonly")) return;
      soleTrader.reopenSearch();
    });

    // Click-to-reopen out of an adopted sole trader (TWO-40 §7 correction,
    // live-reported by Doug) — see `reopenSearch()`'s own comment. A plain
    // delegated binding is fine here, unlike `searchCompanyBtnId`'s: these
    // are static inputs present from page load, not a button built and
    // rebuilt on every dropdown open.
    $body.on("click", "#billing_company, #company_id", function () {
      // Only where the click has no other meaning: the readonly lock an
      // adoption applies. Ungated (PR #502) it cleared the capture and
      // destroyed an adopted sole trader on any click into either field.
      if (!twoincSoleTrader.soleTraderAdopted || !jQuery(this).prop("readonly")) return;
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

    // The delivery control's tracker needs the same seed as billing's above
    // (Doug 2026-09-01): unseeded, its first `previous` is null, so
    // `countryDidChange` reads the buyer's FIRST shipping-country change as
    // "no previous country to have moved away from" and swallows it — leaving
    // a shipping company captured under a country the buyer has left.
    twoincSelectWooHelperShipping.countryDidChange(twoincSelectWooHelperShipping.currentCountry());

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
      this.orderIntentCheck.rateLimitRetryTimer !== null ||
      this.orderIntentCheck.pendingCheck;

    clearInterval(this.orderIntentCheck.interval);
    this.orderIntentCheck.interval = null;
    clearInterval(this.orderIntentCheck.renderInterval);
    this.orderIntentCheck.renderInterval = null;
    window.clearTimeout(this.orderIntentCheck.rateLimitRetryTimer);
    this.orderIntentCheck.rateLimitRetryTimer = null;
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
   * Re-arm the check once the backoff window has elapsed.
   *
   * Only `updated_checkout` re-arms otherwise, and a buyer who has finished
   * typing fires no more of them — they would sit on the busy box until they
   * touched the form again, long after the shop would have served them.
   */
  scheduleRateLimitRetry() {
    const state = this.orderIntentCheck;
    window.clearTimeout(state.rateLimitRetryTimer);
    state.rateLimitRetryTimer = null;

    // A few ms past the deadline, so the re-armed check does not race the
    // `Date.now() < rateLimitedUntil` guard it has to clear.
    const wait = state.rateLimitedUntil - Date.now() + 50;
    if (!(wait > 0)) return;
    state.rateLimitRetryTimer = window.setTimeout(function () {
      const check = Twoinc.getInstance().orderIntentCheck;
      check.rateLimitRetryTimer = null;
      // A later refusal may have pushed the deadline out from under this one.
      if (Date.now() < check.rateLimitedUntil) return;
      Twoinc.getInstance().getApproval();
    }, wait);
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

      // Merchant identity is not sent: the proxy resolves it server-side.
      let jsonBody = JSON.stringify({
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

      if (Date.now() < Twoinc.getInstance().orderIntentCheck.rateLimitedUntil) {
        Twoinc.getInstance().supersedeInFlightOrderIntent();
        Twoinc.getInstance().scheduleRateLimitRetry();
        twoincDomHelper.togglePaySubtitleDesc("errored", ".twoinc-busy-retry");
        return;
      }

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
      // built from, rather than the capture pair's fields, which can
      // diverge from it (see `clearCompanyIfCountryStale()`).
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
        url: twoincUtilHelper.proxyUrl("order_intent_url"),
        dataType: "json",
        method: "POST",
        // Bounded, like the company-search transport already is. A request
        // that never settles calls neither handler, and both the loader
        // coming down and the verdict appearing hang off those handlers —
        // so a hung connection would mean "Checking availability" for the
        // rest of the page. A timeout arrives as a `.fail` with status 0,
        // which paints the generic decline and is deliberately not cached.
        timeout: 30000,
        data: { csrf_token: twoincUtilHelper.proxyCsrfToken(), intent: jsonBody }
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

        // The shop's own limiter, not a credit decision — deselecting here
        // would show a false decline to everyone behind one office address.
        if (response && response.status === 429) {
          Twoinc.getInstance().orderIntentCheck.rateLimitedUntil =
            Date.now() + twoincUtilHelper.retryAfterMs(response);
          Twoinc.getInstance().scheduleRateLimitRetry();
          twoincDomHelper.togglePaySubtitleDesc("errored", ".twoinc-busy-retry");
          return;
        }

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

  /**
   * One address role's registry-address state, created on first use.
   *
   *  - `registryApplied`: the role's address fields hold a registry lookup's
   *    result rather than the buyer's own (typed or account-prefilled)
   *    address, so disowning the company may clear them (TWO-25288).
   *  - `lookupSeq`: monotonic supersession counter for that role's address
   *    lookup (TWO-24867) — bumped by every lookup on the role and by every
   *    real change of THAT role's country.
   *
   * @param {string} [role]
   * @returns {{registryApplied: boolean, lookupSeq: number}}
   */
  addressStateFor(role) {
    const key = role || twoincAddressRoles.invoice();
    if (!this.addressState[key]) this.addressState[key] = { registryApplied: false, lookupSeq: 0 };
    return this.addressState[key];
  }

  /**
   * Look the picked company's registry address up and write it onto the
   * address form of the role that picked it.
   *
   * @param {Object} selectedCompany
   * @param {string} [role] address role of the control the pick came from
   */
  addressLookup(selectedCompany, role) {
    const self = this;
    const addressRole = role || twoincAddressRoles.invoice();
    const state = self.addressStateFor(addressRole);
    // Supersession, not cancellation (TWO-24867). Two independent things can
    // make this response wrong by the time it arrives: a newer lookup (the
    // buyer picked a different company) and a country change (the buyer
    // corrected a mis-clicked country). The sequence number catches the
    // first, the country snapshot the second — a country switched away from
    // and back again between request and response leaves the sequence stale
    // but the country matching, and vice versa, so both are needed.
    const seq = (state.lookupSeq += 1);
    const requestCountry = twoincAddressRoles.country(addressRole);
    const addressResponse = jQuery.ajax({
      dataType: "json",
      url: twoincUtilHelper.proxyUrl("company_by_id_url"),
      data: { csrf_token: twoincUtilHelper.proxyCsrfToken(), lookup_id: selectedCompany.lookup_id }
    });
    addressResponse.done(function (response) {
      if (seq !== state.lookupSeq) return;
      // An empty reading on EITHER side means the field was mid-replacement,
      // not that the country moved — discarding a good registry address on it
      // would be a silent failure with no retry and no message. Both sides
      // matter: a lookup issued during a replacement snapshots "", and
      // comparing that against a known country would drop every response.
      // Only two countries that are both known AND different are grounds to
      // drop this.
      const landedCountry = twoincAddressRoles.country(addressRole);
      if (requestCountry && landedCountry && landedCountry !== requestCountry) return;
      // Use new address lookup by default
      if (response.addresses) {
        self.setAddress(response.addresses[0], addressRole);
        // Only here, on the branch that actually writes registry data. A
        // buyer's own address (account-prefilled, or typed by hand) never
        // goes through this path, so this flag distinguishes the two —
        // `#company_id` being non-empty does not: it is also written by
        // account-restore and sole-trader code with no lookup behind it, and
        // is empty for company hits that carry no organisation number even
        // though a lookup DID run for them.
        state.registryApplied = true;
      }
    });
    addressResponse.fail(function (jqXHR) {
      if (seq !== state.lookupSeq) return;
      // Only the shop's own limiter earns the "wait a moment" copy: it is the
      // one failure that retrying does fix. Anything else keeps its silence,
      // where the buyer types the address themselves.
      if (!jqXHR || jqXHR.status !== 429) return;
      twoincDomHelper.togglePaySubtitleDesc("errored", ".twoinc-busy-retry");
      const paintSeq = twoincDomHelper.payBoxPaintSeq;

      // Nothing retries a lookup on the buyer's behalf, and with order intent
      // switched off no getApproval() comes along to repaint the box either.
      window.clearTimeout(self.addressLookupNoticeTimer);
      self.addressLookupNoticeTimer = window.setTimeout(function () {
        self.addressLookupNoticeTimer = null;
        if (seq !== state.lookupSeq) return;
        // Anything that has since painted the pay box owns it now — including
        // a repaint of this same box, on a window of its own that outlives this
        // one. `togglePaySubtitleDesc()` hides every box, so retiring a notice
        // this timer no longer owns would leave the buyer with no explanation.
        if (twoincDomHelper.payBoxPaintSeq !== paintSeq) return;
        twoincDomHelper.togglePaySubtitleDesc();
      }, twoincUtilHelper.retryAfterMs(jqXHR));
    });
  }

  /**
   * Write an address that arrived in an external payload onto ONE role's
   * address form — the role of the control that captured the company it
   * belongs to, never a fixed one (TWO-40 §2.6).
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
   * @param {string} [role] address role to write onto
   * @returns {void}
   */
  setAddress(address, role) {
    const payload = address || {};
    role = role || twoincAddressRoles.invoice();
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
   * @param {string} [role] address role to clear
   * @returns {void}
   */
  clearAddress(role) {
    role = role || twoincAddressRoles.invoice();
    ["address_1", "address_2", "city", "postcode"].forEach(function (name) {
      jQuery(twoincAddressRoles.field(role, name)).val("");
    });
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

    // Merchant identity is not sent: the proxy resolves it server-side.
    let params = {
      csrf_token: twoincUtilHelper.proxyCsrfToken(),
      buyer_organization_number: Twoinc.getInstance().customerCompany.organization_number,
      country_prefix: Twoinc.getInstance().customerCompany.country_prefix
    };

    // Create a get due in days request
    const dueInDaysResponse = jQuery.ajax({
      url: twoincUtilHelper.proxyUrl("payment_terms_url"),
      data: params,
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
      Twoinc.getInstance().addressStateFor(twoincAddressRoles.invoice()).lookupSeq += 1;

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

    // Same reason as billing's `syncCompanySearchTileLocation()` above: this
    // refresh re-renders the shipping fields, so the control's host is a new
    // node and the panel that was bound to the old one is gone with it.
    twoincSelectWooHelperShipping.rebindUnlessManual();
    twoincSelectWooHelperShipping.soleTrader.refresh();

    // Re-resolve on EVERY `updated_checkout`, not only a real country change
    // (Doug 2026-08-31 §2, corner case (d)): this is also what fires when
    // "ship to a different address?" is toggled in either direction, and
    // `syncOrderCompany()`'s own `deliveryIsOrderCompanySource()` check is what
    // drops a shipping-sourced fallback the moment that box is unchecked
    // (the DOM capture itself is left alone, the same way the address mirror
    // leaves shipping field values in place — only which pair the order
    // intent SEES changes).
    twoincCompanyCapture.syncOrderCompany();
    Twoinc.getInstance().getApproval();
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
    //    address over the cleared fields, and mark them as registry-written.
    //
    // Both are supersession counters rather than aborts on purpose: the
    // network request may already have completed, so cancelling it is not
    // enough — the guard has to sit on the handler.
    twoincSelectWooHelper.companySearchSeq += 1;
    self.addressStateFor(twoincAddressRoles.invoice()).lookupSeq += 1;
    // The order-intent request is retired on this path too, but not from
    // here: `clearSelectedCompany()` below resets `customerCompany`
    // wholesale, so `self.getApproval()` at the end of this function finds
    // an incomplete form and retires the in-flight request through its
    // own readiness guard.
    // The panel drops whatever the outgoing country's search left in it.
    twoincSelectWooHelper.closeCompanySearchDropdown();

    // Skipped entirely while sole-trader mode owns the field: this
    // rebuilds the search widget and wipes the capture pair
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
   * Handle the shipping country input change (Doug 2026-08-31 §2) — the
   * delivery-role counterpart of `onCountryInputChange`/`syncBillingCountry`.
   *
   * Never writes `customerCompany` directly: unlike billing, shipping's
   * capture only reaches the order intent through `resolveOrderCompany()`'s
   * fallback, so every effect here is "drop/re-evaluate shipping's own state,
   * then let the resolver decide what (if anything) that changes."
   */
  onShippingCountryInputChange() {
    Twoinc.getInstance().syncShippingCountry();
  }

  syncShippingCountry() {
    const helper = twoincSelectWooHelperShipping;
    const country = helper.currentCountry();
    const changed = helper.countryDidChange(country);

    twoincDomHelper.toggleBusinessFields();
    if (!changed) return;

    // Same invalidation as billing's own (TWO-24867): a search or sole-trader
    // availability answer for the OUTGOING shipping country must not land.
    helper.companySearchSeq += 1;
    Twoinc.getInstance().addressStateFor(twoincAddressRoles.delivery()).lookupSeq += 1;
    helper.closeCompanySearchDropdown();

    if (helper.soleTrader.mode !== "sole_trader") {
      // Recomputes `customerCompany` itself via `write()`'s own resolver call
      // — a shipping capture leaving means the resolver may fall back to
      // nothing, or (if billing already had none) that the order intent now
      // has nothing at all.
      helper.clearSelectedCompany();
    }

    helper.soleTrader.refresh();
    Twoinc.getInstance().getApproval();
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
    // `customerCompany` can now be a SHIPPING fallback (Doug 2026-08-31 §2,
    // `syncOrderCompany()`) — this guard's whole comparison is against
    // billing's own DOM (`#company_id`, the primary-role name field), which
    // says nothing about a shipping-sourced pair. Only act when billing is
    // actually the source; a billing country move with billing uncaptured
    // must not clear a valid shipping fallback out from under the buyer.
    if (!twoincCompanyCapture.hasCapture(twoincAddressRoles.invoice())) return;

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
    const domName = twoincUtilHelper.blankToEmpty(twoincCompanyCapture.nameField().val());
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
    // This rule holds on WooCommerce's own re-render paths because both
    // halves of the capture pair are registered billing fields in the same
    // billing fragment, so every WC-driven re-render writes them from the
    // same vintage. One mirror moving alone is therefore evidence of
    // something other than a re-render.
    //
    // Anything else falls through to the clear, deliberately fail-closed:
    // a diverged number with an empty captured name is not trusted,
    // since taking the name from the record instead would pair company
    // A's name with company B's number and leave `isReadyApprovalCheck()`
    // refusing forever with no deferred re-read to recover it.
    //
    // Read field by field rather than through `getCompanyData()`: in
    // company-search mode that takes the name from `getCompanyName()`,
    // which reads the `checkoutInputs` sessionStorage snapshot rather
    // than the DOM, so the name would come from a different moment than
    // the number and the country. The capture pair's own name field is the
    // mirror a restore writes and the one `clearSelectedCompany` and
    // `enterManualCompanyEntry` already treat as authoritative.
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
  }
});
