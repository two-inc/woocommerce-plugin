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

  /** The row id the controller addresses as the native company row. */
  var NATIVE_ROW_ID = "billing_company_field";

  /** True while the store's own values are being written into the shadow. */
  var applying = false;
  var pushScheduled = false;

  function cartStore() {
    return wp.data && wp.data.select && wp.data.select("wc/store/cart");
  }

  function billingAddress() {
    var store = cartStore();
    var customer = store && store.getCustomerData && store.getCustomerData();
    return (customer && customer.billingAddress) || null;
  }

  /**
   * Make one shadow input announce its own writes.
   *
   * The controller sets these through jQuery, which assigns `.value` and fires
   * nothing at all — not even a native event — so an own-property accessor
   * over the prototype's is what turns a capture or a registry autofill into
   * something this file can react to rather than sample.
   */
  function announceWrites(input) {
    var native = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    Object.defineProperty(input, "value", {
      configurable: true,
      get: function () {
        return native.get.call(this);
      },
      set: function (value) {
        native.set.call(this, value);
        if (!applying) schedulePush();
      }
    });
  }

  /** One dispatch per burst: a capture writes the number and the name separately. */
  function schedulePush() {
    if (pushScheduled) return;
    pushScheduled = true;
    Promise.resolve().then(function () {
      pushScheduled = false;
      push();
    });
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
      if (ADDRESS_KEYS.indexOf(key) !== -1) announceWrites(input);
      host.appendChild(input);
    });
    document.body.appendChild(host);
    return host;
  }

  /**
   * The order total and tax, in the markup `twoincDomHelper.getPrice()`
   * reads. The order-intent check polls for them before it will ask, and
   * Blocks' own totals carry none of the classic classes.
   */
  function priceNodes() {
    var host = shadow();
    var nodes = {};
    ["order-total", "tax-rate"].forEach(function (name) {
      var node = host.querySelector("." + name.replace(".", ""));
      if (!node) {
        node = document.createElement("span");
        node.className = name;
        node.innerHTML = '<span class="woocommerce-Price-amount"><bdi></bdi></span>';
        host.appendChild(node);
      }
      nodes[name] = node.querySelector("bdi");
    });
    return nodes;
  }

  function pullTotals() {
    var store = cartStore();
    var totals = store && store.getCartTotals && store.getCartTotals();
    if (!totals) return;

    var unit = Math.pow(10, totals.currency_minor_unit || 2);
    var nodes = priceNodes();
    var separator = (window.twoinc && window.twoinc.price_decimal_separator) || ".";
    nodes["order-total"].textContent = ((totals.total_price || 0) / unit)
      .toFixed(2)
      .replace(".", separator);
    nodes["tax-rate"].textContent = ((totals.total_tax || 0) / unit)
      .toFixed(2)
      .replace(".", separator);
  }

  /** The store's address into the fields the controller reads. */
  function pull() {
    var address = billingAddress();
    if (!address) return false;
    shadow();

    var moved = false;
    applying = true;
    ADDRESS_KEYS.forEach(function (key) {
      var input = document.getElementById("billing_" + key);
      var value = address[key] == null ? "" : String(address[key]);
      if (input && input.value !== value) {
        input.value = value;
        moved = true;
      }
    });
    applying = false;

    return moved;
  }

  /** What the controller wrote into those fields, back to the store. */
  function push() {
    var address = billingAddress();
    if (!address) return;

    var patch = null;
    ADDRESS_KEYS.forEach(function (key) {
      var input = document.getElementById("billing_" + key);
      if (!input) return;
      var stored = address[key] == null ? "" : String(address[key]);
      if (input.value !== stored) {
        patch = patch || {};
        patch[key] = input.value;
      }
    });

    if (patch) wp.data.dispatch("wc/store/cart").setBillingAddress(patch);
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
   * Blocks' company row is the controller's DISPLAY row — the search
   * control's own visible surface — not the native one. The distinction is
   * load-bearing: `toggleBusinessFields()` hides the native row whenever the
   * search is the active surface, which on a Blocks checkout is the buyer's
   * only company field (ABN-554).
   */
  function anchorRow(search) {
    var field = document.querySelector(search.addressFieldSelector);
    var row = field && field.closest(".wc-block-components-text-input");
    if (!row) return;

    var id = search.addressFieldSelector.slice(1) + "_field";
    if (row.id !== id) row.id = id;
    nativeRow(row);
  }

  /**
   * And the native row itself, which carries no field here — only the link
   * back out of manual entry, which the controller hangs on this id. Replaced
   * only once React has orphaned it.
   */
  function nativeRow(after) {
    var row = document.getElementById(NATIVE_ROW_ID);
    if (!row) {
      row = document.createElement("div");
      row.id = NATIVE_ROW_ID;
      row.className = "hidden";
    }
    if (row.parentElement !== after.parentElement) {
      after.insertAdjacentElement("afterend", row);
    }
  }

  function mount() {
    var search = control();
    if (!search || !window.twoinc) return;

    // WooCommerce's own company row is the one immediately under the name
    // fields, which is where address-area placement is specified to put the
    // control; the tile mount the controller builds itself.
    search.addressFieldSelector = "#billing-company";
    anchorRow(search);
    if (isMounted(search)) return;
    if (!search.isTileLocation() && !document.querySelector(search.addressFieldSelector)) {
      return;
    }
    search.syncCompanySearchTileLocation();
    // The summary anchors against the row the control mounts on, and a
    // rebuilt row is a new anchor.
    search.renderCompanySummary();
  }

  /**
   * Tell the cart this gateway is (or is no longer) the chosen method, so the
   * term surcharge reaches the order summary before submit.
   */
  function announceChoice(active) {
    var api = wc.blocksCheckout;
    if (!api || !api.extensionCartUpdate) return null;
    return api.extensionCartUpdate({
      namespace: "twoinc-payment-gateway",
      data: { active: active }
    });
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
      announceChoice(true);

      // The controller asks for a totals recalculation the classic way after
      // a term is picked, and re-renders its chips off the answer. This is
      // that round trip in the Store API's terms.
      var recalculate = function () {
        var updated = announceChoice(true);
        if (updated && updated.then) updated.then(resync);
      };
      window.jQuery(document.body).on("update_checkout.twoincBlocks", recalculate);

      return function () {
        window.jQuery(document.body).off("update_checkout.twoincBlocks", recalculate);
        announceChoice(false);
      };
    }, []);

    return html(data.description, "twoinc-blocks-content");
  }

  // Address-area placement is live whether or not this gateway is the selected
  // one, exactly as on a classic checkout, so the mirror and the mount are the
  // page's business rather than the tile component's.
  function bootstrap() {
    pull();
    pullTotals();
    mount();
    resync();
    if (!wp.data || !wp.data.subscribe) return;
    wp.data.subscribe(function () {
      // A country change is what the controller re-reads its per-country
      // gates on, the same pass a classic `updated_checkout` triggers.
      pullTotals();
      if (pull()) resync();
      mount();
    }, "wc/store/cart");
    observeCheckout();
  }

  /**
   * Re-anchor if the checkout block ever replaces the row the control is
   * mounted on. React leaves nodes it did not create alone, so this is the
   * guard against a remount, not the ordinary path — the ordinary path is the
   * store subscription above and the tile's own mount effect.
   */
  function observeCheckout() {
    var root = document.querySelector(".wp-block-woocommerce-checkout");
    if (!root || typeof window.MutationObserver !== "function") return;
    new window.MutationObserver(function () {
      mount();
    }).observe(root, { childList: true, subtree: true });
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
