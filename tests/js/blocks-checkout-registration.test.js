/**
 * assets/js/blocks-checkout.js registers the Blocks payment method against the
 * globals WooCommerce provides. The script is a plain IIFE with no exports, so
 * the test evaluates it exactly as its <script> tag would, over stub globals.
 */

const fs = require("fs");
const path = require("path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "assets", "js", "blocks-checkout.js"),
  "utf8"
);

const METHOD_DATA = {
  title: "Business invoice",
  description: '<div class="twoinc-payment-subtitle">Read more</div>',
  about: '<div class="abt-twoinc">about</div>',
  iconUrl: "https://example.test/logo.svg",
  supports: ["products", "refunds"]
};

function createElement(type, props) {
  const children = Array.prototype.slice.call(arguments, 2);
  return { type, props: props || {}, children };
}

/** Handlers the skin binds on document.body, keyed by the jQuery event name. */
const bodyHandlers = {};

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
    "twoincCompanySearchControls"
  ].forEach((key) => {
    delete window[key];
  });
  Object.keys(bodyHandlers).forEach((key) => delete bodyHandlers[key]);
  document.body.innerHTML = "";
});

/**
 * The base plugin's own globals, as twoinc.js leaves them on the page.
 * Nothing here is a reimplementation: the skin is only allowed to read the
 * controller's accessors and call its mount.
 */
function baseGlobals(location, billing) {
  const calls = {
    mounts: 0,
    patches: [],
    resyncs: 0,
    summaries: 0,
    saves: 0,
    restores: [],
    order: []
  };
  const captureValues = { company: "", company_id: "" };
  const control = {
    addressFieldSelector: "#billing_company_display",
    isTileLocation: () => location === "payment_tile",
    companyFieldSelector() {
      return this.isTileLocation() ? "#twoinc_tile_company_name" : this.addressFieldSelector;
    },
    countryDidChange() {
      calls.order.push("seed");
      return false;
    },
    currentCountry: () => "GB",
    syncCompanySearchTileLocation() {
      calls.mounts += 1;
    },
    renderCompanySummary() {
      calls.summaries += 1;
    }
  };

  window.twoinc = { company_search_location: location };
  window.Twoinc = {
    getInstance: () => ({
      onUpdatedCheckout() {
        calls.resyncs += 1;
      }
    })
  };
  window.twoincSelectWooHelper = control;
  window.twoincAddressRoles = { primary: () => "billing" };
  window.twoincCompanyCapture = {
    numberField: () => ({ val: () => captureValues.company_id }),
    nameField: () => ({ val: () => captureValues.company })
  };
  window.twoincCompanySearchControls = [control];
  window.twoincDomHelper = {
    saveCheckoutInputs() {
      calls.saves += 1;
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

  const address = Object.assign(
    {
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
    },
    billing || {}
  );

  return {
    calls,
    control,
    captureValues,
    address,

    data: {
      select: () => ({
        getCustomerData: () => ({ billingAddress: address }),
        getCartTotals: () => ({ total_price: "38600", total_tax: "0", currency_minor_unit: 2 })
      }),
      dispatch: () => ({
        setBillingAddress(patch) {
          calls.patches.push(patch);
          Object.assign(address, patch);
        }
      }),
      subscribe: () => () => {}
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
      slot: (config) => [config.content.type()],
      expected: METHOD_DATA.description,
      description: "the content is the gateway's own payment-box description"
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

  test("a store value moving again mid-pull is never overwritten by the pull", async () => {
    const base = baseGlobals("address_area", { city: "Oslo" });
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    // The buyer's own edit, landing between the pull's write and the queued
    // push: without the suppression, the pull's stale value wins.
    base.address.city = "Bergen";
    await Promise.resolve();

    expect(base.calls.patches).toEqual([]);
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
    evaluate(env);
    expect(base.calls.mounts).toBe(0);

    const observed = [];
    const RealObserver = window.MutationObserver;
    window.MutationObserver = function (fn) {
      observed.push(fn);
      return new RealObserver(fn);
    };
    window.MutationObserver.prototype = RealObserver.prototype;
    evaluate(env);
    window.MutationObserver = RealObserver;

    document.querySelector(".wc-block-components-text-input").innerHTML =
      '<input id="billing-company">';
    observed.forEach((fn) => fn([]));

    expect(base.calls.mounts).toBe(1);
  });

  test("the Store API is handed the controller's own captured company", () => {
    const base = baseGlobals("payment_tile");
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

    base.captureValues.company = "EXAMPLE TRADING LIMITED";
    base.captureValues.company_id = "12345678";

    expect(handler()).toEqual({
      type: "success",
      meta: {
        paymentMethodData: {
          company_id: "12345678",
          company_name: "EXAMPLE TRADING LIMITED"
        }
      }
    });
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
      phase: "mounted",
      expected: [{ active: true }],
      description: "the tile names this gateway as the choice"
    },
    {
      phase: "unmounted",
      expected: [{ active: true }, { active: false }],
      description: "leaving the tile withdraws it again"
    }
  ])("$description", ({ phase, expected }) => {
    const base = baseGlobals("payment_tile");
    const { env, registered, updates } = withCartApi(base);
    evaluate(env);

    registered[0].content.type({});
    if (phase === "unmounted") {
      // The effect's own teardown, which React runs on unmount.
      globals.lastCleanup();
    }

    expect(updates.map((u) => u.data)).toEqual(expected);
    updates.forEach((u) => expect(u.namespace).toBe("twoinc-payment-gateway"));
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

  test("the controller's own restore pass runs, then its country tracker is seeded", () => {
    const base = baseGlobals("address_area");
    const { env } = globals({});
    env.wp.data = base.data;
    evaluate(env);

    // Restored before the tracker is seeded, or the next re-render reads the
    // restored country as a change and clears the capture again.
    expect(base.calls.restores).toEqual(["12345678"]);
    expect(base.calls.order).toEqual(["restore", "seed"]);
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
