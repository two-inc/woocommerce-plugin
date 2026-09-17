/**
 * assets/js/blocks-checkout.js registers the Blocks payment method against the
 * globals WooCommerce provides. The script is a plain IIFE with no exports, so
 * the test evaluates it exactly as its <script> tag would, over stub globals.
 */

const fs = require("fs");
const path = require("path");
const harness = require("./wc-harness");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "assets", "js", "blocks-checkout.js"),
  "utf8"
);

const METHOD_DATA = {
  title: "Business invoice",
  description: '<div class="twoinc-payment-subtitle">Read more</div>',
  about: '<div class="abt-twoinc">about</div>',
  terms: '<div class="twoinc-terms-consent"><input name="twoinc_terms_accepted" /></div>',
  iconUrl: "https://example.test/logo.svg",
  supports: ["products", "refunds"]
};

function createElement(type, props) {
  const children = Array.prototype.slice.call(arguments, 2);
  return { type, props: props || {}, children };
}

/** Handlers the skin binds on document.body, keyed by the jQuery event name. */
const bodyHandlers = {};

/** One of the skin's own hidden inputs. */
function shadowInput(id) {
  return document.getElementById(id);
}

function globals(overrides) {
  const registered = [];
  window.jQuery = () => ({
    on(event, fn) {
      bodyHandlers[event] = fn;
      return this;
    },
    off(event) {
      delete bodyHandlers[event];
      return this;
    }
  });
  const base = {
    wc: {
      wcBlocksRegistry: {
        registerPaymentMethod(config) {
          registered.push(config);
        }
      },
      wcSettings: {
        getSetting(key) {
          return key === "woocommerce-gateway-tillit_data" ? METHOD_DATA : null;
        }
      }
    },
    wp: {
      element: {
        createElement,
        useEffect: (fn) => {
          const cleanup = fn();
          if (typeof cleanup === "function") globals.lastCleanup = cleanup;
        }
      },
      htmlEntities: { decodeEntities: (v) => v }
    },
    twoincBlocksName: "woocommerce-gateway-tillit"
  };
  return { env: Object.assign(base, overrides), registered };
}

function evaluate(env) {
  Object.keys(env).forEach((key) => {
    window[key] = env[key];
  });
  // eslint-disable-next-line no-eval
  (0, eval)(SOURCE);
}

afterEach(() => {
  [
    "wc",
    "wp",
    "twoincBlocksName",
    "twoinc",
    "twoincSelectWooHelper",
    "twoincCompanyCapture",
    "twoincAddressRoles",
    "Twoinc",
    "jQuery",
    "twoincDomHelper",
    "twoincCompanySearchControls",
    "twoincTermsConsent"
  ].forEach((key) => {
    delete window[key];
  });
  Object.keys(bodyHandlers).forEach((key) => delete bodyHandlers[key]);
  consentState.accepted = null;
  document.body.innerHTML = "";
});

/**
 * The base plugin's own globals, as twoinc.js leaves them on the page.
 * Nothing here is a reimplementation: the skin is only allowed to read the
 * controller's accessors and call its mount.
 */
const consentState = { accepted: null };

function baseGlobals(location, billing, shipping) {
  const calls = {
    mounts: 0,
    patches: [],
    resyncs: 0,
    shippingPatches: [],
    summaries: 0,
    summariesByRole: { billing: 0, shipping: 0 },
    rebinds: [],
    saves: 0,
    loads: 0,
    restores: [],
    order: []
  };
  const subscribers = {};
  const activeMethod = { name: null };
  const resolution = { finished: true, customerData: true };
  const captureValues = { company: "", company_id: "", mode: "search" };
  const shippingCaptureValues = { company: "", company_id: "" };
  const valuesFor = (role) => (role === "shipping" ? shippingCaptureValues : captureValues);
  const makeControl = (role) => ({
    role,
    addressFieldSelector: "#" + role + "_company_display",
    nativeCompanyRowSelector() {
      return "#" + this.role + "_company_field";
    },
    rebindUnlessManual() {
      calls.rebinds.push(this.role);
    },
    soleTrader: { refresh() {} },
    isTileLocation: () => role === "billing" && location === "payment_tile",
    companyFieldSelector() {
      return this.isTileLocation() ? "#twoinc_tile_company_name" : this.addressFieldSelector;
    },
    countryDidChange() {
      calls.order.push("seed:" + role);
      return false;
    },
    currentCountry: () => "GB",
    syncCompanySearchTileLocation() {
      calls.mounts += 1;
    },
    renderCompanySummary() {
      calls.summariesByRole[role] += 1;
      if (role === "billing") calls.summaries += 1;
    },
    fieldWrapClass: "two-company-field-wrap",
    readCapturedCompany: () => ({
      company_name: valuesFor(role).company,
      organization_number: valuesFor(role).company_id
    })
  });
  const control = makeControl("billing");
  const shippingControl = makeControl("shipping");

  window.twoinc = { company_search_location: location };
  window.Twoinc = {
    getInstance: () => ({
      onUpdatedCheckout() {
        calls.resyncs += 1;
      }
    })
  };
  window.twoincSelectWooHelper = control;
  window.twoincAddressRoles = {
    primary: () => "billing",
    invoice: () => "billing",
    delivery: () => "shipping",
    field: (role, name) => "#" + role + "_" + name
  };
  window.twoincCompanyCapture = {
    numberField: (role) => ({ val: () => valuesFor(role).company_id }),
    nameField: (role) => ({ val: () => valuesFor(role).company }),
    modeFor: () => captureValues.mode,
    numberFieldSelector: (role) =>
      role === twoincAddressRoles.invoice() ? "#company_id" : "#" + role + "_company_id",
    nameFieldSelector: (role) =>
      control.isTileLocation() && role === twoincAddressRoles.primary()
        ? "#company_name"
        : twoincAddressRoles.field(role, "company")
  };
  window.twoincCompanySearchControls = [control, shippingControl];
  // twoinc.js's own consent gate, which the skin calls rather than reimplements.
  window.twoincTermsConsent = {
    accepted: null,
    payload: () =>
      consentState.accepted === null
        ? {}
        : { twoinc_terms_accepted: consentState.accepted ? "1" : "" },
    validate: () =>
      consentState.accepted === false ? "You must accept payment terms to place order." : null
  };
  window.twoincDomHelper = {
    saveCheckoutInputs() {
      calls.saves += 1;
    },
    loadUserMetaInputs() {
      calls.order.push("user-meta");
      calls.selectorAtUserMeta = control.addressFieldSelector;
    },
    loadStorageInputs() {
      calls.loads += 1;
      // What the controller's own restore does: a bare value assignment.
      var input = document.getElementById("company_id");
      if (input && !input.value) input.value = "12345678";
    },
    restoreCapturedCompany() {
      calls.order.push("restore");
      calls.restores.push((document.getElementById("company_id") || {}).value);
    }
  };

  const blank = () => ({
    first_name: "",
    last_name: "",
    company: "",
    address_1: "",
    address_2: "",
    city: "",
    state: "",
    postcode: "",
    country: "",
    phone: "",
    email: ""
  });
  const address = Object.assign(blank(), billing || {});
  const shippingAddress = Object.assign(blank(), shipping || {});

  /** Fire the listeners one store's subscription registered. */
  function publish(store) {
    (subscribers[store] || []).forEach((fn) => fn());
  }

  return {
    calls,
    control,
    shippingControl,
    captureValues,
    shippingCaptureValues,
    address,
    shippingAddress,
    activeMethod,
    resolution,
    publish,

    data: {
      select: (store) =>
        store === "wc/store/payment"
          ? { getActivePaymentMethod: () => activeMethod.name }
          : {
              getCartData: () => ({}),
              getCustomerData: () =>
                resolution.customerData ? { billingAddress: address, shippingAddress } : {},
              getCartTotals: () => ({
                total_price: "38600",
                total_tax: "0",
                currency_minor_unit: 2
              }),
              // Only the resolver-backed selector ever finishes.
              hasFinishedResolution: (selector) => selector === "getCartData" && resolution.finished
            },
      dispatch: () => ({
        setBillingAddress(patch) {
          calls.patches.push(patch);
          Object.assign(address, patch);
        },
        setShippingAddress(patch) {
          calls.shippingPatches.push(patch);
          Object.assign(shippingAddress, patch);
        }
      }),
      subscribe: (fn, store) => {
        (subscribers[store || "any"] = subscribers[store || "any"] || []).push(fn);
        return () => {};
      }
    }
  };
}

describe("blocks-checkout.js registration", () => {
  test.each([
    { overrides: { wc: {} }, registers: false, description: "no Blocks registry on the page" },
    { overrides: { wp: {} }, registers: false, description: "no wp.element" },
    {
      overrides: { twoincBlocksName: undefined },
      registers: false,
      description: "gateway id never inlined"
    },
    {
      overrides: { wc: { wcBlocksRegistry: {}, wcSettings: { getSetting: () => null } } },
      registers: false,
      description: "no method data in wcSettings"
    },
    { overrides: {}, registers: true, description: "every global present" }
  ])("registers=$registers when $description", ({ overrides, registers }) => {
    const { env, registered } = globals(overrides);
    if (overrides.wc && overrides.wc.wcBlocksRegistry) {
      overrides.wc.wcBlocksRegistry.registerPaymentMethod = (config) => registered.push(config);
    }
    evaluate(env);
    expect(registered.length > 0).toBe(registers);
  });

  test("the method label reads title, then logo, then the about control", () => {
    const { env, registered } = globals({});
    evaluate(env);

    const order = registered[0].label
      .type()
      .children.filter(Boolean)
      .map((node) => node.props.className);
    expect(order).toEqual(["twoinc-blocks-title", "twoinc-blocks-icon", "twoinc-blocks-about"]);
  });

  test("the registered method carries the server-side identity and features", () => {
    const { env, registered } = globals({});
    evaluate(env);
    expect(registered[0].name).toBe("woocommerce-gateway-tillit");
    expect(registered[0].ariaLabel).toBe("Business invoice");
    expect(registered[0].supports.features).toEqual(["products", "refunds"]);
  });

  test.each([
    {
      slot: (config) => config.label.type().children,
      expected: METHOD_DATA.iconUrl,
      description: "the label carries the brand logo"
    },
    {
      slot: (config) => config.label.type().children,
      expected: METHOD_DATA.about,
      description: "the label carries the about control"
    },
    {
      slot: (config) => config.content.type().children,
      expected: METHOD_DATA.description,
      description: "the content is the gateway's own payment-box description"
    },
    {
      slot: (config) => config.content.type().children,
      expected: METHOD_DATA.terms,
      description: "the content carries the consent block the classic checkout emits too"
    }
  ])("$description", ({ slot, expected }) => {
    const { env, registered } = globals({});
    evaluate(env);
    const values = slot(registered[0])
      .filter(Boolean)
      .map((node) => node.props.src || (node.props.dangerouslySetInnerHTML || {}).__html);
    expect(values).toContain(expected);
  });
});

describe("blocks-checkout.js reuses the classic controller", () => {
  test.each([
    {
      location: "address_area",
      markup: '<input id="billing-company">',
      anchored: "#billing-company",
      mounts: 1,
      description: "address placement mounts on WooCommerce's own company row"
    },
    {
      location: "address_area",
      markup: "",
      anchored: "#billing-company",
      mounts: 0,
      description: "address placement waits for the row to render"
    },
    {
      location: "payment_tile",
      markup: "",
      anchored: "#billing-company",
      mounts: 1,
      description: "tile placement leaves the mount to the controller"
    }
  ])("$description", ({ location, markup, anchored, mounts }) => {
    document.body.innerHTML = markup;
    const base = baseGlobals(location);
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    expect(base.control.addressFieldSelector).toBe(anchored);
    expect(base.calls.mounts).toBe(mounts);
  });

  test.each([
    {
      rows: ["shipping"],
      mounts: 0,
      rebinds: ["shipping"],
      description: "the delivery address alone mounts the delivery control"
    },
    {
      rows: ["billing", "shipping"],
      mounts: 1,
      rebinds: ["shipping"],
      description: "both address forms mount both roles' controls"
    },
    {
      rows: ["billing"],
      mounts: 1,
      rebinds: [],
      description: "no delivery form leaves the delivery control unmounted"
    }
  ])("$description", ({ rows, mounts, rebinds }) => {
    document.body.innerHTML = rows
      .map(
        (role) =>
          '<div class="wc-block-components-text-input"><input id="' + role + '-company"></div>'
      )
      .join("");
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    expect([base.control.addressFieldSelector, base.shippingControl.addressFieldSelector]).toEqual([
      "#billing-company",
      "#shipping-company"
    ]);
    // The delivery role re-binds; only the invoice role has a tile to weigh.
    expect(base.calls.mounts).toBe(mounts);
    expect(base.calls.rebinds).toEqual(rebinds);
  });

  test("each role's native company row is created inside that role's Blocks row", () => {
    document.body.innerHTML = ["billing", "shipping"]
      .map(
        (role) =>
          '<div class="wc-block-components-text-input"><input id="' + role + '-company"></div>'
      )
      .join("");
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    ["billing", "shipping"].forEach((role) => {
      const row = document.getElementById(role + "-company_field");
      expect(row).not.toBeNull();
      expect(document.getElementById(role + "_company_field").parentElement).toBe(row);
    });
  });

  test.each([
    ["billing", "Oslo", "patches"],
    ["shipping", "Bergen", "shippingPatches"]
  ])("the %s address mirrors both ways, against its own store key", async (role, seeded, key) => {
    const base = baseGlobals("address_area", { city: "Oslo" }, { city: "Bergen" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    const input = document.getElementById(role + "_city");
    expect(input.value).toBe(seeded);

    input.value = "Trondheim";
    await Promise.resolve();

    expect(base.calls[key]).toEqual([{ city: "Trondheim" }]);
  });

  test("an already-anchored control is never re-mounted", () => {
    document.body.innerHTML =
      '<span class="two-company-field-wrap"><input id="billing-company"></span>';
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    expect(base.calls.mounts).toBe(0);
  });

  test.each([
    {
      seed: { city: "Oslo" },
      written: null,
      expectShadow: { city: "Oslo" },
      expectPatches: [],
      description: "the store's address reaches the fields the controller reads"
    },
    {
      seed: {},
      written: { company: "EXAMPLE TRADING LIMITED" },
      expectShadow: { company: "EXAMPLE TRADING LIMITED" },
      expectPatches: [{ company: "EXAMPLE TRADING LIMITED" }],
      description: "a capture the controller wrote reaches the store"
    },
    {
      seed: {},
      written: { address_1: "Example House", postcode: "EX1 2AB" },
      expectShadow: { address_1: "Example House" },
      expectPatches: [{ address_1: "Example House", postcode: "EX1 2AB" }],
      description: "a whole registry autofill reaches the store as one dispatch"
    }
  ])("$description", async ({ seed, written, expectShadow, expectPatches }) => {
    const base = baseGlobals("address_area", seed);
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    if (written) {
      // Exactly how the controller writes: jQuery assigns `.value` and fires
      // nothing.
      Object.keys(written).forEach((key) => {
        document.getElementById("billing_" + key).value = written[key];
      });
      await Promise.resolve();
    }

    Object.keys(expectShadow).forEach((key) => {
      expect(document.getElementById("billing_" + key).value).toBe(expectShadow[key]);
    });
    expect(base.calls.patches).toEqual(expectPatches);
  });

  test("a pull never overwrites a write that has not reached the store yet", async () => {
    const base = baseGlobals("address_area", { city: "Oslo" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    // The controller's write, then a store notification arriving before the
    // queued push has dispatched.
    document.getElementById("billing_city").value = "Bergen";
    base.publish("wc/store/cart");
    await Promise.resolve();

    expect(document.getElementById("billing_city").value).toBe("Bergen");
    expect(base.calls.patches).toEqual([{ city: "Bergen" }]);
  });

  test("nothing is left running on a timer", () => {
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    const interval = jest.spyOn(window, "setInterval");
    evaluate(env);

    expect(interval).not.toHaveBeenCalled();
  });

  test("the control is re-anchored when the checkout block replaces its row", () => {
    document.body.innerHTML =
      '<div class="wp-block-woocommerce-checkout"><div class="wc-block-components-text-input"></div></div>';
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;

    const observed = [];
    const RealObserver = window.MutationObserver;
    window.MutationObserver = function (fn) {
      observed.push(fn);
      return new RealObserver(fn);
    };
    window.MutationObserver.prototype = RealObserver.prototype;
    evaluate(env);
    window.MutationObserver = RealObserver;
    const atBootstrap = base.calls.mounts;

    document.querySelector(".wc-block-components-text-input").innerHTML =
      '<input id="billing-company">';
    observed.forEach((fn) => fn([]));

    expect(base.calls.mounts).toBe(atBootstrap + 1);
  });

  test.each([
    {
      location: "payment_tile",
      billing: { company: "EXAMPLE TRADING LIMITED", company_id: "12345678" },
      shipping: { company: "", company_id: "" },
      expected: {
        company_id: "12345678",
        company_name: "EXAMPLE TRADING LIMITED",
        shipping_company_id: "",
        shipping_company: ""
      },
      description: "the invoice capture travels in the tile's own carriers"
    },
    {
      location: "address_area",
      billing: { company: "", company_id: "" },
      shipping: { company: "DELIVERY DEPOT LIMITED", company_id: "87654321" },
      expected: {
        company_id: "",
        billing_company: "",
        shipping_company_id: "87654321",
        shipping_company: "DELIVERY DEPOT LIMITED"
      },
      description: "a delivery-only capture, all a same-address checkout ever has, still travels"
    },
    {
      location: "address_area",
      billing: { company: "INVOICE HOLDINGS LIMITED", company_id: "12345678" },
      shipping: { company: "DELIVERY DEPOT LIMITED", company_id: "87654321" },
      expected: {
        company_id: "12345678",
        billing_company: "INVOICE HOLDINGS LIMITED",
        shipping_company_id: "87654321",
        shipping_company: "DELIVERY DEPOT LIMITED"
      },
      description: "both roles travel unresolved, for the server to prefer the invoice one"
    },
    {
      location: "address_area",
      billing: { company: "", company_id: "" },
      shipping: { company: "", company_id: "" },
      expected: {
        company_id: "",
        billing_company: "",
        shipping_company_id: "",
        shipping_company: ""
      },
      description: "no capture at all leaves the server's own guard to refuse the order"
    }
  ])("$description", ({ location, billing, shipping, expected }) => {
    const base = baseGlobals(location);
    const { env, registered } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    let handler = null;
    registered[0].content.type({
      eventRegistration: {
        onPaymentSetup(fn) {
          handler = fn;
          return () => {};
        }
      },
      emitResponse: { responseTypes: { SUCCESS: "success" } }
    });

    Object.assign(base.captureValues, billing);
    Object.assign(base.shippingCaptureValues, shipping);

    expect(handler()).toEqual({
      type: "success",
      meta: { paymentMethodData: expected }
    });
  });
});

describe("blocks-checkout.js gates on the shared terms consent", () => {
  /** The skin's own payment-setup handler, over the given consent state. */
  function paymentSetup(accepted) {
    consentState.accepted = accepted;
    const base = baseGlobals("address_area");
    const { env, registered } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    let handler = null;
    registered[0].content.type({
      eventRegistration: {
        onPaymentSetup(fn) {
          handler = fn;
          return () => {};
        }
      },
      emitResponse: { responseTypes: { SUCCESS: "success", ERROR: "error" } }
    });
    return handler();
  }

  test("an unticked consent refuses the Store API submit with the shared sentence", () => {
    expect(paymentSetup(false)).toEqual({
      type: "error",
      message: "You must accept payment terms to place order."
    });
  });

  test("a ticked consent travels as payment data under the name the server reads", () => {
    expect(paymentSetup(true).meta.paymentMethodData.twoinc_terms_accepted).toBe("1");
  });
});

describe("blocks-checkout.js hands the controller the whole page", () => {
  test("the tile's own slots being ready triggers the controller's full re-render pass", () => {
    const base = baseGlobals("payment_tile");
    const { env, registered } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    const atBootstrap = base.calls.resyncs;

    registered[0].content.type({});

    expect(base.calls.resyncs).toBe(atBootstrap + 1);
  });

  test.each([
    {
      id: "billing-company_field",
      holdsTheField: true,
      description: "Blocks' own company row is the controller's display row"
    },
    {
      id: "billing_company_field",
      holdsTheField: false,
      // toggleBusinessFields() hides the native row while the search is the
      // active surface, and on a Blocks checkout that row must therefore
      // never be the buyer's only company field (ABN-554).
      description: "the native row the controller hides carries no company field"
    }
  ])("$description", ({ id, holdsTheField }) => {
    document.body.innerHTML =
      '<div class="wc-block-components-text-input"><input id="billing-company"></div>';
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    const row = document.getElementById(id);
    expect(row).not.toBeNull();
    expect(row.contains(document.getElementById("billing-company"))).toBe(holdsTheField);
  });

  test("a rebuilt company row is re-anchored and the summary re-rendered onto it", () => {
    document.body.innerHTML =
      '<div class="wp-block-woocommerce-checkout">' +
      '<div class="wc-block-components-text-input"><input id="billing-company"></div>' +
      "</div>";
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;

    const observers = [];
    const RealObserver = window.MutationObserver;
    window.MutationObserver = function (fn) {
      observers.push(fn);
      return new RealObserver(fn);
    };
    window.MutationObserver.prototype = RealObserver.prototype;
    evaluate(env);
    window.MutationObserver = RealObserver;

    const mountsAtFirstAnchor = base.calls.mounts;
    const summariesAtFirstAnchor = base.calls.summaries;

    // What React does on a store update: the row is replaced, taking the id
    // and the control's wrapper with it.
    document.querySelector(".wp-block-woocommerce-checkout").innerHTML =
      '<div class="wc-block-components-text-input"><input id="billing-company"></div>';
    observers.forEach((fn) => fn([]));

    const row = document.getElementById("billing-company_field");
    expect(row).not.toBeNull();
    expect(row.contains(document.getElementById("billing-company"))).toBe(true);
    // A child, never a sibling: the controller re-inserts the summary into the
    // slot directly after this row on every render.
    expect(document.getElementById("billing_company_field").parentElement).toBe(row);
    expect(base.calls.mounts).toBe(mountsAtFirstAnchor + 1);
    expect(base.calls.summaries).toBe(summariesAtFirstAnchor + 1);
  });
});

describe("blocks-checkout.js reaches the rest of the tile's surfaces", () => {
  function withCartApi(base) {
    const updates = [];
    const { env, registered } = globals({});
    env.wp.data = base.data;
    env.wc.blocksCheckout = {
      extensionCartUpdate(payload) {
        updates.push(payload);
        return Promise.resolve();
      }
    };
    return { env, registered, updates };
  }

  test.each([
    ["order-total", 386],
    ["tax-rate", 0]
  ])("the controller reads %s off the store's cart totals", (name, expected) => {
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    const node = document.querySelector("." + name + " .woocommerce-Price-amount bdi");
    expect(parseFloat(node.textContent)).toBe(expected);
  });

  test.each([
    {
      active: "woocommerce-gateway-tillit",
      expected: [{ active: true }],
      description: "the chosen method is named to the cart, so the surcharge applies"
    },
    {
      active: "cod",
      expected: [{ active: false }],
      description: "and another gateway being chosen withdraws it, on a reload too"
    }
  ])("$description", ({ active, expected }) => {
    const base = baseGlobals("payment_tile");
    const { env, updates } = withCartApi(base);
    base.activeMethod.name = active;
    evaluate(env);

    expect(updates.map((u) => u.data)).toEqual(expected);
    updates.forEach((u) => expect(u.namespace).toBe("twoinc-payment-gateway"));
  });

  test("an unchanged choice is not re-announced — each announcement is a cart request", () => {
    const base = baseGlobals("payment_tile");
    const { env, updates } = withCartApi(base);
    base.activeMethod.name = "woocommerce-gateway-tillit";
    evaluate(env);
    updates.length = 0;

    base.publish("wc/store/payment");
    base.publish("wc/store/payment");

    expect(updates).toEqual([]);
  });

  test("a term selection recalculates the cart and re-renders off the answer", async () => {
    const base = baseGlobals("payment_tile");
    const { env, registered, updates } = withCartApi(base);
    evaluate(env);
    registered[0].content.type({});
    const atMount = base.calls.resyncs;
    updates.length = 0;

    // What the controller triggers once its term-selection call has landed.
    await bodyHandlers["update_checkout.twoincBlocks"]();
    await Promise.resolve();

    expect(updates).toEqual([{ namespace: "twoinc-payment-gateway", data: { active: true } }]);
    expect(base.calls.resyncs).toBe(atMount + 1);
  });
});

describe("blocks-checkout.js persists the capture across a page load", () => {
  test.each([
    {
      container: "checkout",
      description: "the shadow carries the container the controller's snapshot looks for"
    },
    {
      container: "woocommerce-checkout",
      description: "and the second class of that container"
    },
    { container: "custom-checkout", description: "and the third" }
  ])("$description", ({ container }) => {
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    expect(document.getElementById("twoinc-blocks-shadow").classList.contains(container)).toBe(
      true
    );
  });

  test("the storage host stays off screen under the plugin stylesheet", () => {
    // `.custom-checkout` is on the host only so the snapshot recognises it; an
    // author `display` keyed on that class alone beats the UA's `[hidden]` and
    // paints every one of these inputs onto the Blocks checkout (ABN-554).
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    harness.injectStylesheet();

    const host = document.getElementById("twoinc-blocks-shadow");
    expect(window.getComputedStyle(host).display).toBe("none");
  });

  test("the control is pointed at this checkout's own company field before the restore paints it", () => {
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    expect(base.calls.selectorAtUserMeta).toBe("#billing-company");
  });

  test("a write made while the cart held no address is not pinned forever", async () => {
    const base = baseGlobals("address_area", { city: "Oslo" });
    base.resolution.customerData = false;
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    // The controller writes while the store can answer nothing; the key must
    // not stay marked, or the pull skips it for the life of the page.
    shadowInput("billing_city").value = "Bergen";
    await Promise.resolve();

    base.resolution.customerData = true;
    base.publish("wc/store/cart");

    expect(shadowInput("billing_city").value).toBe("Oslo");
  });

  test("the restore waits for the cart's customer data to resolve", () => {
    const base = baseGlobals("address_area");
    base.resolution.finished = false;
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    // Restoring against the blank address the store answers with before
    // resolution would push the snapshot over the buyer's real address.
    expect(base.calls.restores).toEqual([]);

    base.resolution.finished = true;
    base.publish("wc/store/cart");

    expect(base.calls.restores).toEqual(["12345678"]);
  });

  test.each([
    { store: null, description: "no cart store registered yet" },
    { store: {}, description: "a cart store with no resolution to report" }
  ])("the restore is skipped, not fatal, when $description", ({ store }) => {
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = Object.assign({}, base.data, {
      select: (name) => (name === "wc/store/cart" ? store : base.data.select(name))
    });

    expect(() => evaluate(env)).not.toThrow();
    expect(base.calls.restores).toEqual([]);
  });

  test("a push carries only what the controller wrote, never a concurrent edit", async () => {
    const base = baseGlobals("address_area", { city: "Oslo" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    // The controller writes one field; the buyer's edit to another reaches the
    // store before that write is dispatched. Sending every divergent key would
    // put the buyer's city back to the value the shadow still holds.
    document.getElementById("billing_company").value = "EXAMPLE TRADING LIMITED";
    base.address.city = "Bergen";
    await Promise.resolve();

    expect(base.calls.patches).toEqual([{ company: "EXAMPLE TRADING LIMITED" }]);
    expect(base.address.city).toBe("Bergen");
  });

  test.each([
    {
      landed: "",
      shadow: "Example House",
      patches: [{ address_1: "Example House" }, { address_1: "Example House" }],
      description: "a store put back to the value the write replaced is re-sent, not painted back"
    },
    {
      landed: "Buyer House",
      shadow: "Buyer House",
      patches: [{ address_1: "Example House" }],
      description: "a store value the write never replaced is the buyer's, and takes the field"
    }
  ])("$description", async ({ landed, shadow, patches }) => {
    const base = baseGlobals("address_area", { address_1: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    // The registry address the controller writes when the buyer picks a company.
    shadowInput("billing_address_1").value = "Example House";
    await Promise.resolve();

    base.address.address_1 = landed;
    base.publish("wc/store/cart");
    await Promise.resolve();

    expect(shadowInput("billing_address_1").value).toBe(shadow);
    expect(base.calls.patches).toEqual(patches);
  });

  test("a buyer clearing the field the write filled is not overruled by it", async () => {
    document.body.innerHTML = '<input id="billing-address_1">';
    const base = baseGlobals("address_area", { address_1: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    shadowInput("billing_address_1").value = "Example House";
    await Promise.resolve();

    // Clearing Blocks' own field puts the store back on the value the write
    // replaced, which is the shape of the stale response push() defends against.
    document
      .getElementById("billing-address_1")
      .dispatchEvent(new window.Event("input", { bubbles: true }));
    base.address.address_1 = "";
    base.publish("wc/store/cart");
    await Promise.resolve();

    expect(base.calls.patches).toEqual([{ address_1: "Example House" }]);
    expect(shadowInput("billing_address_1").value).toBe("");
  });

  test("a store that keeps refusing a write is left holding the field", async () => {
    const base = baseGlobals("address_area", { address_1: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    shadowInput("billing_address_1").value = "Example House";
    await Promise.resolve();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      base.address.address_1 = "";
      base.publish("wc/store/cart");
      await Promise.resolve();
    }

    // Three sends, then the store is answering for the field and the buyer sees
    // what would be submitted rather than a value nothing will carry.
    expect(base.calls.patches).toHaveLength(3);
    expect(shadowInput("billing_address_1").value).toBe("");
  });

  test("a choice that could not be sent is not recorded as sent", () => {
    const base = baseGlobals("payment_tile");
    const { env } = globals({});
    env.wp.data = base.data;
    // No wc.blocksCheckout on the page, so extensionCartUpdate cannot be called.
    base.activeMethod.name = "woocommerce-gateway-tillit";
    evaluate(env);

    const updates = [];
    env.wc.blocksCheckout = {
      extensionCartUpdate(payload) {
        updates.push(payload);
        return Promise.resolve();
      }
    };
    base.publish("wc/store/payment");

    expect(updates.map((u) => u.data)).toEqual([{ active: true }]);
  });

  test("the controller's own restore pass runs, then its country tracker is seeded", () => {
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    // Restored before the tracker is seeded, or the next re-render reads the
    // restored country as a change and clears the capture again.
    expect(base.calls.restores).toEqual(["12345678"]);
    // The user-meta pass sets the flag the snapshot replay reads, so it has
    // to come first.
    expect(base.calls.order).toEqual(["user-meta", "restore", "seed:billing", "seed:shipping"]);
  });

  test.each([
    { id: "company_id", saves: 1, patches: 0, description: "a captured number is snapshotted" },
    {
      id: "billing_company",
      saves: 0,
      patches: 1,
      description: "an address field goes to the store instead"
    }
  ])("$description", async ({ id, saves, patches }) => {
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    // The restore pass queues its own write; let it settle before counting.
    await Promise.resolve();
    base.calls.saves = 0;
    base.calls.patches.length = 0;

    document.getElementById(id).value = "07918059";
    await Promise.resolve();

    expect(base.calls.saves).toBe(saves);
    expect(base.calls.patches.length).toBe(patches);
  });
});
