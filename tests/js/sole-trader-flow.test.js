/**
 * TWO-40 §7 + §8. The sole-trader flow's UX affordances and its identity-trust
 * boundary.
 *
 *   §7 — an in-flight state wired to the REAL duration of the round trip (a
 *   count, not a boolean, not a timeout), re-entrancy guards so neither one
 *   gesture nor a later click while a popup is undecided can stack a second
 *   signup popup, a "select a different sole trader" link in the same slot
 *   as the existing "search for company" one, and a popup that
 *   is wide enough for the hosted flow's own layout.
 *
 *   §8 — the passive, pre-authentication email match is correct only before
 *   the server has said who the buyer is. Reusing it on the post-OTP callback
 *   is a confirmed bug: the buyer completes signup, the stale check disagrees
 *   with the server, and the same popup reopens forever.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./wc-harness");

function stylesheetSource() {
  return fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8");
}

// The checkout subset the sole-trader module reads and writes.
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
    // Same shape again, for the window `focus` listener `watchPopupClose`
    // binds.
    soleTrader.unbindWindowRefocusListener();
    // Same shape, for `watchPopupClose`'s real `setInterval` polls: a test
    // that opens a popup and never closes it otherwise leaves that poll
    // running for the rest of the file.
    soleTrader.stopAllPopupWatchers();
    // Same shape again, for the TWO-40 token-refresh `setInterval` (TWO-40):
    // a test that reaches a real successful mint starts it, and it would
    // otherwise keep firing against a stale module for the rest of the file.
    soleTrader.stopTokenRefresh();
    harness.releaseWidgets($);
    document.body.innerHTML = "";
  });

  // Puts the flow in its one genuinely-undecided state — a chip click with the
  // signup popup open and no outcome posted yet — and hands back
  // `settle(buyer)`, which posts the popup's own ACCEPTED and resolves the
  // buyer lookup it fires (`null` for none).
  function armUndecidedSignup() {
    $("#billing_email").val("buyer@example.test");
    soleTrader.bindPopupMessageListener();
    let resolveBuyer;
    jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) => {
      resolveBuyer = cb;
    });
    return {
      settle: (buyer) => {
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: "ACCEPTED",
            origin: "https://checkout.example.test"
          })
        );
        resolveBuyer(buyer);
      }
    };
  }

  describe("§7 — in-flight state", () => {
    test("goes up on the first flight and stays up until the last settles", () => {
      // A COUNT, not a boolean: a re-signup can overlap an earlier popup's
      // own close poll.
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

    /**
     * The spinner belongs over the field this flow is FILLING IN, not in the
     * query row it hides (Doug 2026-08-20). The query row is suppressed for
     * the whole of sole-trader mode now, so a spinner painted in there is a
     * spinner painted nowhere.
     */
    test("shows the spinner over the company-NAME field, not in the dropdown's query row", () => {
      const $widget = harness.openCompanyWidget($, ctx.helper);
      soleTrader.setMode("sole_trader");

      soleTrader.beginFlight();

      expect(
        $("#billing_company_display_field .select2-selection > .twoinc-sole-trader-spinner").length
      ).toBe(1);
      expect($(".select2-search--dropdown .twoinc-search-spinner").length).toBe(0);
      // And the control is left OPEN under it.
      expect($widget.data("select2").isOpen()).toBe(true);

      soleTrader.settleFlight();
      expect($(".twoinc-sole-trader-spinner").length).toBe(0);
    });

    /**
     * Both name surfaces, because mode can be `sole_trader` while a country or
     * capture-mode switch has the native field on screen instead of the picker.
     */
    test("paints over the native company field when the picker is the hidden one", () => {
      $("#billing_company_display_field").addClass("hidden");
      soleTrader.setMode("sole_trader");

      soleTrader.beginFlight();

      expect(
        $("#billing_company_field .woocommerce-input-wrapper > .twoinc-sole-trader-spinner").length
      ).toBe(1);
    });

    test("the company search's own spinner and the sole-trader one do not share a node", () => {
      // They used to, arbitrated by a two-owner hold, because both painted in
      // the query row: whichever settled first hid it under the other. Two
      // nodes in two fields is what removed that contention — asserted so a
      // future round cannot quietly put them back in one place.
      harness.openCompanyWidget($, ctx.helper);
      soleTrader.setMode("sole_trader");
      ctx.helper.toggleCompanySearchSpinner(true);

      soleTrader.beginFlight();
      expect($(".select2-search--dropdown .twoinc-search-spinner").length).toBe(1);
      expect($(".twoinc-sole-trader-spinner").length).toBe(1);

      soleTrader.settleFlight();
      expect($(".select2-search--dropdown .twoinc-search-spinner").length).toBe(1);
      expect($(".twoinc-sole-trader-spinner").length).toBe(0);
    });

    test("a flight running in business mode paints nothing over the company name", () => {
      harness.openCompanyWidget($, ctx.helper);

      soleTrader.beginFlight();

      expect($(".twoinc-sole-trader-spinner").length).toBe(0);
    });

    test("the spinner is DERIVED from mode, not held from beginFlight alone", () => {
      // A mode switch made while a flight is already in the air still has to
      // paint — a spinner HELD at `beginFlight` would have missed the wait.
      harness.openCompanyWidget($, ctx.helper);
      soleTrader.beginFlight();

      soleTrader.setMode("sole_trader");

      expect($(".twoinc-sole-trader-spinner").length).toBe(1);
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

    describe("PDEV-4669 — the country the hosted signup builds its form for", () => {
      // Given a token response / When the popup opens / Then the `country`
      // param carries the server's value, or is absent.
      test.each([
        ["US", "US", "passed straight through"],
        ["us", "US", "upper-cased for the page's ISO check"],
        ["", null, "empty stays absent, not an empty param"],
        [undefined, null, "a response without one leaves the page on its default"]
      ])("tokens.country %p -> country=%p (%s)", (tokenCountry, expected) => {
        soleTrader.tokens.country = tokenCountry;

        soleTrader.launchSignup();

        expect(new URL(opened[0].url).searchParams.get("country")).toBe(expected);
      });

      test("never the DOM — a tampered field must not pick the buyer's jurisdiction", () => {
        // The popup writes this country onto the proposal, so a DOM read would
        // let a buyer self-select which verification flow they are put through.
        $("#billing_country").append('<option value="US">US</option>').val("US");
        soleTrader.tokens.country = "GB";

        soleTrader.launchSignup();

        expect(new URL(opened[0].url).searchParams.get("country")).toBe("GB");
      });
    });
  });

  describe("§7 — popup stacking across sequential activations", () => {
    test.each([[""], ["buyer@example.test"]])(
      "two sequential chip clicks open one popup, not two stacked — email %p",
      (email) => {
        $("#billing_email").val(email);

        soleTrader.onModeChipClick("sole_trader");
        expect(opened).toHaveLength(1);

        // A second, LATER click — a separate gesture, after `openingSignup`
        // has been released — while the first popup is still open and its
        // outcome undecided.
        soleTrader.onModeChipClick("sole_trader");
        expect(opened).toHaveLength(1);
      }
    );

    /**
     * Every launch path the undecided-popup guard must leave alone. Each case
     * arranges its state, launches, and must end with exactly the popups it
     * asked for — refusing any of these is the regression the two earlier,
     * rejected guards each caused (watcher-count alone refused the post-accept
     * re-signup; `isDeciding()` refused launches with only a stale flight
     * outstanding).
     */
    test.each([
      {
        arrangeAndAct: () => {
          // Given: first-signup popup still open, but its signup already
          // ACCEPTED and adopted — the popup has DECIDED.
          soleTrader.setMode("sole_trader");
          soleTrader.launchSignup();
          soleTrader.bindPopupMessageListener();
          jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) =>
            cb({
              organization_number: "TWO:ST1",
              company_name: "First Trader",
              email: "buyer@example.test"
            })
          );
          window.dispatchEvent(
            new window.MessageEvent("message", {
              data: "ACCEPTED",
              origin: "https://checkout.example.test"
            })
          );
          // When: the "select a different sole trader" re-signup launches.
          soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
        },
        expectedPopups: 2,
        description:
          "a re-signup after acceptance, while the accepted popup's close poll is still outstanding"
      },
      {
        arrangeAndAct: () => {
          // Given: a browser-blocked popup — no watcher was ever created.
          soleTrader.setMode("sole_trader");
          const realOpen = window.open;
          window.open = jest.fn(() => null);
          soleTrader.launchSignup();
          window.open = realOpen;
          // When: the buyer retries.
          soleTrader.launchSignup();
        },
        expectedPopups: 1,
        description: "a retry after a browser-blocked popup"
      },
      {
        arrangeAndAct: () => {
          // Given: the note link, shown as the blocked-popup fallback.
          soleTrader.render();
          soleTrader.setMode("sole_trader");
          const realOpen = window.open;
          window.open = jest.fn(() => null);
          soleTrader.launchSignup();
          window.open = realOpen;
          // When: the buyer clicks the visible signup link.
          $(".twoinc-sole-trader-note__link").trigger("click");
        },
        expectedPopups: 1,
        description: "the note link after a blocked popup"
      },
      {
        arrangeAndAct: () => {
          // Given: ONLY a bare flight outstanding, no popup anywhere.
          soleTrader.beginFlight();
          // When: the chip is clicked.
          soleTrader.onModeChipClick("sole_trader");
        },
        expectedPopups: 1,
        description: "a chip click while only a stale flight is outstanding"
      }
    ])("still launches: $description", ({ arrangeAndAct, expectedPopups }) => {
      arrangeAndAct();

      // Then: the launch was honoured, not refused.
      expect(opened).toHaveLength(expectedPopups);
    });

    test("an accepted-then-closed re-signup spends ONE decrement, so a third click cannot stack over an undecided second re-signup", () => {
      jest.useFakeTimers();
      soleTrader.setMode("sole_trader");
      soleTrader.setCompany("TWO:ST1", "First Trader");
      soleTrader.bindPopupMessageListener();

      // Given: re-signup R1 accepted, then closed INSIDE its poll's own
      // 300ms window — the poll has not noticed yet.
      const win1 = { closed: false };
      window.open = jest.fn(() => win1);
      soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
      jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) =>
        cb({
          organization_number: "TWO:ST2",
          company_name: "Second Trader",
          email: "buyer@example.test"
        })
      );
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: "ACCEPTED",
          origin: "https://checkout.example.test"
        })
      );
      expect(soleTrader.soleTraderReconfirmingCount).toBe(0);
      win1.closed = true;

      // When: re-signup R2 opens before R1's stale poll fires.
      const win2 = { closed: false };
      window.open = jest.fn(() => win2);
      soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
      expect(soleTrader.soleTraderReconfirmingCount).toBe(1);
      jest.advanceTimersByTime(300);

      // Then: R1's poll did not steal R2's decrement, and a third click
      // while R2 is open and undecided does not stack.
      expect(soleTrader.soleTraderReconfirmingCount).toBe(1);
      const thirdOpen = jest.fn(() => ({ closed: false }));
      window.open = thirdOpen;
      soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
      expect(thirdOpen).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    test("a chip click straight after the buyer closed the popup by hand opens a fresh one — the stale poll neither refuses nor reverts", () => {
      jest.useFakeTimers();
      $("#billing_email").val("");
      const wins = [];
      window.open = jest.fn(() => {
        const win = { closed: false };
        wins.push(win);
        return win;
      });

      soleTrader.onModeChipClick("sole_trader");
      expect(wins).toHaveLength(1);

      // When: the buyer closes the popup and re-clicks INSIDE the close
      // poll's own 300ms window.
      wins[0].closed = true;
      soleTrader.onModeChipClick("sole_trader");

      // Then: a fresh popup, and the first popup's poll firing later must
      // not revert mode out from under it.
      expect(wins).toHaveLength(2);
      jest.advanceTimersByTime(300);
      expect(soleTrader.mode).toBe("sole_trader");
      expect(soleTrader.activePopupWatchers).toHaveLength(1);
      jest.useRealTimers();
    });

    test("a closed popup's record leaves the watcher list, so nothing refuses forever", () => {
      jest.useFakeTimers();
      const win = { closed: false };
      window.open = jest.fn(() => win);
      soleTrader.setMode("sole_trader");
      soleTrader.launchSignup();

      win.closed = true;
      jest.advanceTimersByTime(300);

      expect(soleTrader.activePopupWatchers).toHaveLength(0);
      expect(soleTrader.isBusy()).toBe(false);
      const retryOpen = jest.fn(() => ({ closed: false }));
      window.open = retryOpen;
      soleTrader.launchSignup();
      expect(retryOpen).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    test("no popup stacks while an ACCEPTED's own buyer fetch is still resolving, even once the popup closed and its record is gone", () => {
      jest.useFakeTimers();
      soleTrader.setMode("sole_trader");
      const win = { closed: false };
      window.open = jest.fn(() => win);
      soleTrader.launchSignup();
      soleTrader.bindPopupMessageListener();
      jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation(() => {});

      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: "ACCEPTED",
          origin: "https://checkout.example.test"
        })
      );
      win.closed = true;
      jest.advanceTimersByTime(300);
      expect(soleTrader.activePopupWatchers).toHaveLength(0);

      const stackOpen = jest.fn(() => ({ closed: false }));
      window.open = stackOpen;
      soleTrader.launchSignup();
      expect(stackOpen).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    /**
     * Round-3 review regressions (by Claude). Letting a fresh popup open over
     * a hand-closed record's stale poll window — the round-2 fix above — put
     * TWO undecided records in the list at once, which the ACCEPTED handler's
     * forward `find(!decided)` then resolved to the STALE one in preference to
     * the live popup that actually sent the message.
     */
    describe("round-3 review regressions — ACCEPTED pairs with the popup that sent it", () => {
      // Opens a popup through `act`, returning the window handle it got.
      function openTracked(act) {
        const win = { closed: false };
        window.open = jest.fn(() => win);
        act();
        return win;
      }

      // Delivers ACCEPTED as the named popup window, the way the browser does.
      function accept(source, buyer) {
        soleTrader.bindPopupMessageListener();
        jest
          .spyOn(soleTrader, "fetchCurrentBuyer")
          .mockImplementation((cb) => cb(buyer === undefined ? null : buyer));
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: "ACCEPTED",
            origin: "https://checkout.example.test",
            source: source
          })
        );
      }

      const BUYER = {
        organization_number: "TWO:ST2",
        company_name: "Second Trader",
        email: "buyer@example.test"
      };

      test("marks the live popup decided, not the stale hand-closed record it opened over", () => {
        jest.useFakeTimers();
        $("#billing_email").val("");

        // Given: popup A hand-closed inside its own poll window, popup B
        // relaunched over it — both records undecided.
        const winA = openTracked(() => soleTrader.onModeChipClick("sole_trader"));
        winA.closed = true;
        const winB = openTracked(() => soleTrader.onModeChipClick("sole_trader"));
        expect(soleTrader.activePopupWatchers).toHaveLength(2);

        // When: B completes signup.
        accept(winB, BUYER);

        // Then: B is the decided one, and A is still owed its own abandon
        // handling by its own poll.
        const recordFor = (win) => soleTrader.activePopupWatchers.find((w) => w.win === win);
        expect(recordFor(winB).decided).toBe(true);
        expect(recordFor(winA).decided).toBe(false);
        jest.useRealTimers();
      });

      test("does not refuse the sanctioned re-signup after an accept that followed a hand-closed popup", () => {
        jest.useFakeTimers();
        $("#billing_email").val("");

        // Given: A hand-closed, B relaunched over its stale window, B accepted.
        const winA = openTracked(() => soleTrader.onModeChipClick("sole_trader"));
        winA.closed = true;
        const winB = openTracked(() => soleTrader.onModeChipClick("sole_trader"));
        accept(winB, BUYER);
        expect(soleTrader.soleTraderAdopted).toBe(true);

        // When: the buyer takes the "select a different sole trader" link the
        // accept just earned them.
        const reSignup = jest.fn(() => ({ closed: false }));
        window.open = reSignup;
        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");

        // Then: it opened. Mis-pairing left B undecided and open, which the
        // launch guard read as "a popup is still deciding" — for as long as
        // the hosted flow left its own window up, i.e. potentially forever.
        expect(reSignup).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
      });

      test("spends the accepting popup's reconfirming decrement, not a stale record's", () => {
        jest.useFakeTimers();
        $("#billing_email").val("");

        // Given: a first-time popup A hand-closed, then an autofill match
        // adopts under its stale window, so the re-signup link is live.
        const winA = openTracked(() => soleTrader.onModeChipClick("sole_trader"));
        winA.closed = true;
        soleTrader.setCompany("TWO:ST1", "First Trader");
        expect(soleTrader.soleTraderAdopted).toBe(true);

        // When: re-signup B opens over A and is accepted.
        const winB = openTracked(() => soleTrader.getDifferentSoleTraderBtnNode().trigger("click"));
        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);
        accept(winB, BUYER);

        // Then: B's increment is settled. Pairing with A — which never
        // incremented, being a first-time signup — left the count stranded at
        // 1, so `isDeciding()` blocked every leave-sole-trader action after it.
        expect(soleTrader.soleTraderReconfirmingCount).toBe(0);
        expect(soleTrader.isDeciding()).toBe(false);
        jest.useRealTimers();
      });

      test("a replayed ACCEPTED from an already-decided popup spends no second decrement", () => {
        jest.useFakeTimers();
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "First Trader");

        // Given: a re-signup accepted once.
        const win = openTracked(() => soleTrader.getDifferentSoleTraderBtnNode().trigger("click"));
        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);
        accept(win, BUYER);
        expect(soleTrader.soleTraderReconfirmingCount).toBe(0);

        // When: a second re-signup is outstanding and the first popup's
        // ACCEPTED is replayed.
        const winNext = openTracked(() =>
          soleTrader.getDifferentSoleTraderBtnNode().trigger("click")
        );
        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);
        accept(win, BUYER);

        // Then: the replay neither re-spent the decided popup's decrement nor
        // stole the still-undecided one's.
        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);
        expect(soleTrader.activePopupWatchers.find((w) => w.win === winNext).decided).toBe(false);
        jest.useRealTimers();
      });

      test("pairs by the live popup when the browser gives no source, never the stale record", () => {
        jest.useFakeTimers();
        $("#billing_email").val("");

        // Given: A hand-closed and B live, with a message carrying no source
        // (a popup that closes in the same turn it posts can arrive this way).
        const winA = openTracked(() => soleTrader.onModeChipClick("sole_trader"));
        winA.closed = true;
        const winB = openTracked(() => soleTrader.onModeChipClick("sole_trader"));

        // When: ACCEPTED arrives unattributed.
        accept(null, BUYER);

        // Then: the live popup is the one that decided.
        const recordFor = (win) => soleTrader.activePopupWatchers.find((w) => w.win === win);
        expect(recordFor(winB).decided).toBe(true);
        expect(recordFor(winA).decided).toBe(false);
        jest.useRealTimers();
      });

      test("a stale poll does not revert mode under a decided popup that is still on screen", () => {
        jest.useFakeTimers();
        $("#billing_email").val("");

        // Given: A hand-closed, B relaunched over it, and B's ACCEPTED
        // resolving to no buyer — decided, errored, window still up.
        const winA = openTracked(() => soleTrader.onModeChipClick("sole_trader"));
        winA.closed = true;
        const winB = openTracked(() => soleTrader.onModeChipClick("sole_trader"));
        accept(winB, null);
        expect(soleTrader.soleTraderAdopted).toBe(false);

        // When: A's stale poll finally fires.
        jest.advanceTimersByTime(300);

        // Then: mode is still B's, so the buyer's retry inside B is not
        // dropped on the handler's own `mode !== "sole_trader"` gate.
        expect(soleTrader.mode).toBe("sole_trader");
        accept(winB, BUYER);
        expect(soleTrader.soleTraderAdopted).toBe(true);
        jest.useRealTimers();
      });

      test("still reverts mode once every popup really has gone", () => {
        jest.useFakeTimers();
        $("#billing_email").val("");

        // Given: A hand-closed and B relaunched over it, then B closed too,
        // neither ever decided.
        const winA = openTracked(() => soleTrader.onModeChipClick("sole_trader"));
        winA.closed = true;
        const winB = openTracked(() => soleTrader.onModeChipClick("sole_trader"));
        winB.closed = true;

        // When: both stale polls fire.
        jest.advanceTimersByTime(300);

        // Then: the checkout is handed back to an ordinary company search
        // rather than left stuck mid-switch.
        expect(soleTrader.activePopupWatchers).toHaveLength(0);
        expect(soleTrader.mode).toBe("business");
        jest.useRealTimers();
      });

      test("attributes an unattributed accept to the newest closed record, not the stale one under it", () => {
        jest.useFakeTimers();
        $("#billing_email").val("");

        // Given: first-time popup A hand-closed, an autofill match adopting
        // under its stale window, then re-signup B opened over it — and B
        // posts ACCEPTED and vanishes in the same turn, so BOTH records are
        // closed and undecided with no source to pair on.
        const winA = openTracked(() => soleTrader.onModeChipClick("sole_trader"));
        winA.closed = true;
        soleTrader.setCompany("TWO:ST1", "First Trader");
        const winB = openTracked(() => soleTrader.getDifferentSoleTraderBtnNode().trigger("click"));
        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);
        winB.closed = true;

        // When: the unattributed ACCEPTED lands.
        accept(null, BUYER);

        // Then: B owns it. Scanning oldest-first picks A — which, being a
        // first-time signup, owes no decrement — stranding B's.
        expect(soleTrader.activePopupWatchers.find((w) => w.win === winB).decided).toBe(true);
        expect(soleTrader.soleTraderReconfirmingCount).toBe(0);
        jest.useRealTimers();
      });

      test("still pairs a popup that closed in the very turn it posted ACCEPTED", () => {
        jest.useFakeTimers();
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "First Trader");

        // Given: the only record is a re-signup whose window is already gone
        // by the time the message is delivered, with no source to pair on.
        const win = openTracked(() => soleTrader.getDifferentSoleTraderBtnNode().trigger("click"));
        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);
        win.closed = true;

        // When: its ACCEPTED lands unattributed.
        accept(null, BUYER);

        // Then: it was still recognised, so its own poll does not later bill a
        // second decrement as an abandon.
        expect(soleTrader.soleTraderReconfirmingCount).toBe(0);
        jest.advanceTimersByTime(300);
        expect(soleTrader.soleTraderReconfirmingCount).toBe(0);
        jest.useRealTimers();
      });
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

    describe("item 3 — the gap above the link (live-reported by Doug)", () => {
      // Same box-model stack as `.twoinc-company-summary`'s own gap fix
      // (a3fd6e8): `#billing_company_display_field`'s 15px padding-bottom
      // plus WooCommerce core's own `.form-row` bottom margin, cancelled on
      // whichever element actually lands after that field via the adjacent-
      // sibling selector `placeDifferentSoleTraderBtn()` inserts it with.
      test("a scoped negative margin-top cancels the field's own padding-bottom + core's form-row margin", () => {
        const rule =
          /#billing_company_display_field \+ #select_different_sole_trader_btn,\s*\.twoinc-inp-container \+ #select_different_sole_trader_btn\s*\{([^}]*)\}/.exec(
            stylesheetSource()
          );

        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/margin-top:\s*-\d+px/);
      });

      test("never doubles up with the summary's own cancellation — the two never show for the same field", () => {
        // syncDifferentSoleTraderLink()'s gate and renderCompanySummary()'s
        // are mode-exclusive (sole_trader vs registered-search), so a real
        // checkout can show at most one of the two negative margins against
        // a given field, never both stacked on top of each other.
        soleTrader.mode = "sole_trader";
        $("#company_id").val("TWO:ST12345");
        soleTrader.syncDifferentSoleTraderLink();

        expect($(".twoinc-company-summary").length).toBe(0);
      });
    });

    describe("item 2 — a sole trader restored by loadUserMetaInputs (live-reported by Doug)", () => {
      // The regression: `loadUserMetaInputs()` (a returning buyer's LAST
      // captured company, restored from user meta) writes straight through
      // `twoincCompanyCapture.write()`, never through `setCompany()` — the
      // only place `mode`/`soleTraderAdopted` get set and the link gets
      // synced. The company populated correctly; the link just never
      // appeared, and a re-signup completing later would have been silently
      // dropped by `bindPopupMessageListener`'s own `mode !== "sole_trader"`
      // gate.
      test("a restored TWO:-prefixed id shows the link", () => {
        ctx.twoinc.billing_company = "A Sole Trader";
        ctx.twoinc.company_id = "TWO:ST12345";

        ctx.dom.loadUserMetaInputs();

        expect(soleTrader.mode).toBe("sole_trader");
        expect(soleTrader.soleTraderAdopted).toBe(true);
        expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).not.toBe("none");
      });

      test("a restored ORDINARY registry number leaves sole-trader mode untouched", () => {
        ctx.twoinc.billing_company = "ACME Widgets Ltd";
        ctx.twoinc.company_id = "12345678";

        ctx.dom.loadUserMetaInputs();

        expect(soleTrader.mode).toBe("business");
        expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).toBe("none");
      });

      // The user-meta echo exists only for a signed-in WordPress user, so for a
      // GUEST — whose company reaches the DOM by WooCommerce's own rendered
      // value or by loadStorageInputs() — the restore above was skipped whole,
      // its own DOM fallback included. Live-confirmed by Doug: both echo
      // properties `undefined` on a checkout whose `#company_id` already held a
      // restored `TWO:…` id.
      describe("no user-meta echo — the guest / session-restore case", () => {
        beforeEach(() => {
          delete ctx.twoinc.billing_company;
          delete ctx.twoinc.company_id;
        });

        test("a DOM-restored TWO:-prefixed id shows the link", () => {
          $("#billing_company").val("A Sole Trader");
          $("#company_id").val("TWO:ST12345");

          ctx.dom.loadUserMetaInputs();

          expect(soleTrader.mode).toBe("sole_trader");
          expect(soleTrader.soleTraderAdopted).toBe(true);
          expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).not.toBe("none");
        });

        test("a DOM-restored ORDINARY registry number is captured, not adopted", () => {
          // Captured all the same: the pairing tag is what stops the retype
          // guard wiping a perfectly good restored number (TWO-40 §5), and a
          // guest had no path to one before. The sole-trader state is what a
          // registry number must NOT acquire.
          $("#billing_company").val("ACME Widgets Ltd");
          $("#company_id").val("12345678");

          ctx.dom.loadUserMetaInputs();

          expect(ctx.capture.isPluginWritten($("#company_id"))).toBe(true);
          expect(soleTrader.mode).toBe("business");
          expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).toBe("none");
        });

        test("an empty form restores nothing", () => {
          ctx.dom.loadUserMetaInputs();

          expect(ctx.capture.isPluginWritten($("#company_id"))).toBe(false);
          expect(soleTrader.mode).toBe("business");
        });

        test("a name with no number is left as the buyer's own", () => {
          // initialize() runs on the first re-render that makes this gateway
          // visible, which can be after the buyer has typed — and a name with
          // no number is exactly what manual entry looks like mid-keystroke.
          // Stamping provenance on it would let a later country switch clear it
          // as a value this plugin had written.
          $("#billing_company").val("Buyer's Own Ltd");

          ctx.dom.loadUserMetaInputs();

          expect($("#billing_company").val()).toBe("Buyer's Own Ltd");
          expect(ctx.capture.isPluginWritten($("#billing_company"))).toBe(false);
        });

        test("the storage pass's own values are restored too", () => {
          // loadStorageInputs() runs AFTER the user-meta pass and assigns both
          // fields with a bare `.val()`, so on a guest checkout it is the pass
          // that supplies the pair — and the one restoreCapturedCompany() has
          // to see.
          ctx.dom.loadUserMetaInputs();
          $("#billing_company").val("A Sole Trader");
          $("#company_id").val("TWO:ST12345");

          ctx.dom.restoreCapturedCompany();

          expect(soleTrader.mode).toBe("sole_trader");
          expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).not.toBe("none");
        });
      });

      test.each([
        [
          "the echo wins outright when it holds the number",
          { metaName: "ACME Widgets Ltd", metaId: "12345678" },
          { name: "A Sole Trader", id: "TWO:ST12345" },
          { name: "ACME Widgets Ltd", id: "12345678", mode: "business" }
        ],
        [
          "a name-only echo does not steal the DOM's number",
          { metaName: "ACME Widgets Ltd", metaId: undefined },
          { name: "A Sole Trader", id: "TWO:ST12345" },
          { name: "A Sole Trader", id: "TWO:ST12345", mode: "sole_trader" }
        ]
      ])(
        "a DISAGREEING restore is taken whole from one source — %s",
        (_description, echo, dom, expected) => {
          // Otherwise the pairing tag describes a company that never existed —
          // one restore's name against another's number — and the retype
          // guard, which compares the live fields against that tag, is reading
          // a fiction.
          ctx.twoinc.billing_company = echo.metaName;
          ctx.twoinc.company_id = echo.metaId;
          $("#billing_company").val(dom.name);
          $("#company_id").val(dom.id);

          ctx.dom.loadUserMetaInputs();

          expect($("#billing_company").val()).toBe(expected.name);
          expect($("#company_id").val()).toBe(expected.id);
          expect(soleTrader.mode).toBe(expected.mode);
        }
      );
    });
  });

  describe("§8 — identity trust levels", () => {
    // Delivers a hosted-signup postMessage the way the popup does.
    function postFromSignup(data) {
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: data,
          origin: "https://checkout.example.test"
        })
      );
    }

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
    });

    test("a completed signup that resolves no buyer at all surfaces the error", () => {
      // The authenticated path trusts the server, which means it also has to
      // handle the server having nothing — otherwise this branch silently does
      // nothing and the buyer is left staring at an unchanged checkout.
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
    describe("a chip click resolves to the popup, never a note", () => {
      /**
       * The note is the browser-blocked-popup fallback ONLY — never an outcome
       * the chip click itself chooses. Asserted against a note that exists:
       * `hasClass()` on an empty set reads back `false`, so a test that skips
       * `render()` passes whatever the code does.
       */
      function expectNoNote() {
        const $note = $(".twoinc-sole-trader-note");
        expect($note).toHaveLength(1);
        expect($note.hasClass("hidden")).toBe(true);
      }

      /**
       * The chip ALWAYS opens the hosted signup and populates nothing itself,
       * whatever the email field happens to hold (Doug 2026-08-21: a company
       * may only ever be filled in by the buyer's own trip through that flow,
       * so this chip has no conditional fast path — WC behaving as PrestaShop
       * does). Every row here used to resolve differently, off a passive
       * email-driven autofill probe against the Two session cookie; the first
       * one adopted a company outright with no popup at all.
       */
      test.each([
        ["an email Two recognises", "buyer@example.test"],
        ["an email Two does not recognise", "stranger@example.test"],
        ["no email entered at all", ""]
      ])("opens the popup and writes nothing — %s", (_description, email) => {
        soleTrader.render();
        $("#billing_email").val(email);

        soleTrader.onModeChipClick("sole_trader");

        expect(opened).toHaveLength(1);
        expect($("#company_id").val()).toBe("");
        expectNoNote();
      });

      test("a bare email change, with no click near the company field, adopts nothing", () => {
        // Through the REAL checkout wiring — `initialize()` is where an
        // email-driven handler would be bound, so a test that skips it would
        // pass whatever the code does.
        $("form[name='checkout']").after('<div id="order_review"></div>');
        ctx.Twoinc.getInstance().initialize(false);
        soleTrader.render();
        const write = jest.spyOn(ctx.capture, "write");

        $("#billing_email").val("buyer@example.test").trigger("change");

        expect(soleTrader.mode).toBe("business");
        expect(opened).toHaveLength(0);
        expect(write).not.toHaveBeenCalled();
        expect($("#company_id").val()).toBe("");
      });

      test("render() mints up front, so the chip click has tokens to open with", () => {
        // The reported defect end to end. `window.open()` has to run inside
        // the click's own gesture, so the mint must already have landed —
        // hence the up-front one, not one started by the click.
        soleTrader.tokens = null;
        jest.spyOn(soleTrader, "fetchTokens").mockImplementation(() => {
          soleTrader.tokens = {
            delegation_token: "delegation",
            autofill_token: "autofill",
            signup_url: "https://checkout.example.test/soletrader/signup"
          };
        });

        soleTrader.render();
        expect(soleTrader.fetchTokens).toHaveBeenCalled();

        soleTrader.onModeChipClick("sole_trader");

        expect(opened).toHaveLength(1);
        expect(opened[0].url).toContain("businessToken=delegation");
        expectNoNote();
      });

      test("a re-render does not mint a second, concurrent set of tokens", () => {
        // Two POSTs racing each other's write to `.tokens`. `render()` runs on
        // every `updated_checkout`.
        jest.spyOn(soleTrader, "fetchTokens").mockImplementation(() => {});

        soleTrader.render();
        soleTrader.render();

        expect(soleTrader.fetchTokens).not.toHaveBeenCalled();
      });

      test("tokens that could not be minted at all leave only the signup link", () => {
        // The one remaining case with no popup to offer: without tokens there
        // is no signup URL to open. Asserted through `openPopup` so this
        // cannot pass by never reaching signup at all.
        jest.spyOn(soleTrader, "fetchTokens").mockImplementation((cb) => {
          if (cb) cb(false);
        });
        soleTrader.render();
        soleTrader.tokens = null;
        $("#billing_email").val("");
        jest.spyOn(soleTrader, "openPopup");

        soleTrader.onModeChipClick("sole_trader");

        expect(soleTrader.openPopup).toHaveBeenCalled();
        expect(soleTrader.openPopup).toHaveReturnedWith(null);
        expect(opened).toHaveLength(0);
        expect($(".twoinc-sole-trader-note").hasClass("hidden")).toBe(false);
      });
    });

    describe("bug 2 — the search dropdown stays visible with a spinner until the popup closes", () => {
      test("dropdown survives the mode switch, with nothing adopted yet", () => {
        const $widget = harness.openCompanyWidget($, ctx.helper);

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

      test("the spinner is up for as long as the popup is open, and comes down when it closes", () => {
        harness.openCompanyWidget($, ctx.helper);
        soleTrader.setMode("sole_trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        jest.useFakeTimers();

        soleTrader.launchSignup();
        expect($(".twoinc-sole-trader-spinner").length).toBe(1);

        win.closed = true;
        jest.advanceTimersByTime(300);

        expect($(".twoinc-sole-trader-spinner").length).toBe(0);
        jest.useRealTimers();
      });

      /**
       * "Flow complete" is the WRITE, not the popup closing and not the
       * response landing (Doug 2026-08-20). The ordinary path is the one that
       * proves it: the hosted flow closes its own window the instant it posts
       * ACCEPTED, so the popup is long gone by the time `fetchCurrentBuyer`
       * resolves — and this used to settle the flight before the company name
       * and number were written, so the spinner came down over empty fields.
       */
      test("the spinner outlives the popup close, coming down only once the company is written", () => {
        harness.openCompanyWidget($, ctx.helper);
        soleTrader.setMode("sole_trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        let resolveBuyer;
        jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) => {
          resolveBuyer = cb;
        });
        // Read INSIDE the write, not after it: settling one line early leaves
        // the same end state, so only the state at the moment of the write
        // tells the two orderings apart.
        let spinnerAtWrite = null;
        const setCompany = soleTrader.setCompany;
        jest.spyOn(soleTrader, "setCompany").mockImplementation((...args) => {
          spinnerAtWrite = $(".twoinc-sole-trader-spinner").length;
          return setCompany(...args);
        });
        jest.useFakeTimers();
        soleTrader.launchSignup();
        soleTrader.bindPopupMessageListener();

        // The popup posts ACCEPTED and closes in the same breath.
        window.dispatchEvent(
          new MessageEvent("message", {
            data: "ACCEPTED",
            origin: "https://checkout.example.test",
            source: win
          })
        );
        win.closed = true;
        jest.advanceTimersByTime(300);

        // Popup closed — but the lookup it triggered has not come back, so
        // nothing is captured yet and the flow is NOT complete.
        expect($("#company_id").val()).toBe("");
        expect($(".twoinc-sole-trader-spinner").length).toBe(1);

        resolveBuyer({
          organization_number: "TWO:ST1",
          company_name: "A Sole Trader",
          email: "buyer@example.test"
        });

        expect(spinnerAtWrite).toBe(1);
        expect($("#company_id").val()).toBe("TWO:ST1");
        expect($("#billing_company").val()).toBe("A Sole Trader");
        expect($(".twoinc-sole-trader-spinner").length).toBe(0);
        jest.useRealTimers();
      });

      test("the dropdown the chip was clicked from is closed once the flow completes", () => {
        const $widget = harness.openCompanyWidget($, ctx.helper);
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        jest.useFakeTimers();

        // A re-signup from an adopted state: nothing else in this path reverts
        // mode or re-attaches the widget, so the dropdown would otherwise be
        // left open on a query row that is hidden and chips that are settled.
        soleTrader.launchSignup({ autoselect: false });
        $widget.select2("open");
        expect($widget.data("select2").isOpen()).toBe(true);

        win.closed = true;
        jest.advanceTimersByTime(300);

        expect($widget.data("select2").isOpen()).toBe(false);
        jest.useRealTimers();
      });

      test("the link's own flow completes with no dropdown to close, and does not fail trying", () => {
        // The one genuine difference between the two entry points: this one is
        // clicked with nothing open. The close is conditional, so it is a
        // no-op here rather than a second code path.
        harness.openCompanyWidget($, ctx.helper);
        const $widget = $("#billing_company_display");
        $widget.select2("close");
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        jest.useFakeTimers();

        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
        expect($(".twoinc-sole-trader-spinner").length).toBe(1);

        win.closed = true;
        jest.advanceTimersByTime(300);

        expect($widget.data("select2").isOpen()).toBe(false);
        expect($(".twoinc-sole-trader-spinner").length).toBe(0);
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

    /**
     * Doug 2026-08-20, live: the buyer clicks back onto the checkout page
     * without finishing the hosted signup. The popup stayed up, the dropdown
     * stayed open and the spinner kept animating over a flow they had walked
     * away from.
     */
    describe("focus returning to the checkout abandons an outstanding signup popup", () => {
      function fakePopup() {
        const win = { closed: false };
        win.close = jest.fn(() => {
          win.closed = true;
        });
        return win;
      }

      // Fires the window-level `focus` a real refocus produces. Deliberately NOT
      // followed by the grace period — the click that caused the focus is
      // dispatched inside it, which is the whole point of the deferral, so every
      // test spends the grace explicitly with `settleRefocus()`.
      function refocusCheckout() {
        window.dispatchEvent(new Event("focus"));
      }

      // Lets the refocus's own deferred abandon fall due.
      function settleRefocus() {
        jest.advanceTimersByTime(soleTrader.refocusChipGraceMs);
      }

      // Mousedown a real chip, the way the browser dispatches it after handing
      // the checkout window its focus back. Real DOM and real bubbling: the
      // listener that reads this is a capture-phase one on `document`, so a
      // detached chip built with `buildBusinessChip()` would never reach it.
      function mousedownChip(id) {
        const chip = document.getElementById(id);
        expect(chip).not.toBeNull();
        chip.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
      }

      // The chips live in the dropdown panel, built on open.
      function openWidgetWithChips() {
        const $widget = harness.openCompanyWidget($, ctx.helper);
        ctx.helper.syncManualEntryButton();
        return $widget;
      }

      function dropdownQueryField() {
        return $("#select2-billing_company_display-results")
          .closest(".select2-dropdown")
          .find(".select2-search--dropdown")
          .first()
          .find(".select2-search__field");
      }

      test("closes the popup, and the existing poll then settles spinner, dropdown and mode", () => {
        const $widget = openWidgetWithChips();
        soleTrader.setMode("sole_trader");
        const win = fakePopup();
        window.open = jest.fn(() => win);
        jest.useFakeTimers();
        soleTrader.launchSignup();
        expect($(".twoinc-sole-trader-spinner").length).toBe(1);

        refocusCheckout();
        settleRefocus();

        // Closing the window is the WHOLE action on this path: the popup-close
        // poll stays the single owner of the spinner, the mode revert and the
        // dropdown close, so nothing here has to agree with it about
        // `flightDepth`.
        expect(win.close).toHaveBeenCalledTimes(1);
        expect($(".twoinc-sole-trader-spinner").length).toBe(1);

        jest.advanceTimersByTime(300);

        expect($(".twoinc-sole-trader-spinner").length).toBe(0);
        expect($widget.data("select2").isOpen()).toBe(false);
        expect(soleTrader.mode).toBe("business");
        jest.useRealTimers();
      });

      /**
       * A native element `focus` never reaches a non-capturing window listener,
       * but jQuery's `.trigger("focus")` walks the propagation path itself,
       * window included — and that is how this file moves focus onto the
       * company fields everywhere. Without the handler's target check, simply
       * opening the dropdown would close the buyer's popup.
       */
      test("focus moving between fields on the page is not a refocus", () => {
        openWidgetWithChips();
        soleTrader.setMode("sole_trader");
        const win = fakePopup();
        window.open = jest.fn(() => win);
        jest.useFakeTimers();
        soleTrader.launchSignup();

        $("#billing_email").trigger("focus");
        ctx.helper.openCompanySearchDropdown();
        settleRefocus();

        expect(win.close).not.toHaveBeenCalled();
        jest.useRealTimers();
      });

      /**
       * A popup whose ACCEPTED resolved to no buyer is decided yet still very
       * much on screen, and the buyer's retry inside it posts a second
       * ACCEPTED (see `watchPopupClose`'s own comment). Closing that window
       * would take the retry with it.
       */
      test("a decided popup that is still open is left alone", () => {
        openWidgetWithChips();
        soleTrader.setMode("sole_trader");
        const win = fakePopup();
        window.open = jest.fn(() => win);
        jest.useFakeTimers();
        soleTrader.launchSignup();
        soleTrader.activePopupWatchers[0].decided = true;

        refocusCheckout();
        settleRefocus();

        expect(win.close).not.toHaveBeenCalled();
        jest.useRealTimers();
      });

      test("a refocus with nothing outstanding does nothing at all", () => {
        openWidgetWithChips();
        soleTrader.setMode("sole_trader");
        jest.useFakeTimers();

        refocusCheckout();
        settleRefocus();

        expect(soleTrader.mode).toBe("sole_trader");
        expect(opened).toHaveLength(0);
        jest.useRealTimers();
      });

      /**
       * Case (c), the control: the buyer came back by clicking somewhere on the
       * page that is not a mode chip. Nothing about the chips is involved and
       * the popup goes, exactly as it did before the chips were considered at
       * all.
       */
      test("clicking the page outside the chips closes the popup with no chip side effects", () => {
        const $widget = openWidgetWithChips();
        soleTrader.setMode("sole_trader");
        const win = fakePopup();
        window.open = jest.fn(() => win);
        jest.useFakeTimers();
        soleTrader.launchSignup();

        refocusCheckout();
        document
          .getElementById("billing_email")
          .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
        settleRefocus();

        expect(win.close).toHaveBeenCalledTimes(1);
        // Nothing has run the chip path's synchronous drain, so the popup's own
        // poll still owns every settle and none of them has happened yet.
        expect(soleTrader.mode).toBe("sole_trader");
        expect($(".twoinc-sole-trader-spinner").length).toBe(1);

        jest.advanceTimersByTime(300);

        expect(soleTrader.mode).toBe("business");
        expect($widget.data("select2").isOpen()).toBe(false);
        expect($(".twoinc-sole-trader-spinner").length).toBe(0);
        jest.useRealTimers();
      });

      /**
       * Item 6.1, Doug's spec revision: the Sole trader chip is the ONE
       * exception to the abandon. Re-clicking the chip that launched the popup
       * asks for that popup back, so it is raised rather than closed and the
       * flow it is halfway through survives.
       */
      test("the Sole trader chip keeps the popup and raises it instead", () => {
        const $widget = openWidgetWithChips();
        soleTrader.setMode("sole_trader");
        const win = fakePopup();
        win.focus = jest.fn();
        window.open = jest.fn(() => win);
        jest.useFakeTimers();
        soleTrader.launchSignup();

        refocusCheckout();
        mousedownChip(ctx.helper.soleTraderChipId);
        $("#" + ctx.helper.soleTraderChipId).trigger("click");
        settleRefocus();
        jest.advanceTimersByTime(300);

        expect(win.close).not.toHaveBeenCalled();
        expect(win.focus).toHaveBeenCalled();
        // No second window, and the wait the buyer is still in is intact.
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(soleTrader.mode).toBe("sole_trader");
        expect($widget.data("select2").isOpen()).toBe(true);
        expect($(".twoinc-sole-trader-spinner").length).toBe(1);
        jest.useRealTimers();
      });

      /**
       * The same exception from an already-adopted state, where the chip's
       * other meaning is a deliberate re-signup ("select a different sole
       * trader"). An outstanding popup still wins: launching a second one over
       * it is what TWO-40 §14 spent four rounds removing.
       */
      test("the Sole trader chip raises an outstanding re-signup rather than launching another", () => {
        harness.openCompanyWidget($, ctx.helper);
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");
        // Chips built AFTER the adoption: it closes the dropdown panel they
        // live in, and this flow's entry point is the buyer reopening it.
        $("#billing_company_display").select2("open");
        ctx.helper.syncManualEntryButton();
        const first = fakePopup();
        first.focus = jest.fn();
        window.open = jest.fn(() => first);
        jest.useFakeTimers();
        soleTrader.launchSignup({ autoselect: false });

        refocusCheckout();
        const relaunch = jest.fn(() => fakePopup());
        window.open = relaunch;
        mousedownChip(ctx.helper.soleTraderChipId);
        $("#" + ctx.helper.soleTraderChipId).trigger("click");
        settleRefocus();

        expect(relaunch).not.toHaveBeenCalled();
        expect(first.close).not.toHaveBeenCalled();
        expect(first.focus).toHaveBeenCalled();
        jest.useRealTimers();
      });

      /**
       * Item 6.2, the Registered company half: the popup closes AND the chip
       * does its own ordinary job on top of that. Both effects, because the
       * abandon runs in the chip's `mousedown` and deliberately leaves the mode
       * and the dropdown to the chip — reverting to business here would make
       * the chip's own "already in business mode" no-op swallow the click, and
       * closing the dropdown would destroy the chip before its `click` fired.
       */
      test("the Registered company chip closes the popup AND shows and focuses the query field", () => {
        const $widget = openWidgetWithChips();
        soleTrader.setMode("sole_trader");
        const win = fakePopup();
        window.open = jest.fn(() => win);
        jest.useFakeTimers();
        soleTrader.launchSignup();

        refocusCheckout();
        mousedownChip(ctx.helper.businessChipId);
        expect(win.close).toHaveBeenCalledTimes(1);
        $("#" + ctx.helper.businessChipId).trigger("click");
        settleRefocus();
        jest.advanceTimersByTime(300);

        expect(soleTrader.mode).toBe("business");
        expect($widget.data("select2").isOpen()).toBe(true);
        expect(dropdownQueryField().closest(".select2-search--dropdown").attr("hidden")).toBe(
          undefined
        );
        expect(document.activeElement).toBe(dropdownQueryField()[0]);
        expect($(".twoinc-sole-trader-spinner").length).toBe(0);
        jest.useRealTimers();
      });

      /**
       * Item 6.2, the Enter manually half. Its own ordinary behaviour, whole:
       * the dropdown goes, the capture mode becomes manual, and focus lands in
       * the now-editable native company field.
       */
      test("the Enter manually chip closes the popup AND switches to manual entry", () => {
        openWidgetWithChips();
        soleTrader.setMode("sole_trader");
        const win = fakePopup();
        window.open = jest.fn(() => win);
        jest.useFakeTimers();
        soleTrader.launchSignup();

        refocusCheckout();
        mousedownChip(ctx.helper.manualEntryRowId);
        expect(win.close).toHaveBeenCalledTimes(1);
        $("#" + ctx.helper.manualEntryRowId).trigger("click");
        jest.runAllTimers();

        expect(soleTrader.mode).toBe("business");
        expect(ctx.capture.mode).toBe("manual");
        expect(ctx.helper.companySearchDropdownIsOpen()).toBe(false);
        expect($("#billing_company_field").hasClass("hidden")).toBe(false);
        expect(document.activeElement).toBe($("#billing_company")[0]);
        jest.useRealTimers();
      });

      /**
       * The stale-claim guard. A chip mousedown made while the checkout ALREADY
       * had focus is not the cause of any refocus, so it must not be read as
       * one — neither now (the popup is left entirely alone) nor later, by a
       * genuine alt-tab-back that follows it.
       */
      test("a chip mousedown with no refocus pending leaves the popup alone", () => {
        openWidgetWithChips();
        soleTrader.setMode("sole_trader");
        const win = fakePopup();
        window.open = jest.fn(() => win);
        jest.useFakeTimers();
        soleTrader.launchSignup();

        mousedownChip(ctx.helper.businessChipId);
        expect(win.close).not.toHaveBeenCalled();

        // And the later genuine refocus still abandons, rather than being
        // cancelled by that earlier, unrelated mousedown.
        refocusCheckout();
        settleRefocus();

        expect(win.close).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
      });

      /**
       * A mousedown that never becomes a click — the buyer drags off the chip,
       * or it is torn out mid-gesture. The Sole trader chip's cancel is the
       * whole of its own contribution, so the popup simply stays up, which is
       * the state that branch exists to preserve anyway.
       */
      test("a Sole trader chip mousedown that never becomes a click still keeps the popup", () => {
        openWidgetWithChips();
        soleTrader.setMode("sole_trader");
        const win = fakePopup();
        window.open = jest.fn(() => win);
        jest.useFakeTimers();
        soleTrader.launchSignup();

        refocusCheckout();
        mousedownChip(ctx.helper.soleTraderChipId);
        settleRefocus();
        jest.advanceTimersByTime(300);

        expect(win.close).not.toHaveBeenCalled();
        expect(soleTrader.mode).toBe("sole_trader");
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

      /**
       * TWO-40 §7 direction (a), PR 1 of 2: `lockCapturedFields()` used to
       * destroy the select2 widget outright the moment a sole trader was
       * adopted. It now leaves the same instance alive (closed and hidden
       * behind the locked native fields) for as long as the buyer stays
       * adopted — `reopenSearch()`'s own `setMode("business")` is still what
       * tears it down and rebuilds a fresh one on the way OUT, unchanged; see
       * that block's own comment. This locks in only the adoption half.
       */
      test("adopting a sole trader leaves its search widget instance alive rather than destroying it", () => {
        soleTrader.setMode("sole_trader");
        const $display = $("#billing_company_display");
        const widgetBeforeAdoption = $display.data("select2");

        soleTrader.setCompany("TWO:ST1", "A Sole Trader");

        expect($display.data("select2")).toBe(widgetBeforeAdoption);
        expect(widgetBeforeAdoption.isOpen()).toBe(false);
      });

      test("clicking #company_id after adoption does the same", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");

        $("#company_id").trigger("click");

        expect(soleTrader.mode).toBe("business");
      });

      test("clicking a picked REGISTERED company reopens the dropdown too", () => {
        // Registered-company reopen is the picker's own open-on-click, not a
        // plugin handler — so what this locks in is the plugin-owned
        // precondition for it: business mode must leave the widget live and
        // the field unlocked after a pick, unlike an adopted sole trader.
        const ajax = harness.stubAjax($);
        const $widget = harness.openCompanyWidget($, ctx.helper);
        $widget.trigger({
          type: "select2:select",
          params: { data: { id: "A Registered Co", company_id: "12345678" } }
        });
        $widget.select2("close");
        expect($widget.data("select2").isOpen()).toBe(false);
        expect($("#company_id").val()).toBe("12345678");

        // `which: 1` deliberately: the picker's own open-on-click handler
        // early-returns on anything but a primary button, so a bare
        // `trigger("mousedown")` never reaches it.
        $("#billing_company_display_field .select2-selection").trigger({
          type: "mousedown",
          which: 1
        });

        expect($widget.data("select2").isOpen()).toBe(true);
        expect($("#billing_company").prop("readonly")).toBe(false);
        expect($("#billing_company_display").prop("disabled")).toBe(false);
        ajax.restore();
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

      describe("TWO-40 §7 direction (a) — an adopted sole trader displays through the live widget", () => {
        beforeEach(() => {
          // `toggleBusinessFields()`'s isTwoincSelected branch — where the
          // widget-vs-native-field decision actually lives — reads a real
          // checked `payment_method` radio; `buildForm()` carries none,
          // since no other test in this file asserts field visibility.
          $(
            '<input type="radio" name="payment_method" value="' +
              ctx.twoinc.gateway_id +
              '" checked />'
          ).appendTo("form[name='checkout']");
        });

        test("with company search enabled, adoption shows the search widget itself, not the native field, seeded with the sole trader's own selection", () => {
          soleTrader.setMode("sole_trader");
          soleTrader.setCompany("TWO:ST1", "A Sole Trader");

          expect($("#billing_company_display_field").hasClass("hidden")).toBe(false);
          expect($("#billing_company_field").hasClass("hidden")).toBe(true);
          expect($("#billing_company_display").val()).toBe("TWO:ST1");
          expect($("#billing_company_display").find('option[value="TWO:ST1"]').text()).toBe(
            "A Sole Trader"
          );
        });

        test("picking a different company directly off the still-open widget leaves sole-trader mode and writes the new pick, without destroying the widget", () => {
          soleTrader.setMode("sole_trader");
          soleTrader.setCompany("TWO:ST1", "A Sole Trader");
          const $display = $("#billing_company_display");
          const widgetInstance = $display.data("select2");

          $display.trigger({
            type: "select2:select",
            params: { data: { id: "A Registered Co", company_id: "12345678" } }
          });

          expect(soleTrader.mode).toBe("business");
          expect(soleTrader.soleTraderAdopted).toBe(false);
          expect($("#company_id").val()).toBe("12345678");
          expect($("#billing_company").val()).toBe("A Registered Co");
          // Same instance throughout — a pick made off the live widget must
          // never trigger the destroy/rebuild `setMode("business")`'s OWN
          // branch does on the way out via reopenSearch/the Business chip;
          // doing so here would blank the very pick this test just made.
          expect($display.data("select2")).toBe(widgetInstance);
        });

        test("a pick landing while still genuinely deciding (signup undecided) is refused, not silently adopted", () => {
          const flight = armUndecidedSignup();
          soleTrader.onModeChipClick("sole_trader");
          expect(soleTrader.isDeciding()).toBe(true);

          $("#billing_company_display").trigger({
            type: "select2:select",
            params: { data: { id: "A Registered Co", company_id: "12345678" } }
          });

          expect(soleTrader.mode).toBe("sole_trader");
          expect($("#company_id").val()).toBe("");

          flight.settle({
            organization_number: "TWO:ST1",
            company_name: "Sole Co",
            email: "buyer@example.test"
          });
          expect($("#company_id").val()).toBe("TWO:ST1");
        });

        test("a merchant who relocated the control to the payment tile shows the adoption through the widget there, native field alongside", () => {
          // Replaces an "enable_company_search: no" case (#486). There is no
          // such state: the admin checkbox only ever RELOCATES the one search
          // control (TWO-25326 §7.1), so the adopted sole trader shows through
          // the widget either way — and in tile placement WooCommerce's own
          // native field deliberately stays in the address area alongside it,
          // rather than the two swapping.
          ctx.twoinc.company_search_location = "payment_tile";

          soleTrader.setMode("sole_trader");
          soleTrader.setCompany("TWO:ST1", "A Sole Trader");

          expect($("#billing_company_display_field").hasClass("hidden")).toBe(false);
          expect($("#billing_company_field").hasClass("hidden")).toBe(false);
          expect($("#billing_company").prop("readonly")).toBe(true);
        });

        describe("item 4.2 / item 2.1 — the dropdown's own free-text query is suppressed for the whole of sole-trader mode", () => {
          /** @returns {Object} jQuery-wrapped `.select2-search--dropdown` row */
          function queryRow() {
            return $("#select2-billing_company_display-results")
              .closest(".select2-dropdown")
              .find(".select2-search--dropdown")
              .first();
          }

          /** @returns {Object} jQuery-wrapped query input inside that row */
          function queryField() {
            return queryRow().find(".select2-search__field");
          }

          test("reopening the widget after adoption leaves its search input readonly", () => {
            soleTrader.setMode("sole_trader");
            soleTrader.setCompany("TWO:ST1", "A Sole Trader");
            const $display = $("#billing_company_display");

            $display.select2("open");

            expect($display.data("select2").isOpen()).toBe(true);
            expect(
              $('input[aria-owns="select2-billing_company_display-results"]').prop("readonly")
            ).toBe(true);
          });

          /**
           * Item 2.1, live-reported by Doug: "the field should not be
           * VISIBLE. I did not tell you it was editable, I told you it was
           * visible." Readonly alone reads as a search box that has stopped
           * working.
           */
          test("the whole query row is hidden, not merely readonly", () => {
            soleTrader.setMode("sole_trader");
            soleTrader.setCompany("TWO:ST1", "A Sole Trader");

            $("#billing_company_display").select2("open");

            expect(queryRow().attr("hidden")).toBe("hidden");
            expect(queryRow().css("display")).toBe("none");
          });

          /**
           * `display: none` and the `hidden` attribute, not
           * `visibility`/`opacity`: only the former take the input out of the
           * tab order. selectWoo's own open handler sets `tabindex="0"` on it
           * unconditionally, so the hide is the ONLY thing keeping a
           * keyboard-only buyer off a field they cannot see — asserted here so
           * a later switch to a paint-only mechanism cannot pass.
           */
          test("the hidden query field is out of the tab order, not just unpainted", () => {
            soleTrader.setMode("sole_trader");
            soleTrader.setCompany("TWO:ST1", "A Sole Trader");

            $("#billing_company_display").select2("open");

            expect(queryField().attr("tabindex")).toBe("0");
            expect(queryRow().css("display")).toBe("none");
          });

          test("a term typed before adopting is dropped rather than left above stale results", () => {
            const $display = $("#billing_company_display");
            $display.select2("open");
            queryField().val("some other company");

            soleTrader.setMode("sole_trader");
            soleTrader.setCompany("TWO:ST1", "A Sole Trader");
            $display.select2("open");

            expect(queryField().val()).toBe("");
          });

          test("an ordinary (non-adopted) open leaves the search input typable and visible", () => {
            const $display = $("#billing_company_display");

            $display.select2("open");

            expect(
              $('input[aria-owns="select2-billing_company_display-results"]').prop("readonly")
            ).toBe(false);
            expect(queryRow().attr("hidden")).toBeUndefined();
            expect(queryRow().css("display")).not.toBe("none");
          });

          test('the row is visible and typable again once "Registered company" is clicked', () => {
            soleTrader.setMode("sole_trader");
            soleTrader.setCompany("TWO:ST1", "A Sole Trader");
            jest.useFakeTimers();
            $("#billing_company_display").select2("open");
            // The chip group is appended a tick after `select2:open` — see
            // bindManualEntryAffordance's own comment.
            jest.advanceTimersByTime(1);
            expect(queryRow().css("display")).toBe("none");

            $("#" + ctx.helper.businessChipId).trigger("click");
            $("#billing_company_display").select2("open");
            jest.advanceTimersByTime(1);
            jest.useRealTimers();

            expect(soleTrader.mode).toBe("business");
            expect(queryRow().attr("hidden")).toBeUndefined();
            expect(queryRow().css("display")).not.toBe("none");
            expect(queryField().prop("readonly")).toBe(false);
          });

          /**
           * Doug 2026-08-20, live: the row-visibility half already worked, but
           * the dropdown closed anyway — `setMode("business")` destroys this
           * widget and re-attaches a fresh, CLOSED one, so the chip the buyer
           * clicked took the whole panel down and the un-hidden row was on a
           * dropdown that no longer existed.
           */
          test("clicking Registered company leaves the dropdown open with focus in the query field", () => {
            harness.openCompanyWidget($, ctx.helper);
            // Stubbed for the same reason the Sole trader chip test below stubs
            // it: this click's other outcome is a popup, whose own flight would
            // keep `isDeciding()` true and make the Business chip a no-op.
            jest.spyOn(soleTrader, "launchSignup").mockImplementation(() => {});
            ctx.helper.buildSoleTraderChip().trigger("click");
            expect(queryRow().attr("hidden")).toBe("hidden");

            ctx.helper.buildBusinessChip().trigger("click");

            expect(soleTrader.mode).toBe("business");
            expect(ctx.helper.companySearchDropdownIsOpen()).toBe(true);
            expect(queryRow().attr("hidden")).toBeUndefined();
            expect(document.activeElement).toBe(queryField()[0]);
          });

          /**
           * The conditional half of the same fix: `setMode("business")` has
           * other callers with no dropdown in sight (`hide()` on an
           * `updated_checkout`, `watchPopupClose`'s abandon revert), and none
           * of them may pop one open at the buyer.
           */
          test("a mode revert with the dropdown already closed does not open one", () => {
            harness.openCompanyWidget($, ctx.helper);
            jest.spyOn(soleTrader, "launchSignup").mockImplementation(() => {});
            ctx.helper.buildSoleTraderChip().trigger("click");
            $("#billing_company_display").select2("close");

            ctx.helper.buildBusinessChip().trigger("click");

            expect(soleTrader.mode).toBe("business");
            expect(ctx.helper.companySearchDropdownIsOpen()).toBe(false);
          });

          /**
           * The one path that leaves sole-trader mode WITHOUT destroying the
           * widget (see the `select2:select` handler's `sole_trader` branch),
           * so it is the one where a suppression applied on a previous open
           * would otherwise never be undone — selectWoo renders this row once
           * per instance, not once per open.
           */
          test("picking a different company off the still-live widget gives the row back on the next open", () => {
            soleTrader.setMode("sole_trader");
            soleTrader.setCompany("TWO:ST1", "A Sole Trader");
            const $display = $("#billing_company_display");
            $display.select2("open");
            expect(queryRow().css("display")).toBe("none");

            $display.trigger({
              type: "select2:select",
              params: { data: { id: "A Registered Co", company_id: "12345678" } }
            });
            // The relayed `select2:select` this test fires does not drive
            // select2's own close, so the reopen needs the close first.
            $display.select2("close");
            $display.select2("open");

            expect(queryRow().attr("hidden")).toBeUndefined();
            expect(queryField().prop("readonly")).toBe(false);
          });

          /**
           * The row used to be given back for the duration of a flight, purely
           * so the spinner had somewhere to paint. Now the spinner paints over
           * the company-NAME field, so nothing about a flight makes this row
           * relevant again (Doug 2026-08-20).
           */
          test("a re-signup flight from an adopted state leaves the row hidden throughout", () => {
            soleTrader.setMode("sole_trader");
            soleTrader.setCompany("TWO:ST1", "A Sole Trader");
            $("#billing_company_display").select2("open");

            soleTrader.beginFlight();
            expect(queryRow().attr("hidden")).toBe("hidden");
            expect(queryRow().find(".twoinc-search-spinner").length).toBe(0);
            expect($(".twoinc-sole-trader-spinner").length).toBe(1);

            soleTrader.settleFlight();
            expect(queryRow().attr("hidden")).toBe("hidden");
          });

          /**
           * Doug 2026-08-20: the hide used to need a close-and-reopen, because
           * only `select2:open` re-synced it — a buyer clicking the chip with
           * the dropdown already open (which is where the chip LIVES) sat
           * looking at a search box that no longer searched for their company.
           */
          test("clicking the Sole trader chip hides the row immediately, with no reopen", () => {
            harness.openCompanyWidget($, ctx.helper);
            // Stubbed so the hide can only be the mode write's doing: this
            // click's other outcome is a popup, and a popup's own flight
            // re-syncs these surfaces too — which would let the assertion pass
            // for a reason that has nothing to do with the chip.
            jest.spyOn(soleTrader, "launchSignup").mockImplementation(() => {});
            expect(queryRow().attr("hidden")).toBeUndefined();

            ctx.helper.buildSoleTraderChip().trigger("click");

            expect(soleTrader.mode).toBe("sole_trader");
            expect(queryRow().attr("hidden")).toBe("hidden");
            expect(queryRow().css("display")).toBe("none");
          });

          test("suppression is a function of mode alone, not of what has been adopted", () => {
            harness.openCompanyWidget($, ctx.helper);

            soleTrader.setMode("sole_trader");

            expect(soleTrader.soleTraderAdopted).toBe(false);
            expect(queryRow().attr("hidden")).toBe("hidden");
          });

          test("re-clicking the chip to open a fresh re-signup goes through launchSignup, not a typed query", () => {
            soleTrader.setMode("sole_trader");
            soleTrader.setCompany("TWO:ST1", "A Sole Trader");
            const launchSpy = jest.spyOn(soleTrader, "launchSignup");

            soleTrader.onModeChipClick("sole_trader");

            expect(launchSpy).toHaveBeenCalledWith({ autoselect: false });
          });
        });
      });
    });

    describe("round-1 review regressions (Han/Vader/Leia) — races the dropdown-survives fix opened up", () => {
      test("the Business chip is refused while a signup is outstanding, not honoured then stomped by its result", () => {
        const flight = armUndecidedSignup();
        soleTrader.onModeChipClick("sole_trader");

        // The chip lives inside the search dropdown the buyer is still
        // looking at — clicking Business mid-flight used to force mode back
        // to business immediately, only for the later result to silently
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
          cb({
            organization_number: "TWO:ST1",
            company_name: "A Sole Trader",
            email: "buyer@example.test"
          })
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
          new window.MessageEvent("message", {
            data: "ACCEPTED",
            origin: "https://checkout.example.test"
          })
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
          cb({
            organization_number: "TWO:ST1",
            company_name: "A Sole Trader",
            email: "buyer@example.test"
          })
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
        const flight = armUndecidedSignup();
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

    describe("round-4 review regressions (Han/Vader) — a re-signup's own decision, not just the first one", () => {
      beforeEach(() => {
        $("form[name='checkout']").after('<div id="order_review"></div>');
        ctx.Twoinc.getInstance().initialize(false);
      });

      test("clicking a captured field while a 'select a different sole trader' popup is still open does not drop its completed signup", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "First Trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);

        // The buyer opens the re-signup popup for a different sole trader.
        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);

        // While that second popup is still open, they click the (not yet
        // re-locked) captured field instead of finishing it.
        $("#billing_company").trigger("click");
        expect(soleTrader.mode).toBe("sole_trader");

        // The second popup completes normally.
        jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) =>
          cb({
            organization_number: "TWO:ST2",
            company_name: "Second Trader",
            email: "buyer@example.test"
          })
        );
        soleTrader.bindPopupMessageListener();
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: "ACCEPTED",
            origin: "https://checkout.example.test"
          })
        );

        expect($("#company_id").val()).toBe("TWO:ST2");
        expect(soleTrader.soleTraderReconfirmingCount).toBe(0);
      });

      test("the Business chip is refused while a re-signup popup is still open, same as the first one", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "First Trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);

        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
        ctx.helper.buildBusinessChip().trigger("click");

        expect(soleTrader.mode).toBe("sole_trader");
      });

      test("soleTraderReconfirmingCount clears once the re-signup popup closes without completing", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "First Trader");
        const win = { closed: false };
        window.open = jest.fn(() => win);
        jest.useFakeTimers();

        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
        win.closed = true;
        jest.advanceTimersByTime(300);

        expect(soleTrader.soleTraderReconfirmingCount).toBe(0);
        // The original adoption is untouched — abandoning the re-signup is
        // not the same as abandoning the checkout's first sole trader.
        expect(soleTrader.mode).toBe("sole_trader");
        expect($("#company_id").val()).toBe("TWO:ST1");
        jest.useRealTimers();
      });

      test("clicking the captured field works normally once no re-signup is in flight", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "First Trader");

        $("#billing_company").trigger("click");

        expect(soleTrader.mode).toBe("business");
      });
    });

    describe("round-5/6 review regressions (Han/Vader) — soleTraderReconfirmingCount robustness", () => {
      beforeEach(() => {
        $("form[name='checkout']").after('<div id="order_review"></div>');
        ctx.Twoinc.getInstance().initialize(false);
      });

      test("a second re-signup click while one is already outstanding is refused (round-6 structural hardening), not stacked as a second popup", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "First Trader");
        jest.useFakeTimers();

        const win1 = { closed: false };
        window.open = jest.fn(() => win1);
        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);

        // A buyer retry before the first popup has closed — no second
        // window, no second increment.
        const secondOpen = jest.fn(() => ({ closed: false }));
        window.open = secondOpen;
        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
        expect(secondOpen).not.toHaveBeenCalled();
        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);

        // The one real popup's own resolution still settles it correctly.
        jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) =>
          cb({
            organization_number: "TWO:ST2",
            company_name: "Second Trader",
            email: "buyer@example.test"
          })
        );
        soleTrader.bindPopupMessageListener();
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: "ACCEPTED",
            origin: "https://checkout.example.test"
          })
        );

        expect($("#company_id").val()).toBe("TWO:ST2");
        expect(soleTrader.soleTraderReconfirmingCount).toBe(0);

        // Refused nothing it shouldn't have — retrying again now (the
        // first has fully resolved) opens a real popup.
        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);
        jest.useRealTimers();
      });

      test("editing the email while a re-signup popup is open does not reset its count out from under it (round-6, Han/Vader)", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "First Trader");
        soleTrader.availabilityByCountry = { GB: true };
        soleTrader.tokens = {
          delegation_token: "d",
          autofill_token: "a",
          signup_url: "https://checkout.example.test/soletrader/signup"
        };
        window.open = jest.fn(() => ({ closed: false }));

        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");
        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);

        // A redundant same-mode `setMode("sole_trader")` — mode is ALREADY
        // `sole_trader` — must not reset the re-signup this popup is still
        // deciding.
        soleTrader.setMode("sole_trader");

        expect(soleTrader.soleTraderReconfirmingCount).toBe(1);
        expect(soleTrader.isDeciding()).toBe(true);

        // The still-open re-signup's own captured field is still refused.
        $("#billing_company").trigger("click");
        expect(soleTrader.mode).toBe("sole_trader");
      });

      test("a blocked re-signup popup does not strand the count above zero", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "First Trader");
        window.open = jest.fn(() => null);

        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");

        expect(soleTrader.soleTraderReconfirmingCount).toBe(0);
        // Refused nothing it shouldn't — a blocked popup never even started
        // a wait.
        $("#billing_company").trigger("click");
        expect(soleTrader.mode).toBe("business");
      });
    });
  });

  describe("TWO-40 §7 direction (a) — Doug's live-tested regressions on the widget-selection PR", () => {
    beforeEach(() => {
      $("form[name='checkout']").after('<div id="order_review"></div>');
      ctx.Twoinc.getInstance().initialize(false);
      $(
        '<input type="radio" name="payment_method" value="' + ctx.twoinc.gateway_id + '" checked />'
      ).appendTo("form[name='checkout']");
    });

    describe("bug 1/item 4.3 — re-clicking the Sole Trader chip once already adopted", () => {
      // Doug's explicit override (item 4.3): an earlier round made this a
      // no-op on the theory that the "select a different sole trader" link
      // was the one deliberate re-signup entry point once adopted. Doug has
      // now ruled that wrong — re-clicking the chip must act exactly like
      // that link, not do nothing.
      test("opens a re-signup popup for an adoption that came through the hosted flow", () => {
        $("#billing_email").val("buyer@example.test");
        soleTrader.onModeChipClick("sole_trader");
        expect(opened).toHaveLength(1);

        soleTrader.bindPopupMessageListener();
        jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) =>
          cb({
            organization_number: "TWO:ST1",
            company_name: "A Sole Trader",
            email: "buyer@example.test"
          })
        );
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: "ACCEPTED",
            origin: "https://checkout.example.test"
          })
        );
        expect(soleTrader.soleTraderAdopted).toBe(true);

        soleTrader.onModeChipClick("sole_trader");

        expect(opened).toHaveLength(2);
        expect(opened[1].url).toContain("&autoselect=false");
      });

      test("still lets the buyer through while genuinely deciding (not yet adopted)", () => {
        const flight = armUndecidedSignup();
        soleTrader.onModeChipClick("sole_trader");
        expect(soleTrader.isDeciding()).toBe(true);

        // The adopted-re-signup branch is untouched by a click mid-decision —
        // it only takes over once actually adopted.
        flight.settle({
          organization_number: "TWO:ST1",
          company_name: "A Sole Trader",
          email: "buyer@example.test"
        });

        expect(soleTrader.soleTraderAdopted).toBe(true);
        expect($("#company_id").val()).toBe("TWO:ST1");
      });
    });

    describe("bug 2 — Enter manually while adopted, with a leftover popup-close poll still ticking", () => {
      test("still switches to manual entry rather than leaving the search widget showing", () => {
        // Adopted through the hosted signup, whose popup-close poll only
        // notices the window closed on its own 300ms cadence — it is still
        // "open" (and therefore still `isBusy()`) at the moment the buyer
        // clicks Enter manually.
        $("#billing_email").val("buyer@example.test");
        soleTrader.onModeChipClick("sole_trader");

        soleTrader.bindPopupMessageListener();
        jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) =>
          cb({
            organization_number: "TWO:ST1",
            company_name: "A Sole Trader",
            email: "buyer@example.test"
          })
        );
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: "ACCEPTED",
            origin: "https://checkout.example.test"
          })
        );
        expect(soleTrader.activePopupWatchers.length).toBe(1);

        jest.useFakeTimers();
        ctx.helper.activateManualEntry();
        jest.runAllTimers();
        jest.useRealTimers();

        expect(soleTrader.mode).toBe("business");
        expect(ctx.capture.mode).toBe("manual");
        expect($("#billing_company_field").hasClass("hidden")).toBe(false);
        expect($("#billing_company_display_field").hasClass("hidden")).toBe(true);
      });

      test("still switches to manual entry via a REAL click on the REAL button inside the reopened widget", () => {
        // The test above calls `activateManualEntry()` directly. This one
        // drives the same scenario through the actual selectWoo widget the
        // adopted sole trader is rendered through (TWO-40 §7 direction (a)) —
        // attached, reopened, and clicked for real — so a regression that
        // only shows up once the widget is genuinely live cannot hide behind
        // a call that skips it.
        $("#billing_email").val("buyer@example.test");
        soleTrader.onModeChipClick("sole_trader");

        soleTrader.bindPopupMessageListener();
        jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) =>
          cb({
            organization_number: "TWO:ST1",
            company_name: "A Sole Trader",
            email: "buyer@example.test"
          })
        );
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: "ACCEPTED",
            origin: "https://checkout.example.test"
          })
        );
        expect(soleTrader.soleTraderAdopted).toBe(true);
        expect($("#billing_company_display_field").hasClass("hidden")).toBe(false);

        // The buyer reopens the (still-live) widget and clicks Enter manually
        // for real.
        $("#billing_company_display").select2("open");
        ctx.helper.syncManualEntryButton();
        const $btn = $("#" + ctx.helper.manualEntryRowId);
        expect($btn.length).toBe(1);

        jest.useFakeTimers();
        $btn.trigger("click");
        jest.runAllTimers();
        jest.useRealTimers();

        expect(soleTrader.mode).toBe("business");
        expect($("#billing_company_field").hasClass("hidden")).toBe(false);
        expect($("#billing_company_display_field").hasClass("hidden")).toBe(true);
      });
    });

    describe("bug 3 — the 'select a different sole trader' link once adoption shows through the search widget", () => {
      test("is not stranded inside a field toggleBusinessFields just hid", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");

        expect($("#billing_company_field").hasClass("hidden")).toBe(true);

        const $btn = soleTrader.getDifferentSoleTraderBtnNode();

        expect($btn.closest(".hidden").length).toBe(0);
        expect($btn.css("display")).not.toBe("none");
      });

      test("shows on mode + tokens alone, with no #company_id check (Doug's ruling)", () => {
        // No `setCompany()` call — `#company_id` is deliberately left empty.
        // There is no real UX state where sole-trader mode is engaged with
        // nothing captured except while the dropdown is still deciding, and
        // that already visually obscures this link, so the gate does not
        // need to lean on the field at all.
        soleTrader.setMode("sole_trader");

        soleTrader.syncDifferentSoleTraderLink();

        expect($("#company_id").val()).toBe("");
        expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).not.toBe("none");
      });

      test("still opens the re-signup popup with autoselect=false", () => {
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");

        soleTrader.getDifferentSoleTraderBtnNode().trigger("click");

        expect(opened).toHaveLength(1);
        expect(opened[0].url).toContain("&autoselect=false");
      });

      test("falls back to the native field's own slot whenever that field is the visible one, unchanged from before", () => {
        // Reached via tile placement rather than the old "search off" fixture
        // (#486): there the native field deliberately stays in the address area
        // alongside the relocated control, so it is visible and the link belongs
        // in its slot. The branch is keyed on that visibility, not on any
        // setting.
        ctx.twoinc.company_search_location = "payment_tile";
        soleTrader.setMode("sole_trader");
        soleTrader.setCompany("TWO:ST1", "A Sole Trader");

        const $btn = soleTrader.getDifferentSoleTraderBtnNode();

        expect($btn.parent().is("#billing_company_field .woocommerce-input-wrapper")).toBe(true);
        expect($btn.closest(".hidden").length).toBe(0);
      });
    });
  });

  /**
   * TWO-40 §14 — leaving sole-trader mode takes the popup with it, rather
   * than dropping the record and orphaning a live window (ported from the two
   * PrestaShop bugs of this shape).
   *
   * Needs `isDeciding()` false while a popup is still outstanding, which is
   * exactly the adopted state: the outcome is settled, so a buyer action to
   * LEAVE is deliberately allowed through (see that predicate's own comment).
   */
  describe("TWO-40 §14 — leaving sole-trader mode abandons the whole flow at once", () => {
    beforeEach(() => {
      // The click-to-reopen binding is delegated from `Twoinc#initialize()`,
      // the real checkout-page wiring — same as the bug-3 block above.
      $("form[name='checkout']").after('<div id="order_review"></div>');
      ctx.Twoinc.getInstance().initialize(false);
    });

    test("a popup still on screen is CLOSED, not merely dropped from tracking", () => {
      const popup = {
        closed: false,
        close: jest.fn(() => {
          popup.closed = true;
        }),
        focus: jest.fn()
      };
      window.open = jest.fn(() => popup);

      // Given: a signup popup still undecided, with a company already adopted
      // — so a buyer action to LEAVE is allowed through.
      soleTrader.setMode("sole_trader");
      soleTrader.launchSignup();
      expect(soleTrader.activePopupWatchers).toHaveLength(1);
      soleTrader.setCompany("TWO:ST1", "A Sole Trader");
      expect(soleTrader.soleTraderAdopted).toBe(true);
      expect(soleTrader.isDeciding()).toBe(false);

      // When: the buyer leaves sole-trader mode.
      $("#billing_company").trigger("click");

      // Then: the window went with the record. Dropping the record alone left
      // a live popup on screen with nothing holding it, and the next Sole
      // trader click opened a SECOND one over it.
      expect(popup.close).toHaveBeenCalled();
      expect(soleTrader.activePopupWatchers).toHaveLength(0);
    });
  });

  describe("TWO-40 — delegated-auth token refresh", () => {
    let ajax;

    beforeEach(() => {
      ajax = harness.stubAjax($);
      jest.useFakeTimers();
    });

    afterEach(() => {
      ajax.restore();
      jest.useRealTimers();
    });

    // Drives a REAL (stubbed-network) token mint, as `render()` does.
    function realMint() {
      soleTrader.fetchTokens();
      ajax.last().succeed({
        success: true,
        data: {
          delegation_token: "delegation-1",
          autofill_token: "autofill-1",
          signup_url: "https://checkout.example.test/soletrader/signup"
        }
      });
    }

    test("does not start eagerly on page load, only `tokens` being pre-set", () => {
      // `beforeEach` above assigns `soleTrader.tokens` directly, not via a
      // real mint — a buyer who has never touched sole trader must not get a
      // background refresh loop for a token nobody minted.
      expect(soleTrader.tokenRefreshIntervalId).toBeNull();
    });

    test("starts on the first real mint and re-mints at the 30-minute mark", () => {
      realMint();
      expect(soleTrader.tokenRefreshIntervalId).not.toBeNull();
      expect(ajax.calls).toHaveLength(1);

      jest.advanceTimersByTime(30 * 60 * 1000);
      expect(ajax.calls).toHaveLength(2);

      ajax.last().succeed({
        success: true,
        data: {
          delegation_token: "delegation-2",
          autofill_token: "autofill-2",
          signup_url: "https://checkout.example.test/soletrader/signup"
        }
      });
      expect(soleTrader.tokens.delegation_token).toBe("delegation-2");
    });

    test("does not fire a second, uncoordinated mint while a real one is already in flight", () => {
      realMint();
      // A chip-click/email-change flight outstanding — `isBusy()`, the same
      // guard those paths use against each other.
      soleTrader.beginFlight();

      jest.advanceTimersByTime(30 * 60 * 1000);

      expect(ajax.calls).toHaveLength(1);
      soleTrader.settleFlight();
    });

    test("a failed re-mint is silent, and the next tick tries again", () => {
      realMint();

      jest.advanceTimersByTime(30 * 60 * 1000);
      expect(() => ajax.last().fail("error")).not.toThrow();
      // The failed tick's tokens are left in place rather than cleared.
      expect(soleTrader.tokens.delegation_token).toBe("delegation-1");

      jest.advanceTimersByTime(30 * 60 * 1000);
      expect(ajax.calls).toHaveLength(3);
      ajax.last().succeed({
        success: true,
        data: {
          delegation_token: "delegation-3",
          autofill_token: "autofill-3",
          signup_url: "https://checkout.example.test/soletrader/signup"
        }
      });
      expect(soleTrader.tokens.delegation_token).toBe("delegation-3");
    });

    test("a stale-country refresh response is discarded rather than overwriting a newer mint (round-2 review — Vader)", () => {
      // The buyer changes billing country while the refresh tick's own
      // request is still outstanding. Applying it anyway would ship
      // delegated authority for the country they just left.
      realMint();
      jest.advanceTimersByTime(30 * 60 * 1000);
      const staleTick = ajax.last();

      $("#billing_country").append('<option value="DE">DE</option>');
      $("#billing_country").val("DE");
      staleTick.succeed({
        success: true,
        data: {
          delegation_token: "stale-gb-delegation",
          autofill_token: "stale-gb-autofill",
          signup_url: "https://checkout.example.test/soletrader/signup"
        }
      });

      expect(soleTrader.tokens.delegation_token).toBe("delegation-1");
    });

    test.each([
      ["a direct stopTokenRefresh() call", () => soleTrader.stopTokenRefresh()],
      [
        // Exercises the actual `window.addEventListener("pagehide", ...)`
        // wiring — a test that only calls `stopTokenRefresh()` directly
        // would still pass even if that wiring were deleted (round-1
        // review — Leia; collapsed round-2 review — Leia).
        "a real pagehide dispatch",
        () => window.dispatchEvent(new Event("pagehide"))
      ]
    ])("cleans up the timer, no further re-mints once stopped, via %s", (_description, stop) => {
      realMint();
      stop();
      expect(soleTrader.tokenRefreshIntervalId).toBeNull();

      jest.advanceTimersByTime(60 * 60 * 1000);
      expect(ajax.calls).toHaveLength(1);
    });

    test("a bfcache-eligible `pagehide` (event.persisted) leaves the timer running", () => {
      // The page is frozen, not destroyed — real browsers pause and resume
      // the interval across the freeze on their own. Tearing it down here
      // would leave a buyer restored from bfcache with a dead refresh loop
      // for the rest of that checkout (round-1 review — Vader).
      realMint();
      const persisted = new Event("pagehide");
      Object.defineProperty(persisted, "persisted", { value: true });
      window.dispatchEvent(persisted);

      expect(soleTrader.tokenRefreshIntervalId).not.toBeNull();

      jest.advanceTimersByTime(30 * 60 * 1000);
      expect(ajax.calls).toHaveLength(2);
    });
  });

  /**
   * Item 4, live-reported by Doug: WooCommerce's chips sized to their own
   * content, leaving visible slack to the right of the row, where
   * PrestaShop's fill it. Asserted against the stylesheet source rather than
   * a rendered box: jsdom does no flex layout, so a computed-width assertion
   * here would be vacuous rather than wrong.
   */
  describe("item 4 — the chip row fills its full width", () => {
    test("each chip declares a half-row flex basis, so two share a row and a third grows to fill its own", () => {
      const rule = /^\.twoinc-mode-chip\s*\{([^}]*)\}/m.exec(stylesheetSource());

      expect(rule).not.toBeNull();
      // `flex-grow: 1` is what fills the row; the `calc(50% - <gap>)` basis is
      // what decides how many chips land on it.
      expect(rule[1]).toMatch(/flex:\s*1\s+1\s+calc\(50%\s*-\s*\d+px\)/);
    });

    test("the row itself wraps, or the third chip has nowhere to go", () => {
      const rule = /^\.twoinc-mode-chips\s*\{([^}]*)\}/m.exec(stylesheetSource());

      expect(rule).not.toBeNull();
      expect(rule[1]).toMatch(/flex-wrap:\s*wrap/);
    });
  });
});
