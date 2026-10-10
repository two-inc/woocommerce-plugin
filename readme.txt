=== Two - BNPL for businesses ===
Tags: payment request, woocommerce
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
WC requires at least: 7.6
Stable tag: 3.0.0
License: GPLv3
License URI: https://www.gnu.org/licenses/gpl-3.0.html
Two - BNPL for businesses is a WooCommerce plugin that simplifies B2B shopping, allowing merchants to safely offer invoices as a payment method.

== Description ==

**Making it easy for businesses to sell & buy online.**

Two - BNPL for businesses is a WooCommerce plugin that simplifies B2B shopping, allowing merchants to safely offer invoices as a payment method. This standalone add-on complements your checkout, catering to business customers' preferred payment methods, increasing conversion rates, and boosting sales.

= Benefits for Merchants =

Two provides a seamless **Buy Now, Pay Later** option, enhancing the buyer journey and reducing manual tasks in B2B transactions. It offers instant payment terms without credit approval delays, reducing the risk of losing customers.

Simply put, Two is customer-centric, with less friction and higher conversion rates.

= Why use the Two plugin? =

-   70% of business customers prefer to pay by invoice.
-   Automated customer credit check and verification.
-   Real-time credit approval.
-   Full control over checkout adjustments.
-   Customizable payment terms for business customers.
-   Integrated with PEPPOL e-invoicing network.
-   Guaranteed payment regardless of when the buyer pays.

= Benefits for Customers =

**Two Buy Now, Pay Later** offers a frictionless invoice solution, sending invoices directly to accountants through electronic invoicing.

= Compatibility with WooCommerce =

The plugin has been tested for compatibility with WooCommerce version 10.3.5 with
[HPOS](https://woocommerce.com/document/high-performance-order-storage/) enabled, on both the
classic shortcode checkout and the [block-based checkout](https://woocommerce.com/checkout-blocks/).
It requires WooCommerce 7.6 or later.

== Installation ==

Install the plugin via:

-   WordPress built-in installer
-   WordPress Admin
-   Manual upload via SFTP

Find the WordPress installation guide [here](https://wordpress.org/support/article/managing-plugins/#installing-plugins).

= How to Get Your Two Keys =

1.  Sign up at [two.inc](https://two.inc/).
2.  Log in to your Two [merchant portal account](https://portal.two.inc/merchant/integration).
3.  Click "Manage sandbox API keys" to obtain your test keys.
4.  After successful testing, request your production keys to start offering Two to your B2B customers.

Feel free to reach out to [integration@two.inc](mailto:integration@two.inc) for any assistance related to the plugin.

== Changelog ==

= 3.0.0 =

* Breaking: the "Default shipping tax class" setting has been removed and there is no migration. Its stored value is not carried over anywhere.
* A shipping line is sent at the tax rate WooCommerce recorded for it, including a 0% rate, and Two checks it. A shipping line with no recorded rate is sent as charged at 0%, unless the shop runs `wp option update twoinc_shipping_tax_from_shop_rates yes`: then its rate is taken from WooCommerce's own shipping tax class (WooCommerce > Settings > Tax, including "based on cart items"), and an order whose shipping tax does not match that rate is refused at checkout with a named error.
* Compound tax rates are declared at their true combined rate.
* A refund declares the tax rates the order was charged at, not the shop's current rates. A refund of the tax alone, or of the net alone, is sent as such.
* Refunds and order edits of an order whose shipping rate came from the shop's rates use the rate recorded at checkout. A shipping line with no rate recorded at checkout is sent as charged, whatever the shop's settings are later.
* Order lines at 0% tax can now carry the tax code Two needs for them. Under WooCommerce > Settings > Payments > Two, "Tax codes for 0% lines" lets you choose a code for each tax class. For a Spanish merchant, lines you leave unmapped get a code worked out from the order where one applies: exports, deliveries to the Canary Islands, Ceuta and Melilla, intra-community supplies of goods and services to a buyer with an EU VAT number from a member state other than yours, and services to buyers outside the EU. The buyer's VAT number is read from the order fields the common EU VAT plugins store, or supplied through the `twoinc_buyer_vat_number` filter, and sent to Two with the order as entered, with only leading and trailing spaces trimmed. A number whose first two letters, as entered, are not an EU country other than yours gets no intra-community code. Two checks every code, and refuses a Spanish merchant's 0% line that has none.
* Requires WooCommerce 7.6 or later.
* Developers can change anything the plugin sends to Two, such as treating untaxed shipping as VAT-inclusive, through the new `twoinc_order_postprocessing` filter. It is documented as a permanent contract in the plugin's README. The older order filters still work but are deprecated.
* The buyer surcharge is priced on the order as WooCommerce built it, before that filter runs. Code on the filter that adds a line or changes the order total does not change the surcharge: any fee consequence of the amounts it declares is up to that code. The README now says so.
* Whatever that filter returns is sent to Two as it is, and Two checks it. If Two refuses an order, its reason is written to the WooCommerce log and to an order note. Orders your shop sends without the filter go out as before, except that an order whose total discount comes out negative is no longer refused (see below).
* The check that a shipping line's tax matches the shop's shipping tax setting now runs after that filter, in the plugin's own handler on it, and only while no other code is registered on the filter. Code that is registered takes over responsibility for whether the figures match the shop, and can run the same check itself with `WC_Twoinc_Helper::check_shop_match()`. Shops with no code registered on the filter see no change, including shops still using the older order filters.
* The availability check at checkout is now worked out on your server from the basket, so it sees the same order lines the order itself will carry.
* Two does not accept edits to an order once it is fulfilled. If you change such an order's lines, amounts or addresses, the order now shows that the changes were not sent to Two and adds one order note saying so. Adding a tracking number is not counted as a change.
* An order is no longer refused because its total discount comes out negative. The order's total discount is sent to Two for information only, and a negative total is sent as 0. A negative discount on an order line is still refused.
* Fixed: after a buyer changed country at checkout, the availability check could be priced with the previous country's tax.
* Fixed: on the Checkout block, a buyer who chose a company and then changed country could keep that company, so the availability check failed with an error instead of an answer. Changing country now clears the chosen company, as it already did on the classic checkout, and the buyer picks one from the new country. Where the company search filled in the delivery address, that address is cleared with it. A company remembered from an earlier visit is offered again only while the billing country is the one it was chosen under, so after this update a returning buyer may be asked to pick their company once more. A company you set on a customer's user profile is likewise offered only while the checkout's billing country matches the billing country saved on their account. The availability check on the Checkout block also now includes the buyer's name, email and phone number.
* Choosing a Spanish company from the company search now fills in its province, so checkout no longer stops with "Province is a required field".
* On shops using WooCommerce's High-Performance Order Storage, a change to an order's addresses or details saved from the order screen is now sent to Two. Before, only changes to the order's items were sent.
* The plugin now declares that it supports WooCommerce's High-Performance Order Storage and the cart and checkout blocks, so WooCommerce no longer lists it as incompatible with them.

= 2.25.0 =

* You can now show a short line about paying by invoice on your product pages, under the add to cart button, so a buyer sees the option before filling a basket. It is off until you switch it on under WooCommerce > Settings > Payments > Two, where you can also replace the wording with your own. Where exactly the line lands on the page depends on your theme.
* You can also add a buy button beside Add to cart. It adds the item to the basket and opens the checkout with Two already chosen, so a buyer who has decided does not have to find the payment method later. It does not place the order, and the basket they already had is kept. Off until you switch it on in the same place.

= 2.24.0 =

* Block-based checkout: the payment method, company capture and terms consent now work on the WooCommerce Checkout block as well as the classic shortcode checkout.
* Sole traders can check out with Two: autofill from a previous visit first, sign-up only when needed, and the option to pay as a different sole trader.
* Company search is offered only for countries with a supported business registry; buyers elsewhere get the plain company field.
* Payment-term choices are shown as chips on the payment tile, honouring the merchant's default term and preferring 30 days. Any surcharge for a term is shown with it.
* Surcharge pricing requires a merchant tax rule, and amounts are consistent across WooCommerce tax settings.
* The merchant record is refreshed on activation, nightly and on demand. Two is withheld at checkout for a buyer country the merchant's account does not cover, and the admin explains why.
* If the account's payment terms cannot be read, the payment method is still offered: no term choices are shown and the account default applies.
* Settings can be saved even when the Two API cannot be reached.
* Custom request headers can be configured for merchants whose firewall requires them.
* Order-intent notices are unified with Two's other platform plugins and can be switched off.
* Checkout tagline translated into Norwegian and Swedish.

= 2.23.9 =

* Maintenance release: compatibility information updated.

= 2.23.8 =

* Documented how to override the API key.

= 2.23.7 =

* Fixed the payment method icon markup so themes can style it.

= 2.23.6 =

* Fixed product image URLs being sent as a boolean.

= 2.23.5 =

* Maintenance release.

= 2.23.4 =

* Maintenance release.

= 2.23.3 =

* Translation updates.

= 2.23.2 =

* Request logging now goes through WooCommerce's own logger.
* Translation updates.

= 2.23.1 =

* Fixed an error when a cart line item was not an object.

= 2.23.0 =

* Added API key validity status and improved response logging.

= 2.22.0 =

* Removed the personal and sole-trader checkout options. (Sole-trader checkout returns in 2.24.0.)
* Removed the buyer invoice fee and the payment description from checkout.
* Order intents now carry net and tax amounts.
* Fewer notification emails.

= 2.21.1 =

* Maintenance release.

= 2.21.0 =

* Two's checkout fields are shown only when Two is the selected payment method.
* The business account type is always visible.

= 2.20.3 =

* Fall back to the displayed company name when no company is set on the order.

= 2.20.2 =

* Maintenance release.

= 2.20.1 =

* A credit note can be downloaded once an order has refunded payments.

= 2.20.0 =

* Compatible with WooCommerce High-Performance Order Storage (HPOS).
* Refunding an order in WooCommerce now refunds it with Two.
* The API key is validated at checkout, and the Merchant ID setting is no longer needed.
* Rejection reasons are recorded on the order notes.

Older releases are listed at https://github.com/two-inc/woocommerce-plugin/releases

== Upgrade Notice ==

= 3.0.0 =
Removes the "Default shipping tax class" setting, with no migration. See the changelog for the WP-CLI option that takes the shipping tax rate from WooCommerce's shipping tax class.

= 2.25.0 =
Adds an optional line about paying by invoice on your product pages, and an optional buy button beside Add to cart. Nothing changes until you switch them on under WooCommerce > Settings > Payments > Two.

= 2.24.0 =
Adds block-based checkout support and sole-trader checkout. Review the payment-term and surcharge settings after updating.
