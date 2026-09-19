<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('WC_Twoinc_Product_Button')) {
    /**
     * Opt-in "Buy with <brand>" button on the product page (TWO-25800).
     *
     * The merchant asked for the shape PayPal's product-page button has: a
     * control beside Add to Basket that starts the purchase there rather than
     * making the buyer find the payment method later. PayPal's lands the buyer
     * on the cart, so this one does the equivalent — it adds the item and
     * opens checkout with this gateway already selected. It does NOT place the
     * order, and nothing here needs an order to exist.
     *
     * A SEPARATE feature from the promotional message (TWO-25799), with its
     * own switch: a shop may run either, both or neither.
     *
     * The button is a submit control inside WooCommerce's own add-to-cart
     * form. That is the whole reason the chosen variation and the quantity
     * survive: the form posts the same fields core's own button posts, core
     * adds the item exactly as it always does, and the only thing this feature
     * contributes is where the buyer goes next. Rebuilding that in JavaScript
     * would mean reimplementing variation resolution and stock validation.
     */
    class WC_Twoinc_Product_Button
    {
        /** Its own switch. The promotional message has a separate one. */
        const SWITCH_KEY = 'product_page_button_enabled';

        /** The query-string marker that says this add-to-cart came from here. */
        const TRIGGER_FIELD = 'twoinc_buy_now';

        /**
         * Product types whose add-to-cart form posts back to this shop. An
         * external/affiliate product's form GETs a third-party URL instead.
         */
        const SUPPORTED_TYPES = ['simple', 'variable', 'grouped'];


        public static function init()
        {
            // Inside the add-to-cart form and after core's own button, which
            // is where PayPal's buttons sit on the merchant's storefront.
            add_action('woocommerce_after_add_to_cart_button', [__CLASS__, 'render']);
            // Two arguments, because the second is the only thing that says
            // whether an add actually happened. See redirect_after_add().
            add_filter('woocommerce_add_to_cart_redirect', [__CLASS__, 'redirect_after_add'], 10, 2);
            // Not on the gateway's own script: that one is only enqueued while
            // this method is available at checkout, and the marker has to be
            // consumed even when it is not.
            add_action('wp_enqueue_scripts', [__CLASS__, 'consume_marker_on_checkout']);
        }

        /**
         * The same shared gates the promotional message asks, plus this
         * feature's own switch. Answered from stored options and cached
         * verdicts only; no gateway is constructed.
         *
         * @param array|null $settings
         *
         * @return bool
         */
        public static function is_visible($settings = null)
        {
            if (null === $settings) {
                $settings = WC_Twoinc_Storefront_Gate::read_settings();
            }

            try {
                if (!WC_Twoinc_Storefront_Gate::allows($settings, self::SWITCH_KEY)) {
                    return false;
                }

                // A button nobody can attribute is worse than no button: a
                // brand with no usable name would render a bare "Buy with".
                return '' !== WC_Twoinc_Storefront_Gate::brand_label();
            } catch (Throwable $e) {
                WC_Twoinc_Storefront_Gate::log_withheld($e, 'product-button');
                return false;
            } catch (Exception $e) {
                WC_Twoinc_Storefront_Gate::log_withheld($e, 'product-button');
                return false;
            }
        }

        /**
         * "Buy with Two", or whatever the active brand calls itself. Never
         * hardcoded: a brand overlay must get its own name here, exactly as it
         * does at checkout.
         */
        public static function get_label($brand_label = null)
        {
            if (null === $brand_label) {
                $brand_label = WC_Twoinc_Storefront_Gate::brand_label();
            }

            return sprintf(
                /* translators: %s: the payment brand's name, for example Two */
                __('Buy with %s', 'twoinc-payment-gateway'),
                $brand_label
            );
        }

        /**
         * The visible text when the brand's own mark follows it and names the
         * brand instead, which is the shape the merchant asked us to match.
         */
        public static function get_label_prefix()
        {
            return __(
                /* translators: a fragment, followed by the payment brand's logo which names the brand. Keep it short. */
                'Buy with',
                'twoinc-payment-gateway'
            );
        }

        public static function render()
        {
            if (!WC_Twoinc_Storefront_Gate::is_product_page_request()) {
                return;
            }

            try {
                self::render_button();
            } catch (Throwable $e) {
                WC_Twoinc_Storefront_Gate::log_withheld($e, 'product-button');
            } catch (Exception $e) {
                WC_Twoinc_Storefront_Gate::log_withheld($e, 'product-button');
            }
        }

        private static function render_button()
        {
            $settings = WC_Twoinc_Storefront_Gate::read_settings();

            if (!self::is_visible($settings)) {
                return;
            }

            $product = function_exists('wc_get_product') ? wc_get_product() : null;
            if (!$product) {
                return;
            }

            // Only the product types whose form posts a local add-to-cart.
            // An external/affiliate product's form is a GET to the merchant's
            // third-party URL, so a button inside it would send the buyer off
            // the shop entirely rather than to this checkout. Anything else
            // unrecognised is skipped rather than guessed at: a missing button
            // is a smaller failure than one that leaves the shop.
            if (!in_array($product->get_type(), self::SUPPORTED_TYPES, true)) {
                return;
            }

            // Nothing to buy. Core skips its own button for these too, so the
            // hook may not even fire; this is the belt for the theme that
            // emits it anyway.
            if (!self::has_something_to_buy($product)) {
                return;
            }

            $logo = WC_Twoinc_Storefront_Gate::brand_logo_url();

            // `name="add-to-cart"` carrying the product id, exactly as core's
            // own button does on a simple product, because a browser submits
            // ONLY the activated submit control. A button named anything else
            // would post no `add-to-cart` at all, WC_Form_Handler would return
            // early, nothing would reach the cart and this feature's redirect
            // filter would never run. On a variable or grouped product core
            // also emits a hidden `add-to-cart` holding the same id, so the
            // duplicate is harmless.
            //
            // Which leaves nowhere in the form body to mark the click as
            // ours, so `formaction` carries it in the query string instead.
            // Core's own button keeps the form's action and is untouched.
            //
            // `single_add_to_cart_button` deliberately: core's variation
            // script toggles `disabled wc-variation-selection-needed` on every
            // element in the form carrying that class, so a variable product
            // disables this button until a variation is chosen, using core's
            // own mechanism rather than a second copy of that rule.
            printf(
                '<button type="submit" name="add-to-cart" value="%s" formaction="%s" class="button single_add_to_cart_button twoinc-product-button">',
                esc_attr($product->get_id()),
                esc_url(self::buy_now_action($product))
            );

            // The brand appears ONCE. Where it ships a mark, the mark is the
            // brand and the text is only the fragment before it; where it
            // ships none, the text carries the name instead, so no storefront
            // ends up with a purchase control that names no brand.
            //
            // The mark is therefore NOT decorative, reversing a decision from
            // an earlier round that was right only while the text named the
            // brand: its alternative text is what keeps the button's
            // accessible name reading "Buy with <brand>" rather than "Buy
            // with". The literal space between the two is deliberate, so the
            // name cannot come out as one run-together word.
            if ('' === $logo) {
                printf(
                    '<span class="twoinc-product-button__label">%s</span>',
                    esc_html(self::get_label())
                );
                echo '</button>';

                return;
            }

            printf(
                '<span class="twoinc-product-button__label">%s</span> '
                    . '<img class="twoinc-product-button__mark" src="%s" alt="%s" />',
                esc_html(self::get_label_prefix()),
                esc_url($logo),
                esc_attr(WC_Twoinc_Storefront_Gate::brand_label())
            );

            echo '</button>';
        }

        /**
         * Whether this product page has anything the form can actually add.
         *
         * Asked of the thing the form buys, which is not the same object for
         * every type: `WC_Product_Grouped::is_purchasable()` returns false
         * unconditionally, because a grouped parent is a container and its
         * CHILDREN are what get bought. Asking the parent would have hidden
         * the button on every ordinary grouped product, while SUPPORTED_TYPES
         * said grouped was supported.
         *
         * @param WC_Product $product
         *
         * @return bool
         */
        private static function has_something_to_buy($product)
        {
            if ('grouped' !== $product->get_type()) {
                return $product->is_purchasable() && $product->is_in_stock();
            }

            $children = method_exists($product, 'get_children') ? $product->get_children() : [];
            if (!is_array($children)) {
                return false;
            }

            foreach ($children as $child_id) {
                $child = wc_get_product($child_id);
                if ($child && $child->is_purchasable() && $child->is_in_stock()) {
                    return true;
                }
            }

            return false;
        }

        /**
         * The form's own action with this feature's marker appended.
         *
         * Through the same filter core applies to the form action, so a theme
         * that moved it keeps working. The marker lands in $_REQUEST via the
         * query string, which is the only place left once the button itself
         * has to be named `add-to-cart`.
         *
         * @param WC_Product $product
         *
         * @return string
         */
        private static function buy_now_action($product)
        {
            $action = apply_filters('woocommerce_add_to_cart_form_action', $product->get_permalink());

            return add_query_arg(self::TRIGGER_FIELD, '1', $action);
        }

        /**
         * Where the buyer goes once core has added the item.
         *
         * Runs only for an add-to-cart this button submitted, so an ordinary
         * Add to Basket is untouched and the existing basket is added to
         * rather than replaced.
         *
         * No nonce, matching core's own add-to-cart form, which carries none
         * so that product pages stay cacheable. The only thing a forged
         * request achieves is preselecting a payment method in the visitor's
         * own session, which they can change at checkout.
         *
         * @param string          $url
         * @param WC_Product|null $adding_to_cart the product core just added,
         *                                        or null when this is not an
         *                                        add at all
         *
         * @return string
         */
        public static function redirect_after_add($url, $adding_to_cart = null)
        {
            // Core applies this filter from TWO places. One is after an add,
            // in WC_Form_Handler::add_to_cart_action(), and passes the product
            // it just added. The other is WC_Frontend_Scripts, building the
            // `cart_url` for the ajax add-to-cart script on ORDINARY page
            // loads, and passes null.
            //
            // Without this check, any page carrying the marker in its query
            // string — the checkout this feature redirects to, or the product
            // page a FAILED add leaves the buyer on — would run the rest of
            // this method with nothing added: writing a payment choice into
            // the session on a plain render, and handing the ajax script this
            // checkout URL as its cart link.
            if (!$adding_to_cart) {
                return $url;
            }

            // phpcs:ignore WordPress.Security.NonceVerification.Recommended
            if (!isset($_REQUEST[self::TRIGGER_FIELD])) {
                return $url;
            }

            try {
                if (!self::is_visible()) {
                    return $url;
                }

                if (!function_exists('wc_get_checkout_url')) {
                    // Not handing off, so nothing is asserted about the
                    // buyer's choice either.
                    return $url;
                }

                self::preselect_gateway();

                // The destination carries the intent, so nothing is stored
                // anywhere. WooCommerce puts the payment step in the same
                // server response as the rest of the checkout, for both
                // renderers, so a URL chosen here reaches it. Nothing to
                // write, nothing to consume, and nothing that can outlive the
                // checkout it was meant for.
                return add_query_arg(self::TRIGGER_FIELD, '1', wc_get_checkout_url());
            } catch (Throwable $e) {
                WC_Twoinc_Storefront_Gate::log_withheld($e, 'product-button');
                return $url;
            } catch (Exception $e) {
                WC_Twoinc_Storefront_Gate::log_withheld($e, 'product-button');
                return $url;
            }
        }

        /**
         * The session key WooCommerce core already reads.
         *
         * Classic checkout needs nothing further: WC_Payment_Gateways::
         * set_current_gateway() reads this and marks that gateway chosen. The
         * Blocks checkout has no server-side equivalent, so its tile reads the
         * same value through get_payment_method_data() and selects itself once
         * on mount.
         *
         * Deliberately not conditional on the gateway being available: that
         * needs a cart this runs before, and an unavailable gateway is simply
         * absent from the checkout's list, where core falls back to the first
         * available one. The buyer lands on a working checkout either way.
         */
        private static function preselect_gateway()
        {
            $session = function_exists('WC') ? (WC()->session ?? null) : null;
            if (!$session) {
                return;
            }

            $id = WC_Twoinc_Brand::get('gateway_id');
            if (!is_string($id) || '' === $id) {
                return;
            }

            // Core's own key, which classic checkout reads by itself through
            // WC_Payment_Gateways::set_current_gateway(). Core owns how long
            // it lives, exactly as if the buyer had chosen the method at a
            // checkout and come back.
            $session->set('chosen_payment_method', $id);
        }

        /**
         * Take the marker out of the address bar once the checkout it was
         * meant for has been rendered.
         *
         * Unconditional, and deliberately not part of the payment method's own
         * script. That script is registered only while the gateway is active,
         * so a checkout where this method is unavailable would never consume
         * the marker; the buyer could then choose another method, and a later
         * reload of the same URL, by which time the cart or address had made
         * this method available, would preselect over that choice. A marker
         * that survives an unavailable checkout is the failure worth avoiding.
         *
         * Nothing here depends on this feature still being switched on either:
         * an URL already handed out has to be cleaned up regardless.
         *
         * @return void
         */
        public static function consume_marker_on_checkout()
        {
            if (!function_exists('is_checkout') || !is_checkout()) {
                return;
            }

            // phpcs:ignore WordPress.Security.NonceVerification.Recommended
            if (!isset($_GET[self::TRIGGER_FIELD])) {
                return;
            }

            self::withdraw_preselection_if_unavailable();

            $handle = 'twoinc-buy-now-consume';
            wp_register_script($handle, '', [], null, true);
            wp_enqueue_script($handle);
            wp_add_inline_script(
                $handle,
                'try{var u=new URL(window.location.href);'
                    . 'if(u.searchParams.has(' . wp_json_encode(self::TRIGGER_FIELD) . ')){'
                    . 'u.searchParams.delete(' . wp_json_encode(self::TRIGGER_FIELD) . ');'
                    . 'window.history.replaceState(window.history.state,"",u.toString());}}catch(e){}'
            );
        }

        /**
         * Take back the preselection where this method is not actually on
         * offer at this checkout.
         *
         * The session write that makes classic preselect is the same key the
         * surcharge is gated on (WC_Twoinc_Payment_Terms::apply_cart_fee()),
         * and that gate asks only whether this gateway is CHOSEN, not whether
         * it is AVAILABLE. Minimum order value, buyer country and currency are
         * cart-time questions the product page could not answer, so the button
         * can name a method this checkout does not offer — and a Blocks
         * checkout that filters it out never loads the tile that would
         * announce the choice away. The result would be this gateway's
         * surcharge on a basket being paid through another one.
         *
         * Runs from the checkout page itself, so it does not depend on the
         * tile, on Blocks, or on this method being available. Only ever
         * withdraws THIS gateway's own name: another gateway's choice is
         * never blanked.
         *
         * @return void
         */
        private static function withdraw_preselection_if_unavailable()
        {
            $session = function_exists('WC') ? (WC()->session ?? null) : null;
            if (!$session) {
                return;
            }

            $id = WC_Twoinc_Brand::get('gateway_id');
            if (!is_string($id) || '' === $id || $session->get('chosen_payment_method') !== $id) {
                return;
            }

            if (!function_exists('WC') || !WC()->payment_gateways()) {
                return;
            }

            $available = WC()->payment_gateways()->get_available_payment_gateways();
            if (!is_array($available) || !isset($available[$id])) {
                $session->set('chosen_payment_method', '');
            }
        }

        /**
         * Whether the Blocks tile should select itself.
         *
         * Read from the request being rendered, never from stored state.
         * Blocks has no server-side preselect of its own, but it does get its
         * payment data in the same response as the page, so the destination
         * this feature chose is enough to tell it. Nothing is stored, so
         * nothing can describe an attempt that did not happen and nothing can
         * survive into an unrelated later checkout.
         *
         * Classic needs no equivalent: core reads its own
         * `chosen_payment_method` and owns how long that lives.
         */
        public static function should_preselect_blocks()
        {
            // phpcs:ignore WordPress.Security.NonceVerification.Recommended
            return isset($_GET[self::TRIGGER_FIELD]);
        }
    }
}
