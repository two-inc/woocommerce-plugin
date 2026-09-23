<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('WC_Twoinc_Product_Promo')) {
    /**
     * Opt-in promotional message on the product page (TWO-25799).
     *
     * Says the method EXISTS so a buyer meets it before committing to a
     * basket. It never claims this buyer will be offered it: minimum order
     * value, country and currency all need a cart the product page has not
     * got, so those gates cannot be evaluated here.
     *
     * Blocks is orthogonal to this: the message renders on the product page
     * and never touches checkout. The compatibility question here is a
     * block-based (FSE) product template, which may not run this PHP hook at
     * all — a theme concern, and the message is simply absent there.
     */
    class WC_Twoinc_Product_Promo
    {
        /** Its own switch. The buy button (TWO-25800) has a separate one. */
        const SWITCH_KEY = 'product_page_message_enabled';

        /**
         * After the add-to-cart form closes, so the message sits beside the
         * purchase controls without being part of them.
         *
         * Not universal coverage, and deliberately not claimed as such: core
         * emits this hook from the simple, variable, grouped and external
         * add-to-cart templates, so a theme replacing one of those can omit
         * it, and a simple product that is out of stock or not purchasable
         * skips it too. The message is then simply absent, which is the right
         * outcome — it is not the purchase control.
         */
        public static function init()
        {
            add_action('woocommerce_after_add_to_cart_form', [__CLASS__, 'render']);
        }

        /**
         * The frontend single product page, and nothing else.
         *
         * The hook is emitted by the add-to-cart templates, which a quick-view
         * endpoint, a REST render or an admin preview can also reach.
         */
        public static function is_product_page_request()
        {
            return WC_Twoinc_Storefront_Gate::is_product_page_request();
        }

        /**
         * Every condition, or the storefront advertises a method the buyer
         * cannot use.
         *
         * Answered entirely from stored options and the verdict transient: no
         * gateway is constructed. Constructing one runs init_form_fields(),
         * whose payment-term options reach get_merchant_available_terms() and
         * so refresh_merchant_record_caches() - and no render path may refresh
         * the merchant record. A product page is the busiest render path there
         * is, and during an outage that chain costs it a 10-second fetch.
         *
         * Only a DEFINITIVE key rejection withholds. An unread verdict is not
         * one: a cold transient leaves the message up exactly as a transient
         * outage leaves the method on offer, and it never fetches to find out.
         *
         * @param array|null $settings the stored gateway settings; read from
         *                              the option when not supplied
         */
        public static function is_visible($settings = null)
        {
            if (null === $settings) {
                $settings = self::read_settings();
            }

            // Anything unexpected in a stored shape withholds the message
            // rather than the page.
            try {
                if (!WC_Twoinc_Storefront_Gate::allows($settings, self::SWITCH_KEY)) {
                    return false;
                }

                return '' !== self::get_message($settings);
            } catch (Throwable $e) {
                self::log_withheld($e);
                return false;
            } catch (Exception $e) {
                self::log_withheld($e);
                return false;
            }
        }

        private static function read_settings()
        {
            return WC_Twoinc_Storefront_Gate::read_settings();
        }

        /**
         * The merchant's own wording, else the phrase the checkout already
         * shows, so the two surfaces cannot drift and the string already has
         * translations. Deliberately no day count: terms run from fulfilment,
         * not from the page view, so a fixed number here can contradict what
         * checkout offers.
         */
        public static function get_message($settings = null)
        {
            if (null === $settings) {
                $settings = self::read_settings();
            }

            $stored = isset($settings['product_page_message']) ? $settings['product_page_message'] : '';

            // A stored array reaches here from an import or a hand-edited
            // option, and casting one to string is a warning that can surface
            // as a fatal on a product page. Non-scalar reads as absent.
            $configured = is_scalar($stored) ? (string) $stored : '';

            // trim() leaves U+00A0, so an override of nonbreaking spaces would
            // otherwise render a badge with no readable message.
            $configured = self::trim_unicode_whitespace($configured);

            if ('' !== $configured) {
                return $configured;
            }

            return __('Buy now, receive your goods, pay your invoice later.', 'twoinc-payment-gateway');
        }

        /**
         * The brand's customer-facing name, used as the mark's alternative
         * text and shown as text where the brand ships no mark — so no
         * storefront ever carries an unattributed financing offer.
         */
        public static function get_brand_label()
        {
            return WC_Twoinc_Storefront_Gate::brand_label();
        }

        /**
         * Split out so the unusable shapes are testable without a brand.
         */
        public static function get_brand_label_from($name)
        {
            return WC_Twoinc_Storefront_Gate::brand_label_from($name);
        }

        /**
         * The brand's own mark, or '' where it ships none or declares a
         * non-string. esc_url returns '' for a disallowed scheme, which is
         * treated the same as absent.
         */
        public static function get_brand_logo_url()
        {
            return WC_Twoinc_Storefront_Gate::brand_logo_url();
        }

        public static function render()
        {
            if (!self::is_product_page_request()) {
                return;
            }

            try {
                self::render_badge();
            } catch (Throwable $e) {
                self::log_withheld($e);
            } catch (Exception $e) {
                self::log_withheld($e);
            }
        }

        private static function render_badge()
        {
            $settings = self::read_settings();

            if (!self::is_visible($settings)) {
                return;
            }

            $logo = self::get_brand_logo_url();
            $label = self::get_brand_label();

            // A badge nobody can attribute is worse than no badge: a brand
            // with neither a usable mark nor a name would otherwise render a
            // bare financing sentence.
            if ('' === $label) {
                self::log_withheld(new Exception('brand declares no usable product name'));
                return;
            }

            echo '<div class="twoinc-product-promo">';

            if ('' !== $logo) {
                printf(
                    '<img class="twoinc-product-promo__mark" src="%s" alt="%s" />',
                    esc_url($logo),
                    esc_attr($label)
                );
            } elseif ('' !== $label) {
                printf('<span class="twoinc-product-promo__brand">%s</span>', esc_html($label));
            }

            printf(
                '<span class="twoinc-product-promo__text">%s</span>',
                esc_html(self::get_message($settings))
            );

            echo '</div>';
        }

        /**
         * Why the message is not on the page, for the one person who will ask.
         */
        private static function log_withheld($e)
        {
            WC_Twoinc_Storefront_Gate::log_withheld($e, 'product-promo');
        }

        /**
         * trim() for the whole Unicode whitespace set, so a nonbreaking-space
         * override counts as empty rather than as wording.
         */
        private static function trim_unicode_whitespace($value)
        {
            return WC_Twoinc_Storefront_Gate::trim_unicode_whitespace($value);
        }
    }
}
