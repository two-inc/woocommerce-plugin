/**
 * TWO-40 §7 + §8. The sole-trader flow's UX affordances and its identity-trust
 * boundary.
 *
 *   §7 — an in-flight state wired to the REAL duration of the round trip (a
 *   count, not a boolean, not a timeout), a re-entrancy guard so one gesture
 *   cannot stack two signup popups, a "select a different sole trader" link in
 *   the same slot as the existing "search for company" one, and a popup that
 *   is wide enough for the hosted flow's own layout.
 *
 *   §8 — the passive, pre-authentication email match is correct only before
 *   the server has said who the buyer is. Reusing it on the post-OTP callback
 *   is a confirmed bug: the buyer completes signup, the stale check disagrees
 *   with the server, and the same popup reopens forever.
 */

"use strict";

const harness = require("./wc-harness");

/** The checkout subset the sole-trader module reads and writes. */
function buildForm() {
  document.body.innerHTML = [
    '<form name="checkout" class="checkout woocommerce-checkout">',
    '  <select id="billing_country" name="billing_country">',
    '    <option value="GB" selected>GB</option>',
    "  </select>",
    '  <input type="email" id="billing_email" name="billing_email" value="" />',
    '  <input type="text" id="billing_first_name" value="" />',
    '  <input type="text" id="billing_last_name" value="" />',
    '  <input type="text" id="billing_phone" value="" />',
    '  <p id="billing_company_display_field">',
    '    <select id="billing_company_display" name="billing_company_display">',
    '      <option value="">&nbsp;</option>',
    "    </select>",
    "  </p>",
    '  <p id="billing_company_field">',
    '    <label for="billing_company">Company</label>',
    '    <span class="woocommerce-input-wrapper">',
    '      <input type="text" id="billing_company" name="billing_company" value="" />',
    "    </span>",
    "  </p>",
    '  <p id="company_id_field">',
    '    <input type="text" id="company_id" name="company_id" value="" />',
    "  </p>",
    '  <input type="text" id="billing_address_1" value="" />',
    '  <input type="text" id="billing_address_2" value="" />',
    '  <input type="text" id="billing_city" value="" />',
    '  <input type="text" id="billing_postcode" value="" />',
    '  <input type="hidden" id="billing_state" />',
    '  <div class="twoinc-sole-trader-note-slot"></div>',
    "</form>"
  ].join("\n");
}

const SOLE_TRADER_CONFIG = {
  availability_url: "/?wc-ajax=two_sole_trader_availability",
  tokens_url: "/?wc-ajax=two_sole_trader_tokens",
  nonce: "nonce",
  text: {
    registered_business: "Registered company",
    sole_trader: "Sole trader",
    popup_prompt: "Click here to login or sign up as a sole trader.",
    select_different: "Select a different sole trader",
    error: "Something went wrong"
  }
};

describe("TWO-40 §7/§8 — sole-trader flow", () => {
  let ctx;
  let $;
  let soleTrader;
  let opened;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      supported_buyer_countries: ["GB"],
      enable_order_intent: "no",
      enable_address_lookup: "no",
      sole_trader: SOLE_TRADER_CONFIG
    });
    $ = ctx.$;
    soleTrader = ctx.soleTrader;
    buildForm();
    soleTrader.availabilityByCountry = { GB: true };
    soleTrader.tokens = {
      delegation_token: "delegation",
      autofill_token: "autofill",
      signup_url: "https://checkout.example.test/soletrader/signup"
    };
    opened = [];
    window.open = jest.fn((url, target, features) => {
      opened.push({ url: url, target: target, features: features });
      return { closed: false };
    });
  });

  afterEach(() => {
    // A `window` listener outlives `document.body.innerHTML = ""` and the
    // module instance that registered it, so an abandoned one keeps answering
    // postMessages for the rest of the file — against a stale module whose
    // spies this test never installed.
    soleTrader.unbindPopupMessageListener();
    // Same shape, for `watchPopupClose`'s real `setInterval` polls: a test
    // that opens a popup and never closes it otherwise leaves that poll
    // running for the rest of the file.
    soleTrader.stopAllPopupWatchers();
    harness.releaseWidgets($);
    document.body.innerHTML = "";
  });

  describe("§7 — in-flight state", () => {
    test("goes up on the first flight and stays up until the last settles", () => {
      // A COUNT, not a boolean: a buyer changing email mid-prefetch starts a
      // second flight before the first has landed.
      soleTrader.beginFlight();
      expect($(".twoinc-sole-trader-note-slot").hasClass("twoinc-sole-trader-toggle--busy")).toBe(
        true
      );

      soleTrader.beginFlight();
      soleTrader.settleFlight();
      expect($(".twoinc-sole-trader-note-slot").hasClass("twoinc-sole-trader-toggle--busy")).toBe(
        true
      );

      soleTrader.settleFlight();
      expect($(".twoinc-sole-trader-note-slot").hasClass("twoinc-sole-trader-toggle--busy")).toBe(
        false
      );
    });

    test("an unbalanced settle cannot drive the count negative", () => {
      // Otherwise the NEXT genuine flight would begin at zero-plus-one of a
      // negative number and never show at all.
      soleTrader.settleFlight();
      soleTrader.settleFlight();
      expect(soleTrader.flightDepth).toBe(0);

      soleTrader.beginFlight();
      expect($(".twoinc-sole-trader-note-slot").hasClass("twoinc-sole-trader-toggle--busy")).toBe(
        true
      );
    });

    test("shows the spinner inside the company-search field, not as an overlay", () => {
      const $widget = harness.openCompanyWidget($, ctx.helper);

      soleTrader.beginFlight();
      expect($(".twoinc-search-spinner").length).toBe(1);
      // And the control is left OPEN under it.
      expect($widget.data("select2").isOpen()).toBe(true);

      soleTrader.settleFlight();
      expect($(".twoinc-search-spinner").length).toBe(0);
    });

    test("does not take down a spinner a company search is still holding", () => {
      // Two independent owners want the same in-field spinner. Before the
      // ownership split, whichever settled FIRST hid it under the other: a
      // buyer who blurs the email field and then opens the company search
      // inside the prefetch's window watched the search spinner vanish while
      // results were still loading.
      harness.openCompanyWidget($, ctx.helper);
      ctx.helper.holdCompanySearchSpinner("search");
      soleTrader.beginFlight();

      soleTrader.settleFlight();
      expect($(".twoinc-search-spinner").length).toBe(1);

      ctx.helper.releaseCompanySearchSpinner("search");
      expect($(".twoinc-search-spinner").length).toBe(0);
    });

    test("a country change drops every hold at once", () => {
      // Everything either owner was waiting on belongs to a country the
      // checkout has left.
      harness.openCompanyWidget($, ctx.helper);
      ctx.helper.holdCompanySearchSpinner("search");
      soleTrader.beginFlight();

      ctx.helper.resetCompanySearchSpinner();

      expect($(".twoinc-search-spinner").length).toBe(0);
      expect(ctx.helper.spinnerOwners).toEqual({ search: false, soleTrader: false });
    });

    test.each([
      ["the token mint fails", false],
      ["the buyer lookup resolves", true]
    ])("settles when %s", (_description, tokensOk) => {
      // Every terminal branch of the call graph settles its own flight — the
      // upstream review of this feature found stuck-forever spinners on two
      // separate abandon paths, so this is asserted per branch rather than
      // once for the happy path.
      $("#billing_email").val("buyer@example.test");
      jest.spyOn(soleTrader, "fetchTokens").mockImplementation((cb) => cb(tokensOk));
      jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) => cb(null));

      soleTrader.onEmailChanged();

      expect(soleTrader.flightDepth).toBe(0);
      expect($(".twoinc-sole-trader-note-slot").hasClass("twoinc-sole-trader-toggle--busy")).toBe(
        false
      );
    });
  });

  describe("§7 — signup popup", () => {
    test("opens 700x805 — narrower clips the hosted flow's own layout", () => {
      soleTrader.launchSignup();

      expect(opened).toHaveLength(1);
      expect(opened[0].features).toContain("width=700");
      expect(opened[0].features).toContain("height=805");
    });

    test("stays a real window.open, synchronous with the activation", () => {
      // The signup/OTP flow depends on a third party that only works in a real
      // popup; an iframe-in-overlay rewrite was evaluated and rejected. A
      // synchronous open is also what keeps it out of the popup blocker.
      soleTrader.launchSignup();

      expect(window.open).toHaveBeenCalledTimes(1);
      expect(opened[0].target).toBe("_blank");
      expect(document.querySelector("iframe")).toBeNull();
    });

    test("a second activation in the same gesture does not stack a second popup", () => {
      // The re-entrancy guard. Modelled by re-entering from inside the open
      // itself, which is what a double activation amounts to.
      window.open = jest.fn(() => {
        soleTrader.launchSignup();
        return { closed: false };
      });

      soleTrader.launchSignup();

      expect(window.open).toHaveBeenCalledTimes(1);
    });

    test("the guard is released even when the browser blocks the window", () => {
      // Held past the open, a blocked popup would lock the buyer out of
      // retrying through the fallback link.
      window.open = jest.fn(() => null);
      soleTrader.launchSignup();
      expect(soleTrader.openingSignup).toBe(false);

      window.open = jest.fn(() => ({ closed: false }));
      soleTrader.launchSignup();
      expect(window.open).toHaveBeenCalledTimes(1);
    });

    test("a blocked popup falls back to the visible signup link", () => {
      soleTrader.render();
      window.open = jest.fn(() => null);

      soleTrader.launchSignup();

      expect($(".twoinc-sole-trader-note").hasClass("hidden")).toBe(false);
    });

    test("carries the delegation and autofill tokens and the prefill", () => {
      $("#billing_email").val("buyer@example.test");
      $("#billing_city").val("Registryville");

      soleTrader.launchSignup();

      expect(opened[0].url).toContain("businessToken=delegation");
      expect(opened[0].url).toContain("autofillToken=autofill");
      const encoded = decodeURIComponent(opened[0].url.split("autofillData=")[1]);
      const prefill = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      expect(prefill.email).toBe("buyer@example.test");
      expect(prefill.billing_address.city).toBe("Registryville");
      expect(prefill.billing_address.country_code).toBe("GB");
    });
  });

  describe("§7 — select a different sole trader", () => {
    test("lands in the same slot as the search-for-company link", () => {
      const $btn = soleTrader.getDifferentSoleTraderBtnNode();

      expect($btn.parent().is("#billing_company_field .woocommerce-input-wrapper")).toBe(true);
      expect($btn.text()).toBe("Select a different sole trader");
    });

    test("sits after the company-search field in document order, never inside its dropdown or chip group (TWO-40 §0)", () => {
      // Ground-truth PrestaShop finding this ports: the button is a
      // following SIBLING of the search dropdown, appended as the LAST
      // child of the outer field wrapper — never a descendant of the
      // dropdown panel or of `.twoinc-mode-chips`.
      const $btn = soleTrader.getDifferentSoleTraderBtnNode();

      expect($btn.closest("#billing_company_display_field").length).toBe(0);
      expect($btn.closest(".twoinc-mode-chips").length).toBe(0);

      const search = $("#billing_company_display_field").get(0);
      const differentBtn = $btn.get(0);
      expect(
        !!(search.compareDocumentPosition(differentBtn) & Node.DOCUMENT_POSITION_FOLLOWING)
      ).toBe(true);
    });

    test("is hidden until a sole trader is actually adopted", () => {
      soleTrader.syncDifferentSoleTraderLink();
      // `:visible` is unusable under jsdom — nothing has layout, so every
      // element reports zero size. The inline display the show/hide writes is
      // the real signal.
      expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).toBe("none");

      soleTrader.mode = "sole_trader";
      $("#company_id").val("TWO:ST12345");
      soleTrader.syncDifferentSoleTraderLink();

      expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).not.toBe("none");
    });

    test("goes back to hidden on the way out of sole-trader mode", () => {
      soleTrader.mode = "sole_trader";
      $("#company_id").val("TWO:ST12345");
      soleTrader.syncDifferentSoleTraderLink();

      soleTrader.setMode("business");

      expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).toBe("none");
    });

    test.each([
      ["click", (btn) => btn.trigger("click")],
      ["Enter", (btn) => btn.trigger($.Event("keydown", { which: 13 }))],
      ["Space", (btn) => btn.trigger($.Event("keydown", { which: 32 }))]
    ])("activating by %s opens the popup with autoselect=false", (_description, activate) => {
      // Skips the cookie/silent-autofill pre-check entirely and launches
      // directly — the whole point of the link is to override what that
      // pre-check would have decided. The flag is wired through
      // unconditionally, with no client-side branching on its value.
      activate(soleTrader.getDifferentSoleTraderBtnNode());

      expect(opened).toHaveLength(1);
      expect(opened[0].url).toContain("&autoselect=false");
    });

    test("the ordinary signup launch carries no autoselect flag", () => {
      soleTrader.launchSignup();
      expect(opened[0].url).not.toContain("autoselect");
    });
  });

  describe("§8 — identity trust levels", () => {
    /**
     * Deliver a hosted-signup postMessage the way the popup does.
     *
     * @param {string} data
     * @returns {void}
     */
    function postFromSignup(data) {
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: data,
          origin: "https://checkout.example.test"
        })
      );
    }

    test("the PASSIVE check still requires the cookie's buyer to own the typed email", () => {
      $("#billing_email").val("buyer@example.test");

      expect(soleTrader.buyerOwnsCheckoutEmail({ email: "buyer@example.test" })).toBe(true);
      expect(soleTrader.buyerOwnsCheckoutEmail({ email: "someone.else@example.test" })).toBe(false);
      expect(soleTrader.buyerOwnsCheckoutEmail(null)).toBe(false);
    });

    test("a completed signup is adopted even under a DIFFERENT email from the checkout's", () => {
      // The confirmed bug this closes: the server has already told the browser
      // who the buyer is, so re-running the passive match makes the plugin
      // disagree with the server and reopen the same popup forever.
      $("#billing_email").val("checkout@example.test");
      soleTrader.mode = "sole_trader";
      jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) =>
        cb({
          email: "signed.up.as@example.test",
          organization_number: "TWO:ST12345",
          company_name: "Sole Trader Co"
        })
      );
      soleTrader.bindPopupMessageListener();

      postFromSignup("ACCEPTED");

      expect($("#company_id").val()).toBe("TWO:ST12345");
      expect($("#billing_company").val()).toBe("Sole Trader Co");
      expect(soleTrader.prefetched.matches).toBe(true);
    });

    test("a completed signup that resolves no buyer at all surfaces the error", () => {
      // The authenticated path trusts the server, which means it also has to
      // handle the server having nothing — otherwise this branch silently does
      // nothing and the buyer is left staring at an unchanged checkout.
      // Rendered BEFORE the mode is set: render() re-runs the email-driven
      // prefetch, and with no email entered that reverts sole-trader mode to
      // business on its own.
      soleTrader.render();
      soleTrader.mode = "sole_trader";
      jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) => cb(null));
      soleTrader.bindPopupMessageListener();

      postFromSignup("ACCEPTED");

      expect($(".twoinc-sole-trader-toggle__error").text()).toBe("Something went wrong");
      expect($("#company_id").val()).toBe("");
    });

    test("the authenticated lookup settles its own flight", () => {
      soleTrader.mode = "sole_trader";
      jest
        .spyOn(soleTrader, "fetchCurrentBuyer")
        .mockImplementation((cb) => cb({ organization_number: "TWO:ST1", company_name: "X" }));
      soleTrader.bindPopupMessageListener();

      postFromSignup("ACCEPTED");

      expect(soleTrader.flightDepth).toBe(0);
    });

    test("a message from another origin is ignored", () => {
      soleTrader.mode = "sole_trader";
      const lookup = jest.spyOn(soleTrader, "fetchCurrentBuyer");
      soleTrader.bindPopupMessageListener();

      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: "ACCEPTED",
          origin: "https://attacker.example.test"
        })
      );

      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe("TWO-40 §7 correction — live-reported by Doug", () => {
    /** Sets up a prefetch flight and hands back the callback for fetchCurrentBuyer. */
    function armPendingPrefetch() {
      $("#billing_email").val("buyer@example.test");
      jest.spyOn(soleTrader, "fetchTokens").mockImplementation((cb) => cb(true));
      let resolveBuyer;
      jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) => {
        resolveBuyer = cb;
      });
      return {
        settle: (buyer) => resolveBuyer(buyer)
      };
    }

    describe("bug 1 — chip click, autofill matched: populate only, never a popup", () => {
      test("prefetch already resolved and matching: populates synchronously, no popup", () => {
        soleTrader.prefetched = {
          ready: true,
          matches: true,
          buyer: { organization_number: "TWO:ST1", company_name: "Sole Co", email: "buyer@example.test" }
        };

        soleTrader.onModeChipClick("sole_trader");

        expect(opened).toHaveLength(0);
        expect($("#company_id").val()).toBe("TWO:ST1");
      });

      test("prefetch still in flight at click time: waits, then populates with no popup once it matches", () => {
        const flight = armPendingPrefetch();

        soleTrader.onModeChipClick("sole_trader");
        expect(opened).toHaveLength(0);
        expect(soleTrader.pendingChipDecisionEmail).toBe("buyer@example.test");

        flight.settle({
          organization_number: "TWO:ST1",
          company_name: "Sole Co",
          email: "buyer@example.test"
        });

        expect(opened).toHaveLength(0);
        expect($("#company_id").val()).toBe("TWO:ST1");
        expect(soleTrader.mode).toBe("sole_trader");
        expect(soleTrader.pendingChipDecisionEmail).toBe(null);
      });

      test("prefetch still in flight at click time and resolves with no match: opens exactly one popup, once", () => {
        const flight = armPendingPrefetch();

        soleTrader.onModeChipClick("sole_trader");
        flight.settle(null);

        expect(opened).toHaveLength(1);
        expect(soleTrader.mode).toBe("sole_trader");
      });

      test("no email entered yet: falls back to the manual link, no popup, no wait", () => {
        soleTrader.onModeChipClick("sole_trader");

        expect(opened).toHaveLength(0);
        expect(soleTrader.pendingChipDecisionEmail).toBe(null);
        expect($(".twoinc-sole-trader-note").hasClass("hidden")).toBe(false);
      });
    });

    describe("bug 2 — the search dropdown stays visible with a spinner until the popup closes", () => {
      test("dropdown survives the mode switch while a match is still pending", () => {
        const $widget = harness.openCompanyWidget($, ctx.helper);
        armPendingPrefetch();

        soleTrader.setMode("sole_trader");

        expect($widget.data("select2").isOpen()).toBe(true);
        expect(jQuery("#billing_company_display").data("select2")).toBeTruthy();
      });

      test("popup opening does not tear the dropdown down, matched or not", () => {
        const $widget = harness.openCompanyWidget($, ctx.helper);
        soleTrader.setMode("sole_trader");

        soleTrader.launchSignup();

        expect(opened).toHaveLength(1);
        expect($widget.data("select2").isOpen()).toBe(true);
      });

      test("the in-field spinner is up for as long as the popup is open, and comes down when it closes", () => {
        harness.openCompanyWidget($, ctx.helper);
        soleTrader.setMode("sole_trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        jest.useFakeTimers();

        soleTrader.launchSignup();
        expect($(".twoinc-search-spinner").length).toBe(1);

        win.closed = true;
        jest.advanceTimersByTime(300);

        expect($(".twoinc-search-spinner").length).toBe(0);
        jest.useRealTimers();
      });

      test("closing the popup with nothing adopted hands the checkout back to an ordinary search", () => {
        soleTrader.setMode("sole_trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        jest.useFakeTimers();

        soleTrader.launchSignup();
        win.closed = true;
        jest.advanceTimersByTime(300);

        expect(soleTrader.mode).toBe("business");
        jest.useRealTimers();
      });

      test("closing the popup after a completed signup leaves the adopted company alone", () => {
        soleTrader.setMode("sole_trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        jest.useFakeTimers();

        soleTrader.launchSignup();
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");
        win.closed = true;
        jest.advanceTimersByTime(300);

        expect(soleTrader.mode).toBe("sole_trader");
        expect($("#company_id").val()).toBe("TWO:ST1");
        jest.useRealTimers();
      });
    });

    describe("bug 3 — clicking a captured sole-trader field reopens search", () => {
      beforeEach(() => {
        // The click-to-reopen binding is delegated from `Twoinc#initialize()`
        // (real checkout-page wiring), not from the helper directly — same
        // as every other delegated handler this file's siblings exercise.
        $("form[name='checkout']").after('<div id="order_review"></div>');
        ctx.Twoinc.getInstance().initialize(false);
      });

      test("clicking #billing_company after adoption switches back to business and reopens the dropdown", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");
        expect($("#billing_company").prop("readonly")).toBe(true);

        $("#billing_company").trigger("click");

        expect(soleTrader.mode).toBe("business");
        expect($("#billing_company").prop("readonly")).toBe(false);
        expect($("#billing_company_display").data("select2").isOpen()).toBe(true);
      });

      test("clicking #company_id after adoption does the same", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");

        $("#company_id").trigger("click");

        expect(soleTrader.mode).toBe("business");
      });

      test("clicking the field while still in business mode is a no-op", () => {
        const setModeSpy = jest.spyOn(soleTrader, "setMode");

        $("#billing_company").trigger("click");

        expect(setModeSpy).not.toHaveBeenCalled();
      });

      test("the 'select a different sole trader' link still works alongside click-to-reopen", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");

        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");

        expect(opened).toHaveLength(1);
        expect(opened[0].url).toContain("&autoselect=false");
        // Unlike the field click, this stays in sole-trader mode — it is
        // choosing a DIFFERENT sole trader, not leaving sole trader mode.
        expect(soleTrader.mode).toBe("sole_trader");
      });
    });

    describe("round-1 review regressions (Han/Vader/Leia) — races the dropdown-survives fix opened up", () => {
      test("the Business chip is refused while an autofill flight is outstanding, not honoured then stomped by the match", () => {
        const flight = armPendingPrefetch();
        soleTrader.onModeChipClick("sole_trader");

        // The chip lives inside the search dropdown the buyer is still
        // looking at — clicking Business mid-flight used to force mode back
        // to business immediately, only for the later match to silently
        // force it straight back to sole-trader and populate underneath.
        ctx.helper.buildBusinessChip().trigger("click");
        expect(soleTrader.mode).toBe("sole_trader");

        flight.settle({
          organization_number: "TWO:ST1",
          company_name: "Sole Co",
          email: "buyer@example.test"
        });

        expect(soleTrader.mode).toBe("sole_trader");
        expect($("#company_id").val()).toBe("TWO:ST1");
      });

      test("the Business chip works normally once the flight has actually settled", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");

        ctx.helper.buildBusinessChip().trigger("click");

        expect(soleTrader.mode).toBe("business");
      });

      test("clicking a captured field is refused while a popup is still open, so a completed signup is not dropped", () => {
        $("form[name='checkout']").after('<div id="order_review"></div>');
        ctx.Twoinc.getInstance().initialize(false);
        soleTrader.setMode("sole_trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        soleTrader.launchSignup();

        // The buyer clicks the (not-yet-locked) captured field while the
        // popup is still open, instead of finishing signup in it.
        $("#billing_company").trigger("click");
        expect(soleTrader.mode).toBe("sole_trader");

        // The popup posts ACCEPTED and completes normally.
        jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) =>
          cb({ organization_number: "TWO:ST1", company_name: "A Sole Trader", email: "buyer@example.test" })
        );
        soleTrader.bindPopupMessageListener();
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: "ACCEPTED",
            origin: "https://checkout.example.test"
          })
        );

        expect($("#company_id").val()).toBe("TWO:ST1");
      });

      test("an unrelated company already captured before sole-trader mode does not suppress the abandon-revert", () => {
        // A prior manual/registry pick left #company_id non-empty. Entering
        // sole-trader mode and abandoning the popup must still revert — the
        // stale id is not evidence that THIS sole-trader session adopted
        // anything.
        $("#company_id").val("556677-1234");
        soleTrader.setMode("sole_trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        jest.useFakeTimers();

        soleTrader.launchSignup();
        win.closed = true;
        jest.advanceTimersByTime(300);

        expect(soleTrader.mode).toBe("business");
        jest.useRealTimers();
      });

      test("the popup-close poll does not revert while the ACCEPTED handler's own fetch is still resolving", () => {
        soleTrader.setMode("sole_trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        jest.useFakeTimers();
        soleTrader.launchSignup();

        let resolveBuyer;
        jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) => {
          resolveBuyer = cb;
        });
        soleTrader.bindPopupMessageListener();
        window.dispatchEvent(
          new window.MessageEvent("message", { data: "ACCEPTED", origin: "https://checkout.example.test" })
        );

        // The popup closes before that fetch resolves.
        win.closed = true;
        jest.advanceTimersByTime(300);
        expect(soleTrader.mode).toBe("sole_trader");

        resolveBuyer({ organization_number: "TWO:ST1", company_name: "A Sole Trader" });
        expect($("#company_id").val()).toBe("TWO:ST1");
        expect(soleTrader.mode).toBe("sole_trader");
        jest.useRealTimers();
      });

      test("a pending chip decision does not fire against a later, unrelated flight for a different email", () => {
        const flight = armPendingPrefetch();
        soleTrader.onModeChipClick("sole_trader");
        expect(soleTrader.pendingChipDecisionEmail).toBe("buyer@example.test");

        // The buyer edits the email before the flight it was raised for
        // lands, and that stale flight resolves with no match.
        $("#billing_email").val("someone.else@example.test");
        flight.settle(null);

        // Dropped, not misapplied: no popup for a decision that no longer
        // matches what is actually entered.
        expect(opened).toHaveLength(0);
      });

      test("a click that lands while availability just dropped does not leak a pending decision forward", () => {
        $("#billing_email").val("buyer@example.test");
        soleTrader.availabilityByCountry = { GB: false };

        soleTrader.onModeChipClick("sole_trader");
        expect(soleTrader.pendingChipDecisionEmail).toBe(null);
      });
    });

    describe("round-2 review regressions (Han/Vader) — isBusy() wired onto only 2 of the revert paths", () => {
      test("hide() does not revert mode while a signup popup is still open", () => {
        soleTrader.setMode("sole_trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        soleTrader.launchSignup();

        // A coupon apply / shipping change / quantity edit fires
        // `updated_checkout` -> refresh() -> hide(), independent of country.
        soleTrader.hide();
        expect(soleTrader.mode).toBe("sole_trader");

        // The popup completes normally afterwards.
        jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) =>
          cb({ organization_number: "TWO:ST1", company_name: "A Sole Trader", email: "buyer@example.test" })
        );
        soleTrader.bindPopupMessageListener();
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: "ACCEPTED",
            origin: "https://checkout.example.test"
          })
        );

        expect($("#company_id").val()).toBe("TWO:ST1");
      });

      test("hide() still reverts mode once nothing is outstanding", () => {
        soleTrader.setMode("sole_trader");

        soleTrader.hide();

        expect(soleTrader.mode).toBe("business");
      });

      test("clearing the email mid-flight does not revert mode while a flight is still outstanding", () => {
        const flight = armPendingPrefetch();
        soleTrader.onModeChipClick("sole_trader");

        $("#billing_email").val("");
        soleTrader.onEmailChanged();
        expect(soleTrader.mode).toBe("sole_trader");

        flight.settle(null);
        // The stale flight's own applyPrefetch() settles it once it actually
        // resolves, matching against the now-empty email — no match, no
        // pending click for it either, so it reverts.
        expect(soleTrader.mode).toBe("business");
      });

      test("a redundant unchanged-email re-render mid-flight does not drop the pending chip decision", () => {
        const flight = armPendingPrefetch();
        soleTrader.onModeChipClick("sole_trader");
        expect(soleTrader.pendingChipDecisionEmail).toBe("buyer@example.test");

        // WooCommerce firing onEmailChanged again for the SAME email while
        // the real flight for it is still outstanding must not clear the
        // decision that flight's own applyPrefetch() is about to serve.
        soleTrader.onEmailChanged();
        expect(soleTrader.pendingChipDecisionEmail).toBe("buyer@example.test");

        flight.settle(null);
        expect(opened).toHaveLength(1);
      });
    });

    describe("round-3 review regressions (Han/Vader) — concurrent flights, isDeciding() vs isBusy(), country change", () => {
      /**
       * Prime `countryDidChange`'s own tracker to the current GB before a
       * test switches the country — it returns false (no change) on its
       * very first call regardless of the field's value, so a test that
       * calls `syncBillingCountry()` only once would never reach the
       * "real country change" branch it means to exercise at all.
       */
      function primeCountry() {
        ctx.helper.countryDidChange("GB");
      }

      /** Arms fetchTokens/fetchCurrentBuyer to hand back every resolve callback in call order. */
      function armConcurrentFlights() {
        jest.spyOn(soleTrader, "fetchTokens").mockImplementation((cb) => cb(true));
        const callbacks = [];
        jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) => {
          callbacks.push(cb);
        });
        return callbacks;
      }

      test("a stale flight for an earlier email does not revert a later flight's already-adopted match", () => {
        const callbacks = armConcurrentFlights();

        $("#billing_email").val("first@example.test");
        soleTrader.onEmailChanged();
        $("#billing_email").val("second@example.test");
        soleTrader.onEmailChanged();
        expect(callbacks).toHaveLength(2);

        // The SECOND (current-email) flight resolves and adopts first.
        callbacks[1]({
          organization_number: "TWO:ST2",
          company_name: "Second Co",
          email: "second@example.test"
        });
        expect(soleTrader.mode).toBe("sole_trader");
        expect($("#company_id").val()).toBe("TWO:ST2");

        // The FIRST flight's stale response lands after — no match against
        // the current email, and must not stomp what the newer flight
        // already adopted.
        callbacks[0](null);
        expect(soleTrader.mode).toBe("sole_trader");
        expect($("#company_id").val()).toBe("TWO:ST2");
      });

      test("the Business chip works once adopted even while the popup-close poll hasn't caught up yet", () => {
        soleTrader.setMode("sole_trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        soleTrader.launchSignup();
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");
        // Popup handle never reports closed — activePopupWatchers stays
        // nonzero, so isBusy() alone would refuse this even though the
        // outcome (adopted) is already settled.
        expect(soleTrader.isBusy()).toBe(true);

        ctx.helper.buildBusinessChip().trigger("click");

        expect(soleTrader.mode).toBe("business");
      });

      test("clicking the captured field works once adopted even while the popup-close poll hasn't caught up yet", () => {
        $("form[name='checkout']").after('<div id="order_review"></div>');
        ctx.Twoinc.getInstance().initialize(false);
        soleTrader.setMode("sole_trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        soleTrader.launchSignup();
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");
        expect(soleTrader.isBusy()).toBe(true);

        $("#billing_company").trigger("click");

        expect(soleTrader.mode).toBe("business");
      });

      test("a real country change does not wipe an already-adopted sole trader while leaving mode stranded", () => {
        primeCountry();
        // A real adopted buyer always has an email — that's how the match
        // happened — so `refresh()`'s own trailing `onEmailChanged()` (which
        // otherwise correctly reverts on NO email at all) is a no-op re-entry
        // here, dedupe against the already-recorded `lastPrefetchEmail`.
        $("#billing_email").val("buyer@example.test");
        soleTrader.lastPrefetchEmail = "buyer@example.test";
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");
        soleTrader.availabilityByCountry.SE = true;

        $("#billing_country").append('<option value="SE">SE</option>');
        $("#billing_country").val("SE");
        ctx.Twoinc.getInstance().syncBillingCountry();

        expect($("#company_id").val()).toBe("TWO:ST1");
        expect(soleTrader.mode).toBe("sole_trader");
      });

      test("a real country change does not wipe a sole-trader flight still in progress", () => {
        primeCountry();
        const flight = armPendingPrefetch();
        soleTrader.onModeChipClick("sole_trader");
        soleTrader.availabilityByCountry.SE = true;

        $("#billing_country").append('<option value="SE">SE</option>');
        $("#billing_country").val("SE");
        ctx.Twoinc.getInstance().syncBillingCountry();

        // The in-flight request for the outgoing country still gets to
        // settle and decide, rather than having its target fields wiped out
        // from under it mid-flight.
        flight.settle({
          organization_number: "TWO:ST1",
          company_name: "Sole Co",
          email: "buyer@example.test"
        });
        expect($("#company_id").val()).toBe("TWO:ST1");
      });

      test("a country change still clears an ordinary company search pick as before", () => {
        // Through the real write path, not a raw `.val()` — `clearSelectedCompany()`
        // gates the name clear on provenance (TWO-40 §5), and a raw `.val()`
        // carries no provenance marker at all.
        primeCountry();
        ctx.capture.write("Existing Co", "556677-1234");
        soleTrader.mode = "business";
        soleTrader.availabilityByCountry.SE = true;

        $("#billing_country").append('<option value="SE">SE</option>');
        $("#billing_country").val("SE");
        ctx.Twoinc.getInstance().syncBillingCountry();

        expect($("#billing_company").val()).toBe("");
      });
    });
  });
});
