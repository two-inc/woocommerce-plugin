/**
 * assets/js/blocks-checkout.js registers the Blocks payment method against the
 * globals WooCommerce provides. The script is a plain IIFE with no exports, so
 * the test evaluates it exactly as its <script> tag would, over stub globals.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', 'assets', 'js', 'blocks-checkout.js'),
    'utf8'
);

const METHOD_DATA = {
    title: 'Business invoice',
    subtitle: '<div class="twoinc-payment-subtitle">Read more</div>',
    about: '<div class="abt-twoinc">about</div>',
    iconUrl: 'https://example.test/logo.svg',
    supports: ['products', 'refunds']
};

function createElement(type, props) {
    const children = Array.prototype.slice.call(arguments, 2);
    return { type, props: props || {}, children };
}

function globals(overrides) {
    const registered = [];
    const base = {
        wc: {
            wcBlocksRegistry: {
                registerPaymentMethod(config) {
                    registered.push(config);
                }
            },
            wcSettings: {
                getSetting(key) {
                    return key === 'woocommerce-gateway-tillit_data' ? METHOD_DATA : null;
                }
            }
        },
        wp: { element: { createElement }, htmlEntities: { decodeEntities: (v) => v } },
        twoincBlocksName: 'woocommerce-gateway-tillit'
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
    ['wc', 'wp', 'twoincBlocksName'].forEach((key) => {
        delete window[key];
    });
});

describe('blocks-checkout.js registration', () => {
    test.each([
        { overrides: { wc: {} }, registers: false, description: 'no Blocks registry on the page' },
        { overrides: { wp: {} }, registers: false, description: 'no wp.element' },
        { overrides: { twoincBlocksName: undefined }, registers: false, description: 'gateway id never inlined' },
        { overrides: { wc: { wcBlocksRegistry: {}, wcSettings: { getSetting: () => null } } }, registers: false, description: 'no method data in wcSettings' },
        { overrides: {}, registers: true, description: 'every global present' }
    ])('registers=$registers when $description', ({ overrides, registers }) => {
        const { env, registered } = globals(overrides);
        if (overrides.wc && overrides.wc.wcBlocksRegistry) {
            overrides.wc.wcBlocksRegistry.registerPaymentMethod = (config) => registered.push(config);
        }
        evaluate(env);
        expect(registered.length > 0).toBe(registers);
    });

    test('the registered method carries the server-side identity and features', () => {
        const { env, registered } = globals({});
        evaluate(env);
        expect(registered[0].name).toBe('woocommerce-gateway-tillit');
        expect(registered[0].ariaLabel).toBe('Business invoice');
        expect(registered[0].supports.features).toEqual(['products', 'refunds']);
    });

    test.each([
        { slot: (config) => config.label.type().children, expected: METHOD_DATA.iconUrl, description: 'the label carries the brand logo' },
        { slot: (config) => config.label.type().children, expected: METHOD_DATA.about, description: 'the label carries the about control' },
        { slot: (config) => [config.content.type()], expected: METHOD_DATA.subtitle, description: 'the content carries the subtitle' }
    ])('$description', ({ slot, expected }) => {
        const { env, registered } = globals({});
        evaluate(env);
        const values = slot(registered[0])
            .filter(Boolean)
            .map((node) => node.props.src || (node.props.dangerouslySetInnerHTML || {}).__html);
        expect(values).toContain(expected);
    });
});
