/**
 * TWO-40 §5. The company write-back state machine: one write path, a pairing
 * tag, a provenance marker, and the retype guard that drops a stale
 * organisation number.
 *
 * This was the most repeated bug source on the platform this ports from, and
 * always the same shape: some new code path set the organisation number
 * directly, the pair it left behind no longer matched the tag, and the capture
 * evaporated on the buyer's next keystroke. The tests below pin all three
 * pieces AND that consequence, so the failure mode is discoverable from the
 * suite rather than from a live checkout.
 */

"use strict";

const harness = require("./wc-harness");

/**
 * The company and address inputs the capture helper and `setAddress` touch.
 *
 * @returns {void}
 */
function buildForm() {
  document.body.innerHTML = [
    '<form name="checkout" class="checkout woocommerce-checkout">',
    '  <select id="billing_country" name="billing_country">',
    '    <option value="GB" selected>GB</option><option value="NO">NO</option>',
    "  </select>",
    '  <p id="billing_company_display_field">',
    '    <select id="billing_company_display" name="billing_company_display">',
    '      <option value="">&nbsp;</option>',
    "    </select>",
    "  </p>",
    '  <p id="billing_company_field">',
    '    <span class="woocommerce-input-wrapper">',
    '      <input type="text" id="billing_company" name="billing_company" value="" />',
    "    </span>",
    "  </p>",
    '  <p id="company_id_field">',
    '    <input type="text" id="company_id" name="company_id" value="" />',
    "  </p>",
    '  <input type="text" id="billing_address_1" name="billing_address_1" value="" />',
    '  <input type="text" id="billing_address_2" name="billing_address_2" value="" />',
    '  <input type="text" id="billing_city" name="billing_city" value="" />',
    '  <input type="text" id="billing_postcode" name="billing_postcode" value="" />',
    '  <input type="hidden" id="billing_state" name="billing_state" />',
    "</form>",
    // initialize() bails without this — it is WooCommerce's own order-review
    // container, and its absence is how the plugin tells "not the checkout
    // page" from "checkout page".
    '<div id="order_review"></div>'
  ].join("\n");
}

describe("TWO-40 §5 — captured-company write path", () => {
  let ctx;
  let $;
  let capture;

  beforeEach(() => {
    ctx = loadForCapture();
    $ = ctx.$;
    capture = ctx.capture;
    buildForm();
  });

  afterEach(() => {
    harness.releaseWidgets(ctx.$);
    document.body.innerHTML = "";
  });

  function loadForCapture(overrides) {
    return harness.loadTwoinc(
      Object.assign(
        {
          supported_buyer_countries: ["GB", "NO"],
          enable_address_lookup: "no",
          enable_order_intent: "no"
        },
        overrides || {}
      )
    );
  }

  /** @returns {string|undefined} the pairing tag currently on the name field */
  function tag() {
    return $("#billing_company").attr(capture.PAIRING_ATTR);
  }

  /**
   * Type into the company-name field and run the guard, as the delegated
   * `input` binding does on a live checkout.
   *
   * Called directly here so each assertion exercises the guard itself; that
   * the binding EXISTS has its own test, driven through a real event.
   *
   * @param {string} [name] new value, when the buyer moved the field
   * @returns {boolean} whether a stale capture was dropped
   */
  function retype(name) {
    if (name !== undefined) $("#billing_company").val(name);
    return capture.guardCompanyRetype();
  }

  describe("write()", () => {
    test("sets both posted fields, the pairing tag and provenance in one call", () => {
      capture.write("ACME Widgets Ltd", "12345678");

      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
      expect($("#company_id").val()).toBe("12345678");
      expect(tag()).toBe(capture.pairingTag("ACME Widgets Ltd", "12345678"));
      expect(capture.isPluginWritten($("#billing_company"))).toBe(true);
      expect(capture.isPluginWritten($("#company_id"))).toBe(true);
    });

    test("pins the capture country next to the number", () => {
      $("#billing_country").val("NO");
      capture.write("ACME Widgets Ltd", "12345678");
      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("NO");
    });

    test("an explicit country wins over the field, so a pair cannot be assembled from two moments", () => {
      $("#billing_country").val("NO");
      capture.write("ACME Widgets Ltd", "12345678", { country: "GB" });
      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("GB");
    });

    test("a name with no number is not a pair and carries no tag", () => {
      // Manual entry captures exactly this, deliberately.
      capture.write("Buyer's Own Ltd", "");

      expect($("#billing_company").val()).toBe("Buyer's Own Ltd");
      expect($("#company_id").val()).toBe("");
      expect(tag()).toBeUndefined();
      expect(capture.isPluginWritten($("#billing_company"))).toBe(false);
    });

    test("the record keeps the RAW value while the DOM gets the normalised one", () => {
      // The record goes into `buyer.company` on the order intent verbatim, so
      // normalising it here would change what the plugin posts.
      capture.write("ACME Widgets Ltd", 12345678);
      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBe(12345678);
      expect($("#company_id").val()).toBe("12345678");
    });

    test("an unchanged value is not re-assigned, so the caret is left alone", () => {
      capture.write("ACME Widgets Ltd", "12345678");
      const input = document.getElementById("billing_company");
      input.setSelectionRange(2, 2);

      capture.write("ACME Widgets Ltd", "12345678");

      expect(input.selectionStart).toBe(2);
    });

    test("a TWO:-prefixed identifier takes the same path as any other number", () => {
      // §3: exactly one special case for these, and it is display only. No
      // branch in storage, pairing or validation.
      capture.write("Sole Trader Co", "TWO:ST12345");

      expect($("#company_id").val()).toBe("TWO:ST12345");
      expect(tag()).toBe(capture.pairingTag("Sole Trader Co", "TWO:ST12345"));
      expect(capture.isPluginWritten($("#company_id"))).toBe(true);
    });
  });

  describe("guardCompanyRetype()", () => {
    test("a retyped company name takes its organisation number with it", () => {
      capture.write("ACME Widgets Ltd", "12345678");

      expect(retype("Some Other Ltd")).toBe(true);

      expect($("#company_id").val()).toBe("");
      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBeFalsy();
      expect(tag()).toBeUndefined();
    });

    test("the guard is bound, not merely defined", () => {
      // Driven through a real event on a real initialize()-bound checkout,
      // because a direct call would pass even if nothing were wired to it.
      ctx.Twoinc.getInstance().initialize(false);
      capture.write("ACME Widgets Ltd", "12345678");

      $("#billing_company").val("Some Other Ltd").trigger("input");

      expect($("#company_id").val()).toBe("");
    });

    test("an untouched name leaves the capture alone", () => {
      capture.write("ACME Widgets Ltd", "12345678");

      // A `change` that moved nothing — tabbing through the field.
      expect(retype()).toBe(false);

      expect($("#company_id").val()).toBe("12345678");
      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBe("12345678");
    });

    test("typing with no number captured is a no-op, not a wipe", () => {
      // Manual entry: every keystroke reaches this guard, and there is nothing
      // stale to drop.
      expect(retype("Buyer's Own Ltd")).toBe(false);
      expect($("#billing_company").val()).toBe("Buyer's Own Ltd");
    });

    test("provenance is dropped the moment the buyer types, even when nothing is wiped", () => {
      capture.write("Buyer's Own Ltd", "");
      $("#billing_company").attr(capture.PROVENANCE_ATTR, "1");

      retype();

      expect(capture.isPluginWritten($("#billing_company"))).toBe(false);
    });

    test("an organisation number written WITHOUT the helper is wiped on the next keystroke", () => {
      // This is the documented consequence of bypassing the single write path,
      // pinned so the failure mode is discoverable here rather than live: the
      // pair carries no tag describing it, so the guard reads it as stale.
      capture.write("ACME Widgets Ltd", "12345678");
      $("#company_id").val("87654321"); // raw write, no tag update

      expect(retype()).toBe(true);

      expect($("#company_id").val()).toBe("");
    });

    test("a restored user-meta capture survives the buyer's first keystroke elsewhere", () => {
      // The regression the helper exists to prevent: user-meta restore used to
      // write both fields raw, leaving an untagged pair the guard then wiped.
      ctx.twoinc.billing_company = "ACME Widgets Ltd";
      ctx.twoinc.company_id = "12345678";
      ctx.dom.loadUserMetaInputs();

      expect(retype()).toBe(false);

      expect($("#company_id").val()).toBe("12345678");
    });

    test("the number field's own visibility is re-decided after a wipe", () => {
      // `#company_id_field` is shown or hidden on the strength of the value it
      // holds (TWO-25326 §12), and this is the function that changes it.
      capture.write("Sole Trader Co", "TWO:ST12345");
      const toggled = jest.spyOn(ctx.dom, "toggleBusinessFields");

      retype("Some Other Ltd");

      expect($("#company_id").val()).toBe("");
      // Re-decided against the now-empty value rather than left as the minted
      // identifier had set it. The decision itself is covered by
      // company-number-display.test.js; what matters here is that the wipe
      // re-runs it at all.
      expect(toggled).toHaveBeenCalled();
      toggled.mockRestore();
    });
  });

  describe("the picker's own select handler", () => {
    test("goes through the single write path", () => {
      const ajax = harness.stubAjax($);
      ctx.Twoinc.getInstance().enableCompanySearch();
      $("#billing_company_display").append(
        '<option value="ACME Widgets Ltd" selected>ACME Widgets Ltd</option>'
      );
      $("#billing_company_display").trigger({
        type: "select2:select",
        params: { data: { id: "ACME Widgets Ltd", company_id: "12345678" } }
      });
      ajax.restore();

      expect($("#company_id").val()).toBe("12345678");
      expect(tag()).toBe(capture.pairingTag("ACME Widgets Ltd", "12345678"));
      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("GB");
    });
  });

  describe("sole-trader adoption", () => {
    test("writes the buyer's address even though address lookup is switched OFF", () => {
      // §5: the write-back must NOT be gated on the switch that gates an
      // ordinary search pick's address write. That switch is legitimately off
      // in configurations that have nothing to do with sole-trader signup.
      expect(ctx.twoinc.enable_address_lookup).toBe("no");

      ctx.soleTrader.setCompany("TWO:ST12345", "Sole Trader Co", {
        organization_number: "TWO:ST12345",
        company_name: "Sole Trader Co",
        billing_address: {
          street: "Registry Street 1",
          city: "Registryville",
          postal_code: "AB1 2CD"
        }
      });

      expect($("#billing_address_1").val()).toBe("Registry Street 1");
      expect($("#billing_city").val()).toBe("Registryville");
      expect($("#billing_postcode").val()).toBe("AB1 2CD");
      expect(ctx.Twoinc.getInstance().registryAddressApplied).toBe(true);
    });

    test("uses the same field-routing table as a registry pick", () => {
      // Sole trader is deliberately NOT special-cased in the routing.
      ctx.soleTrader.setCompany("TWO:ST12345", "Sole Trader Co", {
        billing_address: {
          apartment: "Flat 2",
          street: "Registry Street 1",
          city: "Ashford",
          region: "Kent"
        }
      });

      expect($("#billing_address_1").val()).toBe("Flat 2");
      expect($("#billing_address_2").val()).toBe("Registry Street 1");
      expect($("#billing_city").val()).toBe("Ashford, Kent");
    });

    test("a buyer with no address on file leaves the address fields alone", () => {
      $("#billing_address_1").val("Buyer's own street 3");

      ctx.soleTrader.setCompany("TWO:ST12345", "Sole Trader Co", {
        organization_number: "TWO:ST12345"
      });

      expect($("#billing_address_1").val()).toBe("Buyer's own street 3");
      expect($("#company_id").val()).toBe("TWO:ST12345");
    });

    test("a plugin-written name is dropped by a country change, a typed one is not", () => {
      // The provenance marker's production consumer (TWO-40 §5).
      // `clearSelectedCompany` used to gate this on the capture-mode flag,
      // which got the sole-trader case wrong: that name is plugin-written but
      // reaches the clear with the flag reading "no", so it survived a country
      // change that had already taken its organisation number.
      capture.write("Sole Trader Co", "TWO:ST12345");
      ctx.helper.clearSelectedCompany();
      expect($("#billing_company").val()).toBe("");
      expect($("#company_id").val()).toBe("");

      // A name the buyer typed themselves is theirs to keep.
      $("#billing_company").val("Buyer's Own Ltd");
      ctx.helper.clearSelectedCompany();
      expect($("#billing_company").val()).toBe("Buyer's Own Ltd");
    });

    test("the clearing call drops the capture and its tag", () => {
      capture.write("Sole Trader Co", "TWO:ST12345");

      ctx.soleTrader.setCompany("", "");

      expect($("#company_id").val()).toBe("");
      expect($("#billing_company").val()).toBe("");
      expect(tag()).toBeUndefined();
    });
  });
});
