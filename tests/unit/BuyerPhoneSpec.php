<?php

declare(strict_types=1);

/**
 * The buyer's phone in the order Two is asked to create (TWO-27209). The WooCommerce 7.6 Checkout block can save
 * an order whose billing phone is empty while its shipping phone holds what the buyer typed, and Two refuses an
 * empty phone, so the shipping phone is sent when billing has none.
 */
final class BuyerPhoneSpec
{
    public static function runAll(): void
    {
        self::testTheBuyerPhoneFallsBackToTheShippingPhone();
        print("BuyerPhoneSpec passed.\n");
    }

    private static function testTheBuyerPhoneFallsBackToTheShippingPhone(): void
    {
        // [billing phone, shipping phone, phone sent, description]
        $rows = [
            ['+4712345678', '+4787654321', '+4712345678', 'billing set: the billing phone is sent'],
            ['', '+447700900123', '+447700900123', 'billing empty, shipping set: the shipping phone is sent'],
            ['', '', '', 'both empty: sent empty, as before'],
        ];
        foreach ($rows as [$billing, $shipping, $expected, $description]) {
            $order = new class ($billing, $shipping) extends StubOrder {
                private $billing;
                private $shipping;

                public function __construct(string $billing, string $shipping)
                {
                    $this->billing = $billing;
                    $this->shipping = $shipping;
                }

                public function get_billing_phone()
                {
                    return $this->billing;
                }

                public function get_shipping_phone()
                {
                    return $this->shipping;
                }
            };
            $body = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
            TinyAssert::same($expected, $body['buyer']['representative']['phone_number'], $description);
        }
    }
}
