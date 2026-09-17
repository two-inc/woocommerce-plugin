/**
 * Blocks checkout: a skin over the classic checkout's own controller, never a
 * second implementation of it (ABN-554). `assets/js/twoinc.js` already loads on
 * every front-end page, so `TwoCompanySearch`, `twoincCompanyCapture`,
 * `twoincAddressRoles` and the shared popover are already on this page. This
 * file owns only what a Blocks checkout shapes differently:
 *
 *   1. the hidden classic-shaped address inputs the controller reads and
 *      writes, one set per address role, mirrored both ways against Blocks'
 *      own cart data store;
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
   * Blocks' address keys. The classic controller addresses the same fields as
   * `#<role>_<key>`, so mirroring them is what lets it run here unchanged.
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

  var SHADOW_ID = "twoinc-blocks-shadow";

  /** Both roles: Blocks renders delivery first, so mirroring one strands the other's control (ABN-554). */
  function addressRoles() {
    return [
      { role: twoincAddressRoles.invoice(), store: "billingAddress", setter: "setBillingAddress" },
      {
        role: twoincAddressRoles.delivery(),
        store: "shippingAddress",
        setter: "setShippingAddress"
      }
    ];
  }

  /** Capture carriers the controller owns outright, with no Blocks counterpart. */
  function captureIds(role) {
    return role === twoincAddressRoles.invoice()
      ? ["company_id", "company_name"]
      : [role + "_company_id"];
  }

  /** True while the store's own values are being written into the shadow. */
  var applying = false;
  var pushScheduled = false;
  /** Per role, keys the controller wrote: the value replaced, the sends left, whether the store holds it. */
  var dirty = {};
  /** The cap on how often one write is dispatched, its first send included. */
  var SENDS = 3;
  var pushing = false;
  var saveScheduled = false;
  var restored = false;
  var announcedActive = null;

  function cartStore() {
    return wp.data && wp.data.select && wp.data.select("wc/store/cart");
  }

  function storedAddress(key) {
    var store = cartStore();
    var customer = store && store.getCustomerData && store.getCustomerData();
    return (customer && customer[key]) || null;
  }

  /** jQuery assigns `.value` and fires nothing, so an accessor is the only hook. */
  function announceWrites(input, announce) {
    var native = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    Object.defineProperty(input, "value", {
      configurable: true,
      get: function () {
        return native.get.call(this);
      },
      set: function (value) {
        native.set.call(this, value);
        if (!applying) announce();
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

  /**
   * Snapshot the capture the way the classic checkout does on its own 3s
   * timer — on the write instead, so nothing here runs on a clock.
   */
  function scheduleSave() {
    if (saveScheduled) return;
    saveScheduled = true;
    Promise.resolve().then(function () {
      saveScheduled = false;
      if (typeof twoincDomHelper !== "undefined") twoincDomHelper.saveCheckoutInputs();
    });
  }

  function shadow() {
    var host = document.getElementById(SHADOW_ID);
    if (host) return host;

    host = document.createElement("div");
    host.id = SHADOW_ID;
    host.hidden = true;
    // The container `saveCheckoutInputs()`/`loadStorageInputs()` look for;
    // without one they recognise, nothing persists the capture (ABN-554).
    host.className = "checkout woocommerce-checkout custom-checkout";
    var add = function (id, announce) {
      var input = document.createElement("input");
      input.type = "text";
      input.id = id;
      announceWrites(input, announce);
      host.appendChild(input);
    };
    addressRoles().forEach(function (entry) {
      ADDRESS_KEYS.forEach(function (key) {
        add(entry.role + "_" + key, function () {
          var address = storedAddress(entry.store);
          // Null until an address answers, since by the push this write is the store's own value.
          var was = address ? String(address[key] == null ? "" : address[key]) : null;
          (dirty[entry.role] = dirty[entry.role] || {})[key] = {
            was: was,
            sends: SENDS,
            taken: false
          };
          schedulePush();
        });
      });
      captureIds(entry.role).forEach(function (id) {
        add(id, scheduleSave);
      });
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
      var node = host.querySelector("." + name);
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

    var decimals = totals.currency_minor_unit == null ? 2 : totals.currency_minor_unit;
    var unit = Math.pow(10, decimals);
    var nodes = priceNodes();
    var separator = (window.twoinc && window.twoinc.price_decimal_separator) || ".";
    nodes["order-total"].textContent = ((totals.total_price || 0) / unit)
      .toFixed(decimals)
      .replace(".", separator);
    nodes["tax-rate"].textContent = ((totals.total_tax || 0) / unit)
      .toFixed(decimals)
      .replace(".", separator);
  }

  /** The store's addresses into the fields the controller reads. */
  function pull() {
    shadow();

    var moved = false;
    addressRoles().forEach(function (entry) {
      var address = storedAddress(entry.store);
      if (!address) return;
      var written = dirty[entry.role] || {};

      applying = true;
      ADDRESS_KEYS.forEach(function (key) {
        var held = written[key];
        // Skipped only until the store holds this write; the record outlives that.
        if (held && !held.taken) return;
        var input = document.getElementById(entry.role + "_" + key);
        var value = address[key] == null ? "" : String(address[key]);
        if (input && input.value !== value) {
          input.value = value;
          moved = true;
        }
      });
      applying = false;
    });

    return moved;
  }

  /** Blocks names a plain input for its key alone, a widget's for the key plus a suffix. */
  function keyFromId(suffix) {
    var found = null;
    ADDRESS_KEYS.forEach(function (key) {
      if (suffix === key || suffix.indexOf(key + "-") === 0) found = key;
    });
    return found;
  }

  /**
   * `role`'s own control for `key`, whichever id Blocks gave it — the bare key
   * or the key plus a widget suffix, which the two roles need not match on.
   */
  function counterpartControl(role, key) {
    var stem = role + "-" + key;
    return document.querySelector('[id="' + stem + '"], [id^="' + stem + '-"]');
  }

  /** Which of `role`'s held keys the input `id` is the buyer's control for, if any. */
  function editedKey(role, id) {
    var found = null;
    addressRoles().forEach(function (entry) {
      if (found || id.indexOf(entry.role + "-") !== 0) return;
      var key = keyFromId(id.slice(entry.role.length + 1));
      if (!key) return;
      // Roles Blocks mirrors render one control between them, so that edit is this role's too.
      if (entry.role === role || !counterpartControl(role, key)) {
        found = key;
      }
    });
    return found;
  }

  /**
   * The control repainting its display field rather than the buyer editing it. In
   * address-area placement that field is the buyer's only company input, and the
   * control sets no flag — the repaint rewriting the held name is the one tell.
   */
  function isOwnRepaint(target, role, key) {
    // `window.twoinc` because `companyFieldSelector()` reads the placement off it.
    if (typeof twoincCompanySearchControls === "undefined" || !window.twoinc || !target.matches) {
      return false;
    }
    var own = twoincCompanySearchControls.some(function (search) {
      var selector = search.companyFieldSelector();
      return !!selector && target.matches(selector);
    });
    if (!own) return false;
    var input = document.getElementById(role + "_" + key);
    return !!input && target.value === input.value;
  }

  /**
   * A buyer edit ends that field's write: a field cleared back to what the write
   * replaced is otherwise the stale cart response `push()` defends against.
   */
  function releaseOnEdit(event) {
    var target = event.target;
    var id = (target && target.id) || "";
    if (!id) return;
    addressRoles().forEach(function (entry) {
      var written = dirty[entry.role];
      if (!written) return;
      // Blocks renders the contact email once, under its bare key.
      var key = id === "email" ? "email" : editedKey(entry.role, id);
      if (key && !isOwnRepaint(target, entry.role, key)) delete written[key];
    });
  }

  /**
   * What the controller wrote into those fields, back to the store — and only
   * that. Sending every divergent key would push the buyer's own concurrent
   * edit back to its previous value.
   *
   * Nothing acknowledges a dispatch, so a store reading as the value the write
   * replaced is the only sign a cart response older than the write landed.
   *
   * A key's record ends here on either of two answers from the store: a third
   * value, which is nobody's but the buyer's, or `was` again with no sends left.
   * The store holding the written value ends the `pull()` skip alone, so the
   * record still opposes a revert after that. A role whose address has not
   * resolved yet is skipped with its records intact.
   */
  function push() {
    // A dispatch can notify subscribers synchronously: spend a send per store pass, not per notification.
    if (pushing) return;
    pushing = true;
    try {
      addressRoles().forEach(function (entry) {
        var written = dirty[entry.role] || {};
        var address = storedAddress(entry.store);
        // Held, not dropped: the cart resolves ticks after the microtask push a write queues.
        if (!address) return;

        var patch = null;
        Object.keys(written).forEach(function (key) {
          var held = written[key];
          var input = document.getElementById(entry.role + "_" + key);
          var stored = address[key] == null ? "" : String(address[key]);
          // No address to read at the write: the first one to answer is what it
          // replaced. Ahead of the agreement below, or a `was` still unset there
          // would make the store's NEXT value the one this write opposes.
          if (held.was === null) held.was = stored;
          // The store holds it, so `pull()` owns the field again — `was` and the
          // sends left stay, or a revert to `was` after this goes unopposed.
          if (input && input.value === stored) {
            held.taken = true;
            return;
          }
          if (!input || stored !== held.was || !held.sends) {
            delete written[key];
            return;
          }
          held.sends -= 1;
          // Not held any more, so `pull()` must not paint over this re-send.
          held.taken = false;
          patch = patch || {};
          patch[key] = input.value;
        });

        if (patch) wp.data.dispatch("wc/store/cart")[entry.setter](patch);
      });
    } finally {
      pushing = false;
    }
  }

  // -------------------------------------------------------------- mounting

  function control() {
    return typeof twoincSelectWooHelper === "undefined" ? null : twoincSelectWooHelper;
  }

  /** The control is already anchored to the host it would mount on now. */
  function isMounted(search) {
    // Manual entry releases the field, which is not an unmount.
    if (twoincCompanyCapture.modeFor(search.role) === "manual") return true;
    if (search.panel) return search.panel.isBound();
    var field = document.querySelector(search.companyFieldSelector());
    return !!(field && field.closest("." + search.fieldWrapClass));
  }

  /** A Blocks address edit is what a classic `updated_checkout` is. */
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
    nativeRow(search, row);
    noteSlot(search, row);
  }

  /**
   * And the native row itself, which carries no field here — only the link
   * back out of manual entry, which the controller hangs on this id.
   *
   * A CHILD of the company row, not its sibling: the controller re-inserts the
   * company-number summary directly after that row on every render, so a
   * sibling here competes for the same slot and the two swap places forever.
   */
  function nativeRow(search, row) {
    var id = search.nativeCompanyRowSelector().slice(1);
    var native = document.getElementById(id);
    if (!native) {
      native = document.createElement("div");
      native.id = id;
      native.className = "hidden";
    }
    if (native.parentElement !== row) row.appendChild(native);
  }

  /**
   * A per-role host for the sole-trader note, which is what the controller
   * asks for per-country availability behind. Neither classic host is on a
   * Blocks page: the invoice role's sits in the gateway description, rendered
   * only for the selected method, and the delivery role's comes from a
   * classic-only hook (TWO-25776).
   */
  function noteSlot(search, row) {
    var cls = "twoinc-sole-trader-note-slot-blocks-" + search.role;
    search.soleTraderNoteSlotClass = cls;
    if (row.querySelector("." + cls)) return;
    var slot = document.createElement("div");
    slot.className = "twoinc-sole-trader-note-slot-blocks " + cls + " hidden";
    row.appendChild(slot);
    // Any refresh that ran before this host existed answered "no sole trader" and cached nothing.
    search.soleTrader.refresh();
  }

  function mount() {
    if (!control() || !window.twoinc) return;

    twoincCompanySearchControls.forEach(function (search) {
      // Address-area placement mounts on core's own company row; the tile mount the controller builds.
      search.addressFieldSelector = "#" + search.role + "-company";
      anchorRow(search);
      if (!isMounted(search)) {
        if (!search.isTileLocation() && !document.querySelector(search.addressFieldSelector)) {
          return;
        }
        // `toggleBusinessFields()`'s own split: only the invoice role has a tile mount.
        if (search.role === twoincAddressRoles.primary()) {
          search.syncCompanySearchTileLocation();
        } else {
          search.rebindUnlessManual();
        }
      }
      // Outside the mount guard: a restored capture can land before its anchor row exists.
      search.renderCompanySummary();
    });
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

  /**
   * Every role's capture carriers, unresolved and under the ids the classic
   * checkout posts them as — `process_payment()` owns the invoice-first,
   * delivery-fallback precedence, and Blocks serialises no hidden input of its
   * own for it to read (ABN-554).
   */
  function captured() {
    var payload = twoincTermsConsent.payload();
    if (!control()) return payload;
    twoincCompanySearchControls.forEach(function (search) {
      var company = search.readCapturedCompany();
      // A carrier's selector minus its "#" is the POST key the server reads.
      payload[twoincCompanyCapture.numberFieldSelector(search.role).slice(1)] =
        company.organization_number || "";
      payload[twoincCompanyCapture.nameFieldSelector(search.role).slice(1)] =
        company.company_name || "";
    });
    return payload;
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
      element.createElement("span", { className: "twoinc-blocks-title" }, title),
      data.iconUrl
        ? element.createElement("img", {
            src: data.iconUrl,
            alt: title,
            className: "twoinc-blocks-icon"
          })
        : null,
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
          var refusal = twoincTermsConsent.validate();
          if (refusal) {
            return { type: responses.responseTypes.ERROR, message: refusal };
          }
          return {
            type: responses.responseTypes.SUCCESS,
            meta: { paymentMethodData: captured() }
          };
        });
      },
      [events, responses]
    );

    element.useEffect(function () {
      mount();
      resync();

      // The controller asks for a totals recalculation the classic way after a
      // term is picked, and re-renders its chips off the answer.
      var recalculate = function () {
        var updated = announceChoice(true);
        if (updated && updated.then) updated.then(resync);
      };
      window.jQuery(document.body).on("update_checkout.twoincBlocks", recalculate);

      return function () {
        window.jQuery(document.body).off("update_checkout.twoincBlocks", recalculate);
      };
    }, []);

    return element.createElement(
      "span",
      { className: "twoinc-blocks-content" },
      html(data.description, "twoinc-blocks-description"),
      html(data.terms, "twoinc-blocks-terms")
    );
  }

  /**
   * The controller's own restore pass, which `initialize(true)` runs on a
   * classic checkout and nothing runs here. The country tracker is seeded
   * after it, for the reason that call documents: seeded first, the next
   * re-render reads the restored country as a change and destroys what the
   * restore just put back.
   */
  function restore() {
    if (restored || !control() || !window.twoinc || typeof twoincDomHelper === "undefined") return;
    // Not before the cart has RESOLVED: until then the store answers with a
    // blank address, and the snapshot would be written into empty fields and
    // pushed back over the buyer's real address when it lands. Asked of
    // `getCartData`, which carries the resolver — `getCustomerData` has none,
    // so its resolution never finishes.
    var store = cartStore();
    if (!store || !store.hasFinishedResolution) return;
    // Asked for, not merely waited on: nothing else in this file selects it,
    // so the resolver only ever starts because of this call.
    if (store.getCartData) store.getCartData();
    if (!store.hasFinishedResolution("getCartData")) return;
    if (!storedAddress("billingAddress")) return;
    restored = true;
    shadow();
    // Before the snapshot, as `initialize()` does: it is what sets the flag
    // `loadStorageInputs()` reads to leave a signed-in buyer's own stored
    // company alone.
    twoincDomHelper.loadUserMetaInputs();
    twoincDomHelper.loadStorageInputs();
    twoincDomHelper.restoreCapturedCompany();
    twoincCompanySearchControls.forEach(function (search) {
      search.countryDidChange(search.currentCountry());
    });
  }

  function bootstrap() {
    // The controller this file skins is a declared dependency; absent it, nothing to mount.
    if (!control()) return;
    pull();
    pullTotals();
    // Before the restore: mounting is what points the control at this
    // checkout's own company field, and the restore paints into it.
    mount();
    restore();
    resync();
    observeCheckout();
    // On the document: Blocks re-creates its own inputs, and a select fires only `change`.
    ["input", "change"].forEach(function (type) {
      document.addEventListener(type, releaseOnEdit, true);
    });
    if (!wp.data || !wp.data.subscribe) return;
    wp.data.subscribe(function () {
      // A country change is what the controller re-reads its per-country
      // gates on, the same pass a classic `updated_checkout` triggers.
      pullTotals();
      // Before `pull()`, so a key this pass releases is repainted from the store in it.
      push();
      var moved = pull();
      restore();
      if (moved) resync();
      mount();
    }, "wc/store/cart");
    wp.data.subscribe(announceActiveMethod, "wc/store/payment");
    announceActiveMethod();
  }

  /**
   * The cart's surcharge is gated server-side on the chosen payment method, and
   * the session keeps whatever was last announced — so a reload with another
   * method selected would otherwise leave this gateway's fee on that cart.
   * Announced on change only, since each announcement is a cart request.
   */
  function announceActiveMethod() {
    var store = wp.data.select("wc/store/payment");
    if (!store || !store.getActivePaymentMethod) return;
    var active = store.getActivePaymentMethod() === name;
    if (active === announcedActive) return;
    var announced = announceChoice(active);
    if (!announced || !announced.then) return;
    announcedActive = active;
    announced.catch(function () {
      // Never sent, so never latched: the next change must try again.
      if (announcedActive === active) announcedActive = null;
    });
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
    var watched = { childList: true, subtree: true };
    var observer = new window.MutationObserver(function () {
      // Mounting writes into this same subtree, and the controller re-inserts
      // its own affordances on every render — so an observer left connected
      // through the handler feeds itself forever.
      observer.disconnect();
      mount();
      observer.takeRecords();
      observer.observe(root, watched);
    });
    observer.observe(root, watched);
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
