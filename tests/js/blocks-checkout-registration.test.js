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

/** The skin binds on the document, and every evaluation would otherwise leave its listeners live. */
const documentListeners = [];

function evaluate(env) {
  Object.keys(env).forEach((key) => {
    window[key] = env[key];
  });
  const add = document.addEventListener.bind(document);
  document.addEventListener = (type, fn, options) => {
    documentListeners.push([type, fn, options]);
    add(type, fn, options);
  };
  try {
    // eslint-disable-next-line no-eval
    (0, eval)(SOURCE);
  } finally {
    delete document.addEventListener;
  }
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
  documentListeners
    .splice(0)
    .forEach(([type, fn, options]) => document.removeEventListener(type, fn, options));
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
    isTileLocation() {
      if (this.role !== twoincAddressRoles.primary()) return false;
      return window.twoinc.company_search_location === "payment_tile";
    },
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

  /**
   * TWO-25800. A buyer arriving from the product-page buy button has the
   * gateway named in the session, so the tile selects itself on mount. The
   * announcement that would otherwise fire first says {active:false} about a
   * method the buyer is about to be moved off, and neither request is awaited
   * — if that one settles last, the server clears the chosen method and
   * recalculates without the surcharge while the tile shows this one selected.
   */
  describe("the buy-button preselect", () => {
    /** A radio the skin can click, wired to move the payment store. */
    function paymentOption(base) {
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.id = "radio-control-wc-payment-method-options-woocommerce-gateway-tillit";
      radio.addEventListener("click", () => {
        base.activeMethod.name = "woocommerce-gateway-tillit";
        base.publish("wc/store/payment");
      });
      document.body.appendChild(radio);
      return radio;
    }

    afterEach(() => {
      delete METHOD_DATA.preselect;
    });

    test("no {active:false} is announced on the way to selecting this method", () => {
      METHOD_DATA.preselect = true;
      const base = baseGlobals("payment_tile");
      const { env, updates } = withCartApi(base);
      base.activeMethod.name = "cod";
      paymentOption(base);

      evaluate(env);

      expect(updates.map((u) => u.data)).toEqual([{ active: true }]);
      expect(base.activeMethod.name).toBe("woocommerce-gateway-tillit");
    });

    test("a buyer who did not arrive from the button is announced as before", () => {
      const base = baseGlobals("payment_tile");
      const { env, updates } = withCartApi(base);
      base.activeMethod.name = "cod";
      paymentOption(base);

      evaluate(env);

      expect(updates.map((u) => u.data)).toEqual([{ active: false }]);
      expect(base.activeMethod.name).toBe("cod");
    });

    test("the store catching up a tick later still announces only {active:true}", async () => {
      METHOD_DATA.preselect = true;
      const base = baseGlobals("payment_tile");
      const { env, updates } = withCartApi(base);
      base.activeMethod.name = "cod";
      // React does not update the store inside the click handler, so the
      // realistic case is the store catching up on a later tick. Ordering
      // alone does not cover this; the announcement has to be held back.
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.id = "radio-control-wc-payment-method-options-woocommerce-gateway-tillit";
      radio.addEventListener("click", () => {
        Promise.resolve().then(() => {
          base.activeMethod.name = "woocommerce-gateway-tillit";
          base.publish("wc/store/payment");
        });
      });
      document.body.appendChild(radio);

      evaluate(env);
      await Promise.resolve();
      await Promise.resolve();

      expect(updates.map((u) => u.data)).toEqual([{ active: true }]);
    });

    test("the radio mounting later still gets preselected", async () => {
      METHOD_DATA.preselect = true;
      const base = baseGlobals("payment_tile");
      const { env, updates } = withCartApi(base);
      base.activeMethod.name = "cod";
      // The payment step mounts after bootstrap, which is the ordinary case
      // for a guest passing through address and shipping first.
      const root = document.createElement("div");
      root.className = "wp-block-woocommerce-checkout";
      document.body.appendChild(root);

      evaluate(env);
      expect(updates).toEqual([]);

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.id = "radio-control-wc-payment-method-options-woocommerce-gateway-tillit";
      radio.addEventListener("click", () => {
        base.activeMethod.name = "woocommerce-gateway-tillit";
        base.publish("wc/store/payment");
      });
      root.appendChild(radio);
      // The observer is asynchronous, so let it deliver.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(base.activeMethod.name).toBe("woocommerce-gateway-tillit");
      expect(updates.map((u) => u.data)).toEqual([{ active: true }]);
    });

    test("the option refusing the click does not silence the tile forever", () => {
      METHOD_DATA.preselect = true;
      const base = baseGlobals("payment_tile");
      const { env, updates } = withCartApi(base);
      base.activeMethod.name = "cod";
      // A radio that accepts the click and does nothing with it: the option
      // genuinely refuses. A DISABLED radio is a different case and retries
      // instead - see the test below.
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.id = "radio-control-wc-payment-method-options-woocommerce-gateway-tillit";
      document.body.appendChild(radio);

      evaluate(env);
      base.publish("wc/store/payment");

      expect(updates.map((u) => u.data)).toEqual([{ active: false }]);
    });

    test("a radio that is only temporarily disabled is retried, not abandoned", async () => {
      METHOD_DATA.preselect = true;
      const base = baseGlobals("payment_tile");
      const { env, updates } = withCartApi(base);
      base.activeMethod.name = "cod";
      // Blocks disables the options while checkout state resolves. `click()`
      // on a disabled input is a no-op, so latching the single attempt here
      // would abandon the preselect for good.
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.id = "radio-control-wc-payment-method-options-woocommerce-gateway-tillit";
      radio.disabled = true;
      radio.addEventListener("click", () => {
        if (radio.disabled) return;
        base.activeMethod.name = "woocommerce-gateway-tillit";
        base.publish("wc/store/payment");
      });
      document.body.appendChild(radio);

      evaluate(env);
      base.publish("wc/store/payment");

      // Still not ours, and nothing announced: the attempt was not spent.
      expect(base.activeMethod.name).toBe("cod");
      expect(updates).toEqual([]);

      // Checkout state settles and the option becomes usable. Deliberately NO
      // store publish here: enabling an input already in the DOM is an
      // attribute change, and neither the store subscription nor the
      // childList observer need see it. Publishing here would supply the
      // retry trigger the code is supposed to provide for itself, and the
      // test would pass while a real checkout hung.
      radio.disabled = false;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(base.activeMethod.name).toBe("woocommerce-gateway-tillit");
      expect(updates.map((u) => u.data)).toEqual([{ active: true }]);
    });

    test("a disabled radio replaced by another disabled one is rebound, not stranded", async () => {
      METHOD_DATA.preselect = true;
      const base = baseGlobals("payment_tile");
      const { env, updates } = withCartApi(base);
      base.activeMethod.name = "cod";
      const root = document.createElement("div");
      root.className = "wp-block-woocommerce-checkout";
      document.body.appendChild(root);

      const makeRadio = () => {
        const r = document.createElement("input");
        r.type = "radio";
        r.id = "radio-control-wc-payment-method-options-woocommerce-gateway-tillit";
        r.disabled = true;
        r.addEventListener("click", () => {
          if (r.disabled) return;
          base.activeMethod.name = "woocommerce-gateway-tillit";
          base.publish("wc/store/payment");
        });
        return r;
      };

      const first = makeRadio();
      root.appendChild(first);
      evaluate(env);
      base.publish("wc/store/payment");
      expect(base.activeMethod.name).toBe("cod");

      // Blocks re-renders and swaps the node. A watcher left on `first` would
      // never fire again, stranding the preselect.
      root.removeChild(first);
      const second = makeRadio();
      root.appendChild(second);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Enabling the REPLACEMENT must be what lands it. No store publish.
      second.disabled = false;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(base.activeMethod.name).toBe("woocommerce-gateway-tillit");
      expect(updates.map((u) => u.data)).toEqual([{ active: true }]);
    });

    test("the gateway being withdrawn releases the preselect rather than hanging", async () => {
      METHOD_DATA.preselect = true;
      const base = baseGlobals("payment_tile");
      const { env, updates } = withCartApi(base);
      base.activeMethod.name = "cod";
      const root = document.createElement("div");
      root.className = "wp-block-woocommerce-checkout";
      document.body.appendChild(root);

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.id = "radio-control-wc-payment-method-options-woocommerce-gateway-tillit";
      radio.disabled = true;
      root.appendChild(radio);

      evaluate(env);
      base.publish("wc/store/payment");
      // Outstanding: nothing announced while the preselect still hopes.
      expect(updates).toEqual([]);

      // Checkout resolves and withdraws the gateway instead of enabling it —
      // an unavailable country or basket. Nothing will bring it back, so the
      // preselect must release and let the session be corrected.
      root.removeChild(radio);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(base.activeMethod.name).toBe("cod");
      expect(updates.map((u) => u.data)).toEqual([{ active: false }]);
    });
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

  test("a write made while the cart held no address is sent once it resolves", async () => {
    const base = baseGlobals("address_area", { city: "Oslo" });
    base.resolution.customerData = false;
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    // Given: a write whose microtask push finds no address, as a real resolution gives.
    shadowInput("billing_city").value = "Bergen";
    await Promise.resolve();

    expect(base.calls.patches).toEqual([]);

    // When: the cart resolves a tick later.
    base.resolution.customerData = true;
    base.publish("wc/store/cart");

    // Then: measured against the address that answered.
    expect(base.calls.patches).toEqual([{ city: "Bergen" }]);
    expect(base.address.city).toBe("Bergen");
    expect(shadowInput("billing_city").value).toBe("Bergen");
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

  test("a write recorded before the cart resolved still reaches the store", async () => {
    const base = baseGlobals("address_area", { city: "Oslo" });
    base.resolution.customerData = false;
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    shadowInput("billing_city").value = "Bergen";
    // The cart resolves between the write and the microtask push that write queued.
    base.resolution.customerData = true;
    base.publish("wc/store/cart");
    await Promise.resolve();

    expect(base.calls.patches).toEqual([{ city: "Bergen" }]);
    expect(base.address.city).toBe("Bergen");
  });

  test("a write the store has taken is still defended against a revert to what it replaced", async () => {
    const base = baseGlobals("address_area", { address_1: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    // Given: the store has taken the write.
    shadowInput("billing_address_1").value = "Example House";
    await Promise.resolve();
    base.publish("wc/store/cart");
    await Promise.resolve();

    // When: a response older than the write reverts it.
    base.address.address_1 = "";
    base.publish("wc/store/cart");
    await Promise.resolve();

    // Then: the field is still the write's and the revert is re-sent.
    expect(base.calls.patches).toEqual([
      { address_1: "Example House" },
      { address_1: "Example House" }
    ]);
    expect(shadowInput("billing_address_1").value).toBe("Example House");
  });

  test("a re-send the store has not applied yet is not painted over by the revert", async () => {
    const base = baseGlobals("address_area", { address_1: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    // A Store API that queues the patch instead of applying it in the call, so
    // the pass that re-sends still reads the value the write is opposing.
    env.wp.data.dispatch = () => ({
      setBillingAddress(patch) {
        base.calls.patches.push(patch);
      },
      setShippingAddress() {}
    });
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    // Given: the store has taken the write.
    shadowInput("billing_address_1").value = "Example House";
    await Promise.resolve();
    base.address.address_1 = "Example House";
    base.publish("wc/store/cart");
    await Promise.resolve();

    // When: a response older than the write reverts it.
    base.address.address_1 = "";
    base.publish("wc/store/cart");
    await Promise.resolve();

    // Then: the field is still the write's, and the re-send is in flight.
    expect(base.calls.patches).toEqual([
      { address_1: "Example House" },
      { address_1: "Example House" }
    ]);
    expect(shadowInput("billing_address_1").value).toBe("Example House");
  });

  test("a write whose shadow input has gone is released rather than re-sent", async () => {
    const base = baseGlobals("address_area", { address_1: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    // Given: a recorded write whose field the page then dropped.
    shadowInput("billing_address_1").value = "Example House";
    shadowInput("billing_address_1").remove();

    // When: the store answers.
    await Promise.resolve();
    base.publish("wc/store/cart");
    await Promise.resolve();

    expect(base.calls.patches).toEqual([]);
  });

  test("a write the resolved cart already agreed with opposes nothing after it", async () => {
    const base = baseGlobals("address_area", { city: "Bergen" });
    base.resolution.customerData = false;
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    // Given: a write the resolving address already carries, so it replaced nothing.
    shadowInput("billing_city").value = "Bergen";
    await Promise.resolve();
    base.resolution.customerData = true;
    base.publish("wc/store/cart");
    await Promise.resolve();

    // When: the store answers with its own next value.
    base.address.city = "Oslo";
    base.publish("wc/store/cart");
    await Promise.resolve();

    // Then: that value is the store's, not a revert.
    expect(base.calls.patches).toEqual([]);
    expect(shadowInput("billing_city").value).toBe("Oslo");
  });

  test("a write the store has taken no longer skips the pull for the life of the page", async () => {
    const base = baseGlobals("address_area", { address_1: "", city: "Oslo" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    // Given: the store has taken the write.
    shadowInput("billing_address_1").value = "Example House";
    await Promise.resolve();
    base.publish("wc/store/cart");

    // When: a response lands mid-dispatch, so the pass it triggers repaints
    // with no push before it.
    env.wp.data.dispatch = () => ({
      setBillingAddress(patch) {
        base.calls.patches.push(patch);
        Object.assign(base.address, patch);
        base.address.address_1 = "Third House";
        base.publish("wc/store/cart");
      },
      setShippingAddress() {}
    });
    shadowInput("billing_city").value = "Bergen";
    await Promise.resolve();

    // Then: the store answers for the field again.
    expect(shadowInput("billing_address_1").value).toBe("Third House");
  });

  test("a store notifying from inside the dispatch spends one send, not all three", async () => {
    const base = baseGlobals("address_area", { address_1: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    // A store that notifies its subscribers synchronously and keeps its own value.
    env.wp.data.dispatch = () => ({
      setBillingAddress(patch) {
        base.calls.patches.push(patch);
        base.publish("wc/store/cart");
      },
      setShippingAddress() {}
    });
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    shadowInput("billing_address_1").value = "Example House";
    await Promise.resolve();

    expect(base.calls.patches).toEqual([{ address_1: "Example House" }]);
  });

  test("the control repainting the company field it owns does not end the write", async () => {
    document.body.innerHTML = '<input id="billing-company">';
    const base = baseGlobals("address_area", { company: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    shadowInput("billing_company").value = "Example Trading Limited";
    await Promise.resolve();

    // What `setDisplayText()` fires on a rebind: the held name painted back, then `change`.
    const field = document.getElementById("billing-company");
    field.value = "Example Trading Limited";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    base.address.company = "";
    base.publish("wc/store/cart");
    await Promise.resolve();

    expect(base.calls.patches).toEqual([
      { company: "Example Trading Limited" },
      { company: "Example Trading Limited" }
    ]);
    expect(shadowInput("billing_company").value).toBe("Example Trading Limited");
  });

  test("a buyer clearing the company field is not overruled by the write that filled it", async () => {
    document.body.innerHTML = '<input id="billing-company">';
    const base = baseGlobals("address_area", { company: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    shadowInput("billing_company").value = "Example Trading Limited";
    await Promise.resolve();

    // Same field and same event as a repaint; the value left in it is the only tell.
    document
      .getElementById("billing-company")
      .dispatchEvent(new window.Event("change", { bubbles: true }));
    base.address.company = "";
    base.publish("wc/store/cart");
    await Promise.resolve();

    expect(base.calls.patches).toEqual([{ company: "Example Trading Limited" }]);
    expect(shadowInput("billing_company").value).toBe("");
  });

  test("an edit still releases its hold when twoinc.js's settings never inlined", async () => {
    document.body.innerHTML = '<input id="billing-address_1">';
    const base = baseGlobals("address_area", { address_1: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    // The controller is a script dependency; its settings object is inlined separately.
    delete window.twoinc;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    shadowInput("billing_address_1").value = "Example House";
    await Promise.resolve();

    document
      .getElementById("billing-address_1")
      .dispatchEvent(new window.Event("input", { bubbles: true }));
    base.address.address_1 = "";
    base.publish("wc/store/cart");
    await Promise.resolve();

    // The listener must reach its release; a throw leaves the write outranking the buyer.
    expect(base.calls.patches).toEqual([{ address_1: "Example House" }]);
    expect(shadowInput("billing_address_1").value).toBe("");
  });

  test("an edit to the one input mirrored roles share ends both their writes", async () => {
    // "Use same address for billing": Blocks renders the delivery inputs only.
    document.body.innerHTML = '<input id="shipping-address_1">';
    const base = baseGlobals("address_area", { address_1: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    shadowInput("billing_address_1").value = "Example House";
    await Promise.resolve();

    document
      .getElementById("shipping-address_1")
      .dispatchEvent(new window.Event("input", { bubbles: true }));
    base.address.address_1 = "";
    base.publish("wc/store/cart");
    await Promise.resolve();

    expect(base.calls.patches).toEqual([{ address_1: "Example House" }]);
    expect(shadowInput("billing_address_1").value).toBe("");
  });

  test.each([
    {
      editedId: "billing-country-input",
      counterpartId: "shipping-country",
      description: "the edited role's widget carries the suffix"
    },
    {
      editedId: "billing-country",
      counterpartId: "shipping-country-input",
      description: "the other role's widget carries the suffix"
    }
  ])(
    "an edit to one role's control leaves the other's hold where $description",
    async ({ editedId, counterpartId }) => {
      // Both address forms render, and Blocks suffixed only one role's widget.
      document.body.innerHTML =
        '<select id="' + editedId + '"></select><select id="' + counterpartId + '"></select>';
      const base = baseGlobals("address_area", { country: "" }, { country: "" });
      const { env } = globals({});
      env.wp.data = base.data;
      evaluate(env);
      await Promise.resolve();

      shadowInput("billing_country").value = "NO";
      shadowInput("shipping_country").value = "NO";
      await Promise.resolve();
      base.calls.patches.length = 0;
      base.calls.shippingPatches.length = 0;

      // When: the invoice country changes, which is not the delivery role's control.
      document
        .getElementById(editedId)
        .dispatchEvent(new window.Event("change", { bubbles: true }));
      base.address.country = "";
      base.shippingAddress.country = "";
      base.publish("wc/store/cart");
      await Promise.resolve();

      // Then: only the invoice hold ends.
      expect(base.calls.patches).toEqual([]);
      expect(base.calls.shippingPatches).toEqual([{ country: "NO" }]);
    }
  );

  test("a role whose only node under a key is decoration has no control of its own", async () => {
    // Mirrored render: one country select between the roles, and the error node
    // the other role's key still gets its id from.
    document.body.innerHTML =
      '<select id="billing-country"></select><div id="shipping-country-error"></div>';
    const base = baseGlobals("address_area", { country: "" }, { country: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();

    shadowInput("billing_country").value = "NO";
    shadowInput("shipping_country").value = "NO";
    await Promise.resolve();
    base.calls.patches.length = 0;
    base.calls.shippingPatches.length = 0;

    document
      .getElementById("billing-country")
      .dispatchEvent(new window.Event("change", { bubbles: true }));
    base.address.country = "";
    base.shippingAddress.country = "";
    base.publish("wc/store/cart");
    await Promise.resolve();

    // Then: the edit is both roles', so neither write outranks the buyer.
    expect(base.calls.patches).toEqual([]);
    expect(base.calls.shippingPatches).toEqual([]);
    expect(shadowInput("shipping_country").value).toBe("");
  });

  test.each([
    {
      inBlock: true,
      resends: 0,
      shadow: "",
      description: "the checkout block's own contact email ends the write it holds"
    },
    {
      inBlock: false,
      resends: 1,
      shadow: "buyer@example.test",
      description: "another form's email field on the same page does not"
    }
  ])("$description", async ({ inBlock, resends, shadow }) => {
    const field = '<input id="email">';
    document.body.innerHTML = inBlock
      ? '<div class="wp-block-woocommerce-checkout">' + field + "</div>"
      : field;
    const base = baseGlobals("address_area", { email: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    shadowInput("billing_email").value = "buyer@example.test";
    await Promise.resolve();
    // The write's own send; what follows it is the re-send a surviving hold makes.
    base.calls.patches.length = 0;

    document.getElementById("email").dispatchEvent(new window.Event("input", { bubbles: true }));
    base.address.email = "";
    base.publish("wc/store/cart");
    await Promise.resolve();

    expect(base.calls.patches).toHaveLength(resends);
    expect(shadowInput("billing_email").value).toBe(shadow);
  });

  test.each([
    { id: "billing-country", description: "names its control for the key alone" },
    { id: "billing-country-input", description: "suffixes its control's id" }
  ])("a country change releases the hold where Blocks $description", async ({ id }) => {
    document.body.innerHTML = '<select id="' + id + '"></select>';
    const base = baseGlobals("address_area", { country: "" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);
    await Promise.resolve();
    base.calls.patches.length = 0;

    shadowInput("billing_country").value = "NO";
    await Promise.resolve();

    document.getElementById(id).dispatchEvent(new window.Event("change", { bubbles: true }));
    base.address.country = "";
    base.publish("wc/store/cart");
    await Promise.resolve();

    expect(base.calls.patches).toEqual([{ country: "NO" }]);
    expect(shadowInput("billing_country").value).toBe("");
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
