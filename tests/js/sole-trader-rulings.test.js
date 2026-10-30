/**
 * What a sole-trader detour may and may not do to the checkout (TWO-26775):
 * the autofill write rules, a popup closed without a signup, a lookup that
 * never answers, and a press on content that takes no focus.
 */

"use strict";

const harness = require("./wc-harness");

const SOLE_TRADER_CONFIG = {
  availability_url: "/?wc-ajax=two_sole_trader_availability",
  tokens_url: "/?wc-ajax=two_sole_trader_tokens",
  csrf_token: "csrf-token",
  text: {
    registered_business: "Registered company",
    sole_trader: "Sole trader",
    signup_panel: "Sign up or log in as a sole trader",
    select_different: "Select a different sole trader",
    error: "Something went wrong"
  }
};

function buildForm() {
  document.body.innerHTML = [
    '<form name="checkout" class="checkout woocommerce-checkout">',
    '  <select id="billing_country" name="billing_country">',
    '    <option value="GB" selected>GB</option>',
    "  </select>",
    '  <input type="email" id="billing_email" value="buyer@example.test" />',
    '  <input type="text" id="billing_phone" value="" />',
    '  <div class="woocommerce-billing-fields__field-wrapper">',
    harness.companyRowsMarkup(),
    "  </div>",
    '  <input type="text" id="billing_address_1" value="" />',
    '  <input type="text" id="billing_address_2" value="" />',
    '  <input type="text" id="billing_city" value="" />',
    '  <input type="text" id="billing_postcode" value="" />',
    '  <input type="text" id="billing_state" value="" />',
    '  <p id="page_text">Some text on the page</p>',
    '  <div class="twoinc-sole-trader-note-slot"></div>',
    "</form>"
  ].join("\n");
}

describe("TWO-26775 sole-trader rulings", () => {
  let ctx;
  let $;
  let soleTrader;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      enable_order_intent: "no",
      enable_address_lookup: "no",
      sole_trader: SOLE_TRADER_CONFIG
    });
    $ = ctx.$;
    soleTrader = ctx.soleTrader;
    window.sessionStorage.clear();
    buildForm();
    soleTrader.availabilityByCountry = { GB: true };
    soleTrader.tokens = {
      delegation_token: "delegation",
      autofill_token: "autofill",
      signup_url: "https://checkout.example.test/soletrader/signup"
    };
    jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) => cb(null));
  });

  afterEach(() => {
    jest.useRealTimers();
    soleTrader.unbindPopupMessageListener();
    soleTrader.unbindFocusinListener();
    soleTrader.stopAllPopupWatchers();
    soleTrader.stopTokenRefresh();
    harness.releasePanel(ctx.helper);
    $(document.body).off();
    document.body.innerHTML = "";
  });

  function fakePopup() {
    const win = { closed: false, focus: jest.fn() };
    win.close = jest.fn(() => {
      win.closed = true;
    });
    return win;
  }

  function openPanel() {
    $("#billing_company_display_field").removeClass("hidden");
    return harness.openCompanyPanel($, ctx.helper);
  }

  function chipNode(mode) {
    return document.querySelector('.two-company-mode-chip[data-two-chip="' + mode + '"]');
  }

  function pickRegistered() {
    ctx.capture.write("Registered Ltd", "12345678");
    ctx.helper.setDisplayName("Registered Ltd");
  }

  function readForm() {
    const read = (id) => $("#" + id).val();
    return {
      name: read("billing_company"),
      id: read("company_id"),
      address_1: read("billing_address_1"),
      address_2: read("billing_address_2"),
      city: read("billing_city"),
      postcode: read("billing_postcode"),
      state: read("billing_state"),
      phone: read("billing_phone")
    };
  }

  /**
   * The autofill write rules: non-blank values overwrite, a blank keeps the
   * buyer's own value and clears only what the plugin wrote, the state is
   * filled only while empty or the plugin's, and a buyer with no number is
   * refused whole.
   */
  describe("an autofill buyer adopted from the chip", () => {
    const FULL = {
      organization_number: "TWO:ST1",
      company_name: "Trader Name",
      email: "buyer@example.test",
      phone_number: "+441234",
      billing_address: {
        street: "1 New Street",
        city: "Newtown",
        postal_code: "NT1 1AA",
        region: "Kent"
      }
    };
    const TYPED = {
      address_1: "Typed Street",
      address_2: "Typed Flat",
      city: "Typed City",
      postcode: "TY1 1PE",
      state: "Typed County",
      phone: "+440000"
    };

    test.each([
      {
        buyer: FULL,
        typed: {},
        expected: {
          name: "Trader Name",
          id: "TWO:ST1",
          address_1: "1 New Street",
          address_2: "",
          city: "Newtown",
          postcode: "NT1 1AA",
          state: "Kent",
          phone: "+441234"
        },
        description: "a full record fills an empty form"
      },
      {
        buyer: FULL,
        typed: TYPED,
        expected: {
          name: "Trader Name",
          id: "TWO:ST1",
          address_1: "1 New Street",
          address_2: "Typed Flat",
          city: "Newtown",
          postcode: "NT1 1AA",
          state: "Typed County",
          phone: "+441234"
        },
        description: "non-blank values overwrite; the buyer's own state and an absent line 2 stay"
      },
      {
        buyer: {
          organization_number: "TWO:ST1",
          company_name: "",
          email: "buyer@example.test",
          billing_address: { street: "", city: "", postal_code: "" }
        },
        typed: TYPED,
        expected: Object.assign({ name: "Registered Ltd", id: "TWO:ST1" }, TYPED),
        description: "blanks keep the buyer's values and a blank name keeps the current name"
      },
      {
        buyer: { company_name: "No Number", email: "buyer@example.test", phone_number: "+441234" },
        typed: TYPED,
        expected: Object.assign({ name: "Registered Ltd", id: "12345678" }, TYPED),
        description: "a buyer with no number is refused whole"
      }
    ])("$description", ({ buyer, typed, expected, description }) => {
      pickRegistered();
      Object.keys(typed).forEach((key) => {
        $("#" + (key === "phone" ? "billing_phone" : "billing_" + key)).val(typed[key]);
      });
      soleTrader.holdAutofill(buyer);
      window.open = jest.fn(() => null);

      soleTrader.onModeChipClick("sole_trader");

      expect(Object.assign({ description }, readForm())).toEqual(
        Object.assign({ description }, expected)
      );
    });

    test("a blank clears a value the plugin wrote, and only while it is still the plugin's", () => {
      pickRegistered();
      ctx.Twoinc.getInstance().setAddress({ street: "Registry Road", city: "Registry City" });
      $("#billing_city").val("Buyer Edited City");

      soleTrader.holdAutofill({
        organization_number: "TWO:ST1",
        company_name: "Trader Name",
        email: "buyer@example.test",
        billing_address: { street: "", city: "" }
      });
      soleTrader.onModeChipClick("sole_trader");

      expect($("#billing_address_1").val()).toBe("");
      expect($("#billing_city").val()).toBe("Buyer Edited City");
    });
  });

  /** A popup closed with no signup clears nothing, and the mode goes back to what the stored capture says. */
  describe("a signup popup closed by hand", () => {
    function launchAndClose(arrange) {
      openPanel();
      if (arrange) arrange();
      const win = fakePopup();
      window.open = jest.fn(() => win);
      jest.useFakeTimers();
      soleTrader.bindFocusinListener();
      chipNode("soletrader").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      expect(soleTrader.mode).toBe("sole_trader");
      jest.advanceTimersByTime(1);
      win.closed = true;
      jest.advanceTimersByTime(300);
    }

    test.each([
      {
        arrange: () => {
          pickRegistered();
          ctx.Twoinc.getInstance().setAddress({ street: "Registry Road", city: "Registry City" });
        },
        captureMode: "search",
        selected: "registered",
        form: { name: "Registered Ltd", id: "12345678", address_1: "Registry Road" },
        description: "after a registered pick: everything kept, back to Registered"
      },
      {
        arrange: () => {
          ctx.helper.enterManualCompanyEntry();
          $("#billing_company").val("Typed By Hand");
          ctx.helper.openCompanySearchDropdown();
        },
        captureMode: "manual",
        selected: "manual",
        form: { name: "Typed By Hand", id: "", address_1: "" },
        description: "after manual entry: the name kept, back to manual entry"
      }
    ])("$description", ({ arrange, captureMode, selected, form, description }) => {
      launchAndClose(arrange);

      const after = readForm();
      expect({
        description,
        mode: soleTrader.mode,
        captureMode: ctx.capture.modeFor(),
        selected: ctx.helper.selectedMode(),
        form: { name: after.name, id: after.id, address_1: after.address_1 }
      }).toEqual({ description, mode: "business", captureMode, selected, form });
    });

    test("the popover closes and focus lands on the company field without reopening it", () => {
      launchAndClose(pickRegistered);

      expect(ctx.helper.companySearchDropdownIsOpen()).toBe(false);
      expect(document.activeElement).toBe(ctx.helper.panel.getField()[0]);
    });
  });

  /** A buyer lookup that never answers counts as failed, so nothing waits on it forever. */
  test("a completed signup whose lookup never answers is given up on, leaving no Sole trader mode", async () => {
    soleTrader.fetchCurrentBuyer.mockRestore();
    jest.useFakeTimers();
    global.fetch = jest.fn(() => new Promise(() => {}));
    pickRegistered();
    soleTrader.setMode("sole_trader");
    soleTrader.bindPopupMessageListener();

    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: "ACCEPTED",
        origin: "https://checkout.example.test"
      })
    );
    expect(soleTrader.isBusy()).toBe(true);
    jest.advanceTimersByTime(soleTrader.BUYER_LOOKUP_TIMEOUT_MS);
    delete global.fetch;

    expect(soleTrader.isBusy()).toBe(false);
    expect(soleTrader.signupConfirming).toBe(false);
    expect(soleTrader.mode).toBe("business");
    expect($("#company_id").val()).toBe("12345678");
  });

  /** A press on content that takes no focus closes the popup; the popover only when the press was outside it. */
  test.each([
    {
      target: () => document.getElementById("page_text"),
      popover: false,
      description: "page text"
    },
    {
      target: () => document.querySelector(".two-company-dropdown"),
      popover: true,
      description: "the popover's own padding"
    }
  ])("a press on $description closes the popup", ({ target, popover }) => {
    openPanel();
    const win = fakePopup();
    window.open = jest.fn(() => win);
    jest.useFakeTimers();
    soleTrader.bindFocusinListener();
    chipNode("soletrader").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    jest.advanceTimersByTime(1);

    target().dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    jest.advanceTimersByTime(300);

    expect(win.close).toHaveBeenCalled();
    expect(ctx.helper.companySearchDropdownIsOpen()).toBe(popover);
  });

  test("a press on a control leaves the popup to the focus rules", () => {
    openPanel();
    const win = fakePopup();
    window.open = jest.fn(() => win);
    soleTrader.bindFocusinListener();
    chipNode("soletrader").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    document
      .getElementById("billing_city")
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(win.close).not.toHaveBeenCalled();
  });
});
