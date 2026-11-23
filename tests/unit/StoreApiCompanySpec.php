<?php

declare(strict_types=1);

/**
 * The company a Checkout block order saves (TWO-27368). The Store API sends address fields back HTML-escaped,
 * the block posts that text back at checkout, and WooCommerce saves what arrives, so without a decode a Two
 * order's billing company reads "Example &amp; Co Ltd". The decode runs on the Store API's order update hook.
 */
final class StoreApiCompanySpec
{
    public static function runAll(): void
    {
        self::testTheHookIsRegistered();
        self::testTheOrderStoresTheCompanyAsText();
        print("StoreApiCompanySpec passed.\n");
    }

    private static function testTheHookIsRegistered(): void
    {
        $source = (string) file_get_contents(WC_TWOINC_PLUGIN_PATH . 'tillit-payment-gateway.php');
        TinyAssert::true(
            1 === preg_match(
                "/add_action\\('woocommerce_store_api_checkout_update_order_from_request', \\['WC_Twoinc_Checkout', 'decode_store_api_company'\\]\\)/",
                $source
            ),
            'the decode is hooked to the Store API checkout order update'
        );
    }

    private static function testTheOrderStoresTheCompanyAsText(): void
    {
        $two = WC_Twoinc_Brand::get('gateway_id');
        // [payment method, billing company posted, shipping company posted, billing saved, shipping saved, description]
        $rows = [
            [$two, 'Example &#038; Co Ltd', '', 'Example & Co Ltd', '', 'the Store API form of "&" is saved as "&"'],
            [$two, 'Example &amp; Co Ltd', '', 'Example & Co Ltd', '', 'the escaped form of "&" is saved as "&"'],
            [$two, 'Example & Co Ltd', '', 'Example & Co Ltd', '', 'a typed "&" before any reload is saved unchanged'],
            [$two, 'Example &amp;amp; Co Ltd', '', 'Example &amp; Co Ltd', '', 'decoded once, never twice'],
            [$two, 'Example &#8217;s Ltd', '', "Example \u{2019}s Ltd", '', 'the Store API apostrophe is saved as the character it encodes'],
            [$two, '&lt;b&gt;Example&lt;/b&gt; Ltd', '', 'Example Ltd', '', 'decoded markup is sanitised as typed markup would be'],
            [$two, 'Example &amp; Co Ltd', 'Other &#038; Sons', 'Example & Co Ltd', 'Other & Sons', 'the shipping company is decoded too'],
            ['cod', 'Example &amp; Co Ltd', 'Other &#038; Sons', 'Example &amp; Co Ltd', 'Other &#038; Sons', 'an order paid another way is left as WooCommerce wrote it'],
        ];
        foreach ($rows as [$method, $billing, $shipping, $savedBilling, $savedShipping, $description]) {
            $order = new class ($method, $billing, $shipping) extends StubOrder {
                public $companies;

                public function __construct(string $method, string $billing, string $shipping)
                {
                    $this->payment_method = $method;
                    $this->companies = ['billing' => $billing, 'shipping' => $shipping];
                }

                public function get_billing_company()
                {
                    return $this->companies['billing'];
                }

                public function set_billing_company($value)
                {
                    $this->companies['billing'] = $value;
                }

                public function get_shipping_company()
                {
                    return $this->companies['shipping'];
                }

                public function set_shipping_company($value)
                {
                    $this->companies['shipping'] = $value;
                }
            };
            WC_Twoinc_Checkout::decode_store_api_company($order);
            TinyAssert::same(
                ['billing' => $savedBilling, 'shipping' => $savedShipping],
                $order->companies,
                $description . ': got ' . var_export($order->companies, true)
            );
        }
    }
}
