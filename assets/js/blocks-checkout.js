/**
 * Blocks checkout: a skin over the classic checkout's own controller, never a
 * second implementation of it (ABN-554). `assets/js/twoinc.js` already loads on
 * every front-end page, so `TwoCompanySearch`, `twoincCompanyCapture`,
 * `twoincAddressRoles` and the shared popover are already on this page. This
 * file owns only what a Blocks checkout shapes differently:
 *
 *   1. the hidden classic-shaped address inputs the controller reads and
 *      writes, mirrored both ways against Blocks' own cart data store;
 *   2. the two mount points — WooCommerce's own company row, or the payment
 *      tile — which mount the buyer sees is `window.twoinc`'s call, not this
 *      file's;
 *   3. handing the capture to the Store API as payment data.
 *
 * Every mode, the search transport, sole trader, manual entry and the capture
 * state machine stay in the base plugin.
 */
(function (window) {
  "use strict";

  var wc = window.wc || {};
  var wp = window.wp || {};
  var registry = wc.wcBlocksRegistry;
  var settings = wc.wcSettings;
  var element = wp.element;
  var name = window.twoincBlocksName;

  if (!registry || !settings || !element || !name) {
    return;
  }

  var data = settings.getSetting(name + "_data", null);
  if (!data) {
    return;
  }

  var decode =
    (wp.htmlEntities && wp.htmlEntities.decodeEntities) ||
    function (value) {
      return value;
    };
  var title = decode(data.title || "");

  // ------------------------------------------------------- shadow address

  /**
   * Blocks' billing keys. The classic controller addresses the same fields as
   * `#billing_<key>`, so mirroring them is what lets it run here unchanged.
   */
  var ADDRESS_KEYS = [
    "first_name",
    "last_name",
    "company",
    "address_1",
    "address_2",
    "city",
    "state",
    "postcode",
    "country",
    "phone",
    "email"
  ];

  /** Carriers the controller owns outright, with no Blocks counterpart. */
  var CAPTURE_IDS = ["company_id", "company_name"];

  var SHADOW_ID = "twoinc-blocks-shadow";

  /** Last value each field was reconciled at, so either side's change is visible. */
  var settled = {};

  function cartStore() {
    return wp.data && wp.data.select && wp.data.select("wc/store/cart");
  }

  function billingAddress() {
    var store = cartStore();
    var customer = store && store.getCustomerData && store.getCustomerData();
    return (customer && customer.billingAddress) || null;
  }

  function shadow() {
    var host = document.getElementById(SHADOW_ID);
    if (host) return host;

    host = document.createElement("div");
    host.id = SHADOW_ID;
    host.hidden = true;
    ADDRESS_KEYS.concat(CAPTURE_IDS).forEach(function (key) {
      var input = document.createElement("input");
      input.type = "text";
      input.id = ADDRESS_KEYS.indexOf(key) === -1 ? key : "billing_" + key;
      host.appendChild(input);
    });
    document.body.appendChild(host);
    return host;
  }

  /**
   * Reconcile the two copies of the billing address, whichever side moved.
   * The controller writes these fields with a bare `.val()` — no event of any
   * kind — so the only way to see a capture or an address autofill land is to
   * look.
   */
  function reconcile() {
    var address = billingAddress();
    if (!address) return false;
    shadow();

    var moved = false;

    var patch = null;
    ADDRESS_KEYS.forEach(function (key) {
      var input = document.getElementById("billing_" + key);
      if (!input) return;
      var stored = address[key] == null ? "" : String(address[key]);

      if (stored !== settled[key]) {
        input.value = stored;
        moved = true;
      } else if (input.value !== settled[key]) {
        moved = true;
        patch = patch || {};
        patch[key] = input.value;
        stored = input.value;
      }
      settled[key] = stored;
    });

    if (patch) wp.data.dispatch("wc/store/cart").setBillingAddress(patch);
    return moved;
  }

  // -------------------------------------------------------------- mounting

  function control() {
    return typeof twoincSelectWooHelper === "undefined" ? null : twoincSelectWooHelper;
  }

  /** The control is already anchored to the host it would mount on now. */
  function isMounted(search) {
    var field = document.querySelector(search.companyFieldSelector());
    return !!(field && field.closest(".two-company-field-wrap"));
  }

  /**
   * The controller's own "the checkout re-rendered" pass — sole-trader
   * availability and token priming, the search-country gate, term chips and
   * the mount, in the order it runs them. A Blocks address edit is what a
   * classic `updated_checkout` is, so it gets the same call rather than a
   * subset of it.
   */
  function resync() {
    var search = control();
    if (!search || !window.twoinc || typeof Twoinc === "undefined") return;
    Twoinc.getInstance().onUpdatedCheckout();
  }

  /**
   * The controller hangs the read-only company number, the sole-trader
   * spinner and the link back out of manual entry on the row it knows as
   * `<field>_field`. Blocks' own company row carries no id, so the skin gives
   * it the one the controller looks for.
   */
  function nameRowId(search) {
    var field = document.querySelector(search.addressFieldSelector);
    var row = field && field.closest(".wc-block-components-text-input");
    if (row && !row.id) row.id = "billing_company_field";
  }

  function mount() {
    var search = control();
    if (!search || !window.twoinc) return;

    // WooCommerce's own company row is the one immediately under the name
    // fields, which is where address-area placement is specified to put the
    // control; the tile mount the controller builds itself.
    search.addressFieldSelector = "#billing-company";
    nameRowId(search);
    if (isMounted(search)) return;
    if (!search.isTileLocation() && !document.querySelector(search.addressFieldSelector)) {
      return;
    }
    search.syncCompanySearchTileLocation();
  }

  function captured() {
    var role = twoincAddressRoles.primary();
    return {
      company_id: twoincCompanyCapture.numberField(role).val() || "",
      company_name: twoincCompanyCapture.nameField(role).val() || ""
    };
  }

  // ----------------------------------------------------------- tile markup

  function html(markup, className) {
    if (!markup) {
      return null;
    }
    return element.createElement("span", {
      className: className,
      dangerouslySetInnerHTML: { __html: markup }
    });
  }

  function Label() {
    return element.createElement(
      "span",
      { className: "twoinc-blocks-label" },
      data.iconUrl
        ? element.createElement("img", {
            src: data.iconUrl,
            alt: title,
            className: "twoinc-blocks-icon"
          })
        : null,
      element.createElement("span", null, title),
      html(data.about, "twoinc-blocks-about")
    );
  }

  function Content(props) {
    var events = props && props.eventRegistration;
    var responses = props && props.emitResponse;

    element.useEffect(
      function () {
        if (!events) return undefined;
        return events.onPaymentSetup(function () {
          return {
            type: responses.responseTypes.SUCCESS,
            meta: { paymentMethodData: captured() }
          };
        });
      },
      [events, responses]
    );

    // The tile slot and the sole-trader note slot are React's to own, and the
    // controller only builds into them — and only asks whether sole trader is
    // available at all — once they exist.
    element.useEffect(function () {
      mount();
      resync();
    }, []);

    return element.createElement(
      "div",
      { className: "twoinc-blocks-content" },
      html(data.subtitle, "twoinc-blocks-subtitle"),
      element.createElement("div", { className: "twoinc-company-search-tile-slot hidden" }),
      element.createElement("div", { className: "twoinc-sole-trader-note-slot hidden" })
    );
  }

  // Address-area placement is live whether or not this gateway is the selected
  // one, exactly as on a classic checkout, so the mirror and the mount are the
  // page's business rather than the tile component's.
  function bootstrap() {
    reconcile();
    mount();
    resync();
    if (!wp.data || !wp.data.subscribe) return;
    wp.data.subscribe(tick, "wc/store/cart");
    // The store never publishes the controller's own silent writes, and React
    // re-renders the mount out from under it, so both are also polled.
    window.setInterval(tick, 300);
  }

  function tick() {
    var moved = reconcile();
    mount();
    if (moved) resync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }

  registry.registerPaymentMethod({
    name: name,
    label: element.createElement(Label, null),
    content: element.createElement(Content, null),
    edit: element.createElement(Content, null),
    ariaLabel: title,
    canMakePayment: function () {
      return true;
    },
    supports: {
      features: data.supports || ["products"]
    }
  });
})(window);
