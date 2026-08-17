/**
 * TWO-40. An organisation number belongs to the company name it was captured
 * under, and stops being a fact about anything the moment that name changes.
 *
 * Before this, editing the company name wrote the new name over the record and
 * left the previous company's number sitting in `#company_id` beside it. The
 * order posted that pair. Nothing in the plugin noticed, because the number was
 * never wrong on its own — only wrong next to that name.
 *
 * The witness is `customerCompany.pairedName`, written by
 * `writeCapturedCompany` on the same tick as the number, and read by
 * `clearCompanyIfNameStale` on the name-edit events. Two properties are
 * load-bearing and are tested as properties rather than as lines:
 *
 *   - a capture that does not set the tag is indistinguishable from a stale
 *     pair, so every capture route has to go through the one writer; and
 *   - an ABSENT tag counts as a mismatch, because several deferred re-syncs
 *     flatten the record back from the DOM without it, and "cannot vouch for
 *     this pair" has to fail closed.
 */

"use strict";

const harness = require("./wc-harness");

describe("company name/number pairing tag", () => {
  let ctx;
  let $;
  let ajax;

  beforeEach(() => {
    jest.useFakeTimers();
    ctx = harness.loadTwoinc({ supported_buyer_countries: ["GB", "ES"] });
    harness.buildCheckoutForm({ country: "GB" });
    $ = ctx.$;
    $("#billing_country").append('<option value="ES">Spain</option>');
    $("form[name='checkout']").after('<div id="order_review"></div>');
    $("form[name='checkout']").append(
      "<input type='radio' id='payment_method_woocommerce-gateway-tillit'" +
        " name='payment_method' value='woocommerce-gateway-tillit' />"
    );
    ajax = harness.stubAjax($);
  });

  afterEach(() => {
    ajax.restore();
    harness.releaseWidgets($);
    // Same reason as the country-switch suite: initialize() binds delegated
    // handlers on document.body, which outlives the test.
    $(document.body).off();
    document.body.innerHTML = "";
    window.sessionStorage.clear();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /** The record, for brevity. */
  function record() {
    return ctx.Twoinc.getInstance().customerCompany;
  }

  describe("writeCapturedCompany — the one writer", () => {
    test("pins both mirrors, the record and both witnesses in one call", () => {
      const instance = ctx.Twoinc.getInstance();

      ctx.helper.writeCapturedCompany(instance, "12345678", "Example Ltd", "GB");

      expect($("#company_id").val()).toBe("12345678");
      expect($("#billing_company").val()).toBe("Example Ltd");
      expect(record().organization_number).toBe("12345678");
      expect(record().company_name).toBe("Example Ltd");
      expect(record().country_prefix).toBe("GB");
      expect(record().pairedName).toBe("Example Ltd");
    });

    test("defaults the country witness to the current reading", () => {
      ctx.helper.writeCapturedCompany(ctx.Twoinc.getInstance(), "12345678", "Example Ltd");

      expect(record().country_prefix).toBe("GB");
    });

    test("a clear nulls the tag rather than leaving it to vouch for the next name", () => {
      const instance = ctx.Twoinc.getInstance();
      ctx.helper.writeCapturedCompany(instance, "12345678", "Example Ltd", "GB");

      ctx.helper.writeCapturedCompany(instance, "", "");

      expect(record().organization_number).toBe("");
      expect(record().pairedName).toBeNull();
    });

    test("normalises the tag, so padding cannot make a matching name look different", () => {
      ctx.helper.writeCapturedCompany(
        ctx.Twoinc.getInstance(),
        "12345678",
        "  Example Ltd  ",
        "GB"
      );

      expect(record().pairedName).toBe("Example Ltd");
    });
  });

  describe("clearCompanyIfNameStale", () => {
    // captured name | tag written? | name now | number survives | description
    const cases = [
      ["Example Ltd", true, "Example Ltd", true, "name unchanged"],
      ["Example Ltd", true, "  Example Ltd  ", true, "name differs by padding only"],
      ["Example Ltd", true, "Other Ltd", false, "name retyped"],
      ["Example Ltd", true, "", false, "name cleared"],
      ["Example Ltd", false, "Example Ltd", false, "tag absent, same name"],
      ["Example Ltd", false, "Other Ltd", false, "tag absent, name retyped"]
    ];

    test.each(cases)(
      "captured %s / tagged %s / now %s -> number survives %s (%s)",
      (capturedName, tagged, nameNow, survives) => {
        const instance = ctx.Twoinc.getInstance();
        ctx.helper.writeCapturedCompany(instance, "12345678", capturedName, "GB");
        if (!tagged) {
          // What every deferred "re-sync the record from the DOM" path leaves
          // behind: a number with no witness beside it.
          delete instance.customerCompany.pairedName;
        }

        instance.clearCompanyIfNameStale(nameNow);

        if (survives) {
          expect(record().organization_number).toBe("12345678");
          expect($("#company_id").val()).toBe("12345678");
        } else {
          expect(record().organization_number).toBeNull();
          expect($("#company_id").val()).toBe("");
          // The country witness goes with the number it described.
          expect(record().country_prefix).toBeNull();
          expect(record().pairedName).toBeNull();
        }
      }
    );

    test("leaves the name the buyer just typed exactly as typed", () => {
      const instance = ctx.Twoinc.getInstance();
      ctx.helper.writeCapturedCompany(instance, "12345678", "Example Ltd", "GB");
      $("#billing_company").val("Other Ltd");

      instance.clearCompanyIfNameStale("Other Ltd");

      expect($("#billing_company").val()).toBe("Other Ltd");
    });

    test("does nothing when there is no number to strand", () => {
      const instance = ctx.Twoinc.getInstance();
      ctx.helper.writeCapturedCompany(instance, "", "");

      instance.clearCompanyIfNameStale("Anything At All");

      expect(record().organization_number).toBe("");
    });
  });

  describe("the real name-edit events", () => {
    /**
     * Run the page wiring, so the delegated `change` binding this suite
     * depends on is the one production installs rather than a hand call.
     *
     * @returns {void}
     */
    function initializeCheckout() {
      ctx.Twoinc.getInstance().initialize(false);
    }

    test("retyping the company name drops the previous company's number", () => {
      // Manual entry: with search off, getCompanyName() reads #billing_company
      // directly, which is the path a buyer retyping the field reaches.
      window.twoinc.enable_company_search = "no";
      initializeCheckout();
      ctx.helper.writeCapturedCompany(ctx.Twoinc.getInstance(), "12345678", "Example Ltd", "GB");

      $("#billing_company").val("Other Ltd").trigger("change");

      expect($("#company_id").val()).toBe("");
      expect(record().organization_number).toBeNull();
      expect(record().company_name).toBe("Other Ltd");
    });

    test("a change event that leaves the name alone keeps the number", () => {
      window.twoinc.enable_company_search = "no";
      initializeCheckout();
      ctx.helper.writeCapturedCompany(ctx.Twoinc.getInstance(), "12345678", "Example Ltd", "GB");

      $("#billing_company").trigger("change");

      expect($("#company_id").val()).toBe("12345678");
      expect(record().organization_number).toBe("12345678");
    });

    test("blurring the display select after a retype drops the number too", () => {
      initializeCheckout();
      ctx.helper.writeCapturedCompany(ctx.Twoinc.getInstance(), "12345678", "Example Ltd", "GB");

      $("#billing_company_display")
        .append('<option value="Other Ltd">Other Ltd</option>')
        .val("Other Ltd")
        .trigger("blur");

      expect($("#company_id").val()).toBe("");
      expect(record().organization_number).toBeNull();
    });

    test("a hand-typed number is paired with the name standing beside it", () => {
      initializeCheckout();
      $("#billing_company").val("Example Ltd");
      record().company_name = "Example Ltd";

      $("#company_id").val("87654321").trigger("blur");

      expect(record().organization_number).toBe("87654321");
      expect(record().pairedName).toBe("Example Ltd");
      // And the pair it just formed survives a no-op change on the name.
      ctx.Twoinc.getInstance().clearCompanyIfNameStale("Example Ltd");
      expect(record().organization_number).toBe("87654321");
    });
  });

  describe("a capture through the registry picker", () => {
    test("sets the tag, so the very next keystroke does not wipe the pick", () => {
      const instance = ctx.Twoinc.getInstance();
      instance.enableCompanySearch();
      const $field = $("#billing_company_display");

      // The shape select2 hands its select handler for a picked result.
      $field.trigger({
        type: "select2:select",
        params: { data: { id: "Picked Ltd", company_id: "11223344" } }
      });

      expect(record().organization_number).toBe("11223344");
      expect(record().pairedName).toBe("Picked Ltd");

      instance.clearCompanyIfNameStale("Picked Ltd");
      expect(record().organization_number).toBe("11223344");
    });
  });

  describe("the country guard's re-sync branch", () => {
    test("adopts the name it just decided to trust", () => {
      const instance = ctx.Twoinc.getInstance();
      // A record holding one company while the fields hold a different,
      // self-consistent one — what a saved-address re-render produces.
      instance.customerCompany = {
        company_name: "Old Ltd",
        country_prefix: "GB",
        organization_number: "12345678"
      };
      $("#billing_company").val("Restored Ltd");
      $("#company_id").val("99887766");

      instance.clearCompanyIfCountryStale("ES");

      expect(record().organization_number).toBe("99887766");
      expect(record().pairedName).toBe("Restored Ltd");
      // Which is the point: the restore is not undone by the next name event.
      instance.clearCompanyIfNameStale("Restored Ltd");
      expect(record().organization_number).toBe("99887766");
    });
  });
});
