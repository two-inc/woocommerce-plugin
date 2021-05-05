<?php

/**
 * Tillit Gateway
 *
 * Provides integration between WooCommerce and Tillit
 *
 * @class WC_Tillit
 * @extends WC_Payment_Gateway
 * @version 0.0.1
 * @package WooCommerce/Classes/Payment
 * @author Tillit
 */

class WC_Tillit extends WC_Payment_Gateway
{

    /**
     * WC_Tillit constructor.
     */
    public function __construct()
    {

        $this->id = 'woocommerce-gateway-tillit';
        $this->has_fields = false;
        // $this->order_button_text = __('Proceed to Tillit', 'woocommerce-gateway-tillit');
        $this->order_button_text = __('Place order', 'woocommerce-gateway-tillit');
        $this->method_title = __('Tillit', 'woocommerce-gateway-tillit');
        $this->method_description = __('Making it easy for businesses to buy online.', 'woocommerce-gateway-tillit');
        $this->icon = WC_HTTPS::force_https_url(WC_TILLIT_PLUGIN_URL . 'assets/images/logo.svg');
        $this->supports = ['products'];

        // Load the settings
        $this->init_form_fields();
        $this->init_settings();

        // Define user set variables
        $this->title = $this->get_option('title');
        $this->description = sprintf(
            '<p>%s <span class="tillit-buyer-name"></span>.</p>',
            __('By completing the purchase, you verify that you have the legal right to purchase on behalf of', 'woocommerce-gateway-tillit')
        );
        $this->api_key = $this->get_option('api_key');

        // Tillit api host
        $checkout_env = $this->get_option('checkout_env');
        $this->tillit_search_host = 'https://search-api-demo-j6whfmualq-lz.a.run.app';
        $this->tillit_checkout_host = $checkout_env == 'prod' ? 'https://api.tillit.ai'
                                    : ($checkout_env == 'dev' ? 'https://huynguyen.hopto.org:8083'
                                    : 'https://staging.api.tillit.ai');

        global $tillit_payment_gateway;
        if (isset($tillit_payment_gateway)) {
            return;
        }

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
        if(!$this->get_option('api_key') || !$this->get_option('tillit_merchant_id')) return;
        add_action('woocommerce_order_status_completed', [$this, 'on_order_completed']);
        add_action('woocommerce_order_status_cancelled', [$this, 'on_order_cancelled']);
        add_action('get_header', [$this, 'process_confirmation']);
        add_action('woocommerce_update_options_checkout', [$this, 'update_checkout_options']);
        add_action('admin_enqueue_scripts', [$this, 'tillit_admin_scripts']);

        $tillit_payment_gateway = $this;
        new WC_Tillit_Checkout($this);

    }

    /**
     * Add filter to gateway payment title
     */
    public function change_tillit_payment_title(){
        add_filter('woocommerce_gateway_title', function ($title, $payment_id) {
            if( $payment_id === 'woocommerce-gateway-tillit' ) {
                $title = sprintf(
                    '%s<div class="tillit-subtitle">%s</div> ',
                    $this->get_option('title'),
                    $this->get_option('subtitle')
                );
            }
            return $title;
        }, 10, 2);
    }

    /**
     * Send the merchant logo to Tillit API
     *
     * @return void
     */
    public function update_checkout_options()
    {

        if(!isset($_POST['woocommerce_woocommerce-gateway-tillit_merchant_logo']) && !isset($_POST['woocommerce_woocommerce-gateway-tillit_tillit_merchant_id'])) return;

        $image_id = $_POST['woocommerce_woocommerce-gateway-tillit_merchant_logo'];
        $merchant_id = $_POST['woocommerce_woocommerce-gateway-tillit_tillit_merchant_id'];

        $image = $image_id ? wp_get_attachment_image_src($image_id, 'full') : null;
        $image_src = $image ? $image[0] : null;

        if(!$image_src) return;

        $this->make_request("/v1/merchant/${merchant_id}/update", [
            'merchant_id' => $merchant_id,
            'logo_path' => $image_src
        ]);

    }

    /**
     * Enqueue the admin scripts
     *
     * @return void
     */
    public function tillit_admin_scripts()
    {

        if (!did_action('wp_enqueue_media')) {
            wp_enqueue_media();
        }

        wp_enqueue_script( 'tillit.admin', WC_TILLIT_PLUGIN_URL . '/assets/js/admin.js', ['jquery']);
        wp_enqueue_style( 'tillit.admin', WC_TILLIT_PLUGIN_URL . '/assets/css/admin.css');

    }

    /**
     * Generate the section title
     *
     * @param $field_id
     * @param $field_args
     *
     * @return string
     */
    public function generate_separator_html($field_id, $field_args)
    {
        ob_start();
        ?>
        <tr valign="top">
            <th colspan="2">
                <h3 style="margin-bottom: 0;"><?php echo $field_args['title']; ?></h3>
            </th>
        </tr>
        <?php
        return ob_get_clean();
    }

    /**
     * Generate a radio input
     *
     * @param $key
     * @param $data
     *
     * @return false|string
     */
    public function generate_radio_html($key, $data)
    {
        $field_key = $this->get_field_key( $key );
        $defaults  = array(
            'title'             => '',
            'label'             => '',
            'disabled'          => false,
            'class'             => '',
            'css'               => '',
            'type'              => 'text',
            'desc_tip'          => false,
            'description'       => '',
            'custom_attributes' => array(),
            'checked'           => false
        );

        $data = wp_parse_args( $data, $defaults );

        if ( ! $data['label'] ) {
            $data['label'] = $data['title'];
        }

        ob_start();
        ?>
        <tr valign="top">
            <td class="forminp" colspan="2">
                <fieldset>
                    <legend class="screen-reader-text"><span><?php echo wp_kses_post( $data['title'] ); ?></span></legend>
                    <label for="<?php echo esc_attr( $field_key ); ?>">
                        <input <?php disabled( $data['disabled'], true ); ?> class="<?php echo esc_attr( $data['class'] ); ?>" type="radio" name="<?php echo esc_attr( $field_key ); ?>" id="<?php echo esc_attr( $field_key ); ?>" style="<?php echo esc_attr( $data['css'] ); ?>" value="1" <?php checked($data['checked'] === true, true); ?> <?php echo $this->get_custom_attribute_html( $data ); // WPCS: XSS ok. ?> /> <?php echo wp_kses_post( $data['label'] ); ?></label><br/>
                    <?php echo $this->get_description_html( $data ); // WPCS: XSS ok. ?>
                </fieldset>
            </td>
        </tr>
        <?php

        return ob_get_clean();

    }

    public function generate_logo_html($field_key, $data)
    {
        $image_id = $this->get_option($field_key);
        $image = $image_id ? wp_get_attachment_image_src($image_id, 'full') : null;
        $image_src = $image ? $image[0] : null;
        ob_start();
        ?>
        <tr valign="top">
            <th scope="row" class="titledesc">
                <label for="<?php echo esc_attr($field_key); ?>"><?php echo wp_kses_post($data['title']); ?></label>
            </th>
            <td class="forminp">
                <fieldset>
                    <input type="hidden" name="woocommerce_woocommerce-gateway-tillit_<?php echo $field_key; ?>" id="<?php echo esc_attr($field_key); ?>" class="logo_id" value="<?php echo $image_id; ?>" />
                    <div class="image-container woocommerce-tillit-image-container">
                        <?php if($image_src): ?>
                            <img src="<?php echo $image_src; ?>" alt="" />
                        <?php endif; ?>
                    </div>
                    <button class="button-secondary woocommerce-tillit-logo" type="button"><?php _e('Select image', 'woocommerce-gateway-tillit'); ?></button>
                </fieldset>
            </td>
        </tr>
        <?php
        return ob_get_clean();
    }

    /**
     * Notify Tillit API after order item update
     *
     * @param $order
     */
    public function after_order_item_update($order)
    {
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        if (!$_POST || !isset($_POST['action'])) {
            return;
        }
        $action = $_POST['action'];

        if ($action == 'woocommerce_add_order_item') {
            $order->calculate_totals(true);
            $this->update_tillit_order($order);
            WC_Tillit_Helper::append_admin_force_reload();
        } else if ($action == 'woocommerce_remove_order_item') {
            $this->update_tillit_order($order);
            WC_Tillit_Helper::append_admin_force_reload();
        } else if ($action == 'woocommerce_add_order_fee') {
            $this->update_tillit_order($order);
            WC_Tillit_Helper::append_admin_force_reload();
        } else if ($action == 'woocommerce_add_order_shipping') {
            $this->update_tillit_order($order);
            WC_Tillit_Helper::append_admin_force_reload();
        // } else if ($action == 'woocommerce_add_order_tax') {
        // } else if ($action == 'woocommerce_remove_order_tax') {
        } else if ($action == 'woocommerce_calc_line_taxes') {
            $this->update_tillit_order($order);
            WC_Tillit_Helper::append_admin_force_reload();
        }
    }

    /**
     * Check if order is updated
     *
     * @param $order_id
     * @param $items
     */
    public function before_order_update($order_id, $items)
    {

        $order = wc_get_order($order_id);
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        $original_line_items = WC_Tillit_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'));

        if (!property_exists($this, 'order_line_items')) $this->order_line_items = array();
        $this->order_line_items[$order_id] = $original_line_items;

    }

    /**
     * Notify Tillit API after the order is updated
     *
     * @param $order_id
     * @param $items
     */
    public function after_order_update($order_id, $items)
    {

        $order = wc_get_order($order_id);
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        $original_line_items = $this->order_line_items[$order_id];
        $updated_line_items = WC_Tillit_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'));
        $diff = WC_Tillit_Helper::array_diff_r($original_line_items, $updated_line_items);

        if ($diff) {

            $this->update_tillit_order($order);

            WC_Tillit_Helper::append_admin_force_reload();

        }
    }

    /**
     * Notify Tillit API when the order status is completed
     *
     * @param $order_id
     */
    public function on_order_completed($order_id)
    {
        if($this->get_option('finalize_purchase') !== 'yes') {
            return;
        }

        // Get the order
        $order = wc_get_order($order_id);

        // Check payment method
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        // Get the Tillit order ID
        $tillit_order_id = get_post_meta($order->get_id(), 'tillit_order_id', true);
        $notice_id = $tillit_order_id . '_on_order_completed';

        // Change the order status
        $response = $this->make_request("/v1/order/${tillit_order_id}/shipped");

        if(is_wp_error($response)) {
            WC_Tillit_Helper::display_admin_reloaded_error($notice_id, __('Could not update status', 'woocommerce-gateway-tillit'));
            return;
        }

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            WC_Tillit_Helper::display_admin_reloaded_error(
                $notice_id,
                sprintf(__('Could not update status to fulfilled on Tillit, please check with Tillit admin for id %s', 'woocommerce-gateway-tillit'), $tillit_order_id));
            return;
        }

        // Decode the response
        $body = json_decode($response['body'], true);

        // Save invoice number
        if ($body['payment'] && $body['payment']['payment_details'] && $body['payment']['payment_details']['invoice_number']) {
            update_post_meta($order->get_id(), 'invoice_number', $body['payment']['payment_details']['invoice_number']);
        }

        WC_Tillit_Helper::remove_admin_reloaded_error($notice_id);
    }

    /**
     * Notify Tillit API when the order status is cancelled
     *
     * @param $order_id
     */
    public function on_order_cancelled($order_id)
    {
        // Get the order
        $order = wc_get_order($order_id);

        // Check payment method
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        // Get the Tillit order ID
        $tillit_order_id = get_post_meta($order->get_id(), 'tillit_order_id', true);
        $notice_id = $tillit_order_id . '_on_order_cancelled';

        // Change the order status
        $response = $this->make_request("/v1/order/${tillit_order_id}/cancel");

        if(is_wp_error($response)) {
            WC_Tillit_Helper::display_admin_reloaded_error($notice_id, __('Could not update status', 'woocommerce-gateway-tillit'));
            return;
        }

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            WC_Tillit_Helper::display_admin_reloaded_error(
                $notice_id,
                sprintf(__('Could not update status to cancelled, please check with Tillit admin for id %s', 'woocommerce-gateway-tillit'), $tillit_order_id));
            return;
        }

        WC_Tillit_Helper::remove_admin_reloaded_error($notice_id);
    }

    /**
     * Process the payment
     *
     * @param int $order_id
     *
     * @return array
     */
    public function process_payment($order_id)
    {

        // Get the order
        $order = wc_get_order($order_id);

        // Check payment method
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        // Genereate an order reference string
        $order_reference = wp_generate_password(64, false, false);

        // Store the order meta
        update_post_meta($order_id, '_tillit_order_reference', $order_reference);
        update_post_meta($order_id, 'company_id', sanitize_text_field($_POST['company_id']));
        update_post_meta($order_id, 'department', sanitize_text_field($_POST['department']));
        update_post_meta($order_id, 'project', sanitize_text_field($_POST['project']));

        // Create order
        $response = $this->make_request('/v1/order', WC_Tillit_Helper::compose_tillit_order(
            $order,
            $order_reference,
            sanitize_text_field($_POST['company_id']),
            sanitize_text_field($_POST['department']),
            sanitize_text_field($_POST['project']),
            $this->get_option('tillit_merchant_id'),
            $this->get_option('days_on_invoice'),
        ));

        // Stop on failure
        if(isset($response['result']) && $response['result'] === 'failure') {
            return $response;
        }

        // If we have an error
        if($response['response']['code'] === 401 || $response['response']['code'] === 403) {
            WC_Tillit_Helper::display_ajax_error(__('Website is not properly configured with Tillit payment', 'woocommerce-gateway-tillit'));

            // Return with error
            return;
        }

        // If we have an error
        if($response['response']['code'] === 400) {
            WC_Tillit_Helper::display_ajax_error(__('Please update the plugin', 'woocommerce-gateway-tillit'));

            // Return with error
            return;
        }

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err || $response['response']['code'] >= 400) {
            WC_Tillit_Helper::display_ajax_error(__('Invoice is not available for this order', 'woocommerce-gateway-tillit'));

            // Return with error
            return;
        }

        // Decode the response
        $body = json_decode($response['body'], true);

        // Store the Tillit Order Id for future use
        update_post_meta($order_id, 'tillit_order_id', $body['id']);

        // Return the result
        return [
            'result'    => 'success',
            'redirect'  => $body['tillit_urls']['verify_order_url'],
        ];

    }

    /**
     * Process the order confirmation
     *
     * @return void
     */
    public function process_confirmation()
    {

        // Stop if no Tillit order reference and no nonce
        if(!isset($_REQUEST['tillit_confirm_order']) || !isset($_REQUEST['nonce'])) return;

        // Get the order reference
        $order_reference = sanitize_text_field($_REQUEST['tillit_confirm_order']);

        // Get the nonce
        $nonce = $_REQUEST['nonce'];

        // Stop if the code is not valid
        if(!wp_verify_nonce($nonce, 'tillit_confirm')) wp_die(__('The security code is not valid.', 'woocommerce-gateway-tillit'));

        /** @var wpdb $wpdb */
        global $wpdb;

        $sql = $wpdb->prepare("SELECT post_id FROM $wpdb->postmeta WHERE meta_key = %s AND meta_value = %s", '_tillit_order_reference', $order_reference);
        $row = $wpdb->get_row($sql , ARRAY_A);

        // Stop if no order found
        if(!isset($row['post_id'])) wp_die(__('Unable to find the requested order', 'woocommerce-gateway-tillit'));

        // Get the order ID
        $order_id = $row['post_id'];

        // Get the order object
        $order = new WC_Order($order_id);

        // Check payment method
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        // Get the Tillit order ID
        $tillit_order_id = get_post_meta($order_id, 'tillit_order_id', true);

        // Get the Tillit order details
        $response = $this->make_request("/v1/order/${tillit_order_id}", [], 'GET');

        // Stop if request error
        if(is_wp_error($response)) {
            wp_die(__('Unable to retrieve the order information', 'woocommerce-gateway-tillit'));
        }

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            wp_die(__('Unable to retrieve the order payment information', 'woocommerce-gateway-tillit'));
        }

        // Decode the response
        $body = json_decode($response['body'], true);

        // Get the order state
        $state = $body['state'];

        // Mark order as processing
        if($state === 'VERIFIED') $order->update_status('processing');

        // Get the redirect URL by order state
        $redirect = $state === 'VERIFIED' ? wp_specialchars_decode($order->get_checkout_order_received_url())
                                          : wp_specialchars_decode($order->get_cancel_order_url());

        // Redirec the user to the requested page
        wp_redirect($redirect);

    }

    /**
     * Register Admin form fields
     *
     * @return void
     */
    public function init_form_fields()
    {
        $this->form_fields = apply_filters('wc_tillit_form_fields', [
            'enabled' => [
                'title'     => __('Enable/Disable', 'woocommerce-gateway-tillit'),
                'type'      => 'checkbox',
                'label'     => __('Enable Tillit Payments', 'woocommerce-gateway-tillit'),
                'default'   => 'yes'
            ],
            'title' => [
                'title'     => __('Title', 'woocommerce-gateway-tillit'),
                'type'      => 'text',
                'default'   => __('Business invoice 30 days', 'woocommerce-gateway-tillit')
            ],
            'subtitle' => [
                'title'     => __('Subtitle', 'woocommerce-gateway-tillit'),
                'type'      => 'text',
                'default'   => __('Receive the invoice via EHF and PDF', 'woocommerce-gateway-tillit')
            ],
            'tillit_merchant_id' => [
                'title'     => __('Tillit Merchant ID', 'woocommerce-gateway-tillit'),
                'type'      => 'text'
            ],
            'api_key' => [
                'title'     => __('API Key', 'woocommerce-gateway-tillit'),
                'type'      => 'password',
            ],
            'merchant_logo' => [
                'title'     => __('Logo', 'woocommerce-gateway-tillit'),
                'type'      => 'logo'
            ],
            'section_title_product' => [
                'type'      => 'separator',
                'title'     => __('Choose your product', 'woocommerce-gateway-tillit')
            ],
            'product_merchant' => [
                'type'      => 'radio',
                'name'      => 'product_type',
                'disabled'  => true,
                'label'     => __('Merchant Invoice (coming soon)', 'woocommerce-gateway-tillit')
            ],
            'product_administered' => [
                'type'      => 'radio',
                'name'      => 'product_type',
                'disabled'  => true,
                'label'     => __('Administered invoice (coming soon)', 'woocommerce-gateway-tillit')
            ],
            'product_funded' => [
                'type'      => 'radio',
                'name'      => 'product_type',
                'label'     => __('Funded invoice', 'woocommerce-gateway-tillit'),
                'checked'   => true
            ],
            'days_on_invoice' => [
                'title'     => __('Number of days on invoice', 'woocommerce-gateway-tillit'),
                'type'      => 'text',
                'default'   => '14',
            ],
            'section_title_settings' => [
                'type'      => 'separator',
                'title'     => __('Settings', 'woocommerce-gateway-tillit')
            ],
            'checkout_env' => [
                'type'      => 'select',
                'title'     => __('Mode', 'woocommerce-gateway-tillit'),
                'default'   => 'stg',
                'options' => array(
                      'prod' => 'Production',
                      'stg'  => 'Staging',
                      'dev'  => 'Development'
                 )
            ],
            'enable_company_name' => [
                'title'     => __('Activate company name auto-complete', 'woocommerce-gateway-tillit'),
                'label'     => ' ',
                'type'      => 'checkbox',
            ],
            'enable_company_id' => [
                'title'     => __('Activate company org.id auto-complete', 'woocommerce-gateway-tillit'),
                'label'     => ' ',
                'type'      => 'checkbox',
            ],
            'finalize_purchase' => [
                'title'     => __('Finalize purchase when order is shipped', 'woocommerce-gateway-tillit'),
                'label'     => ' ',
                'type'      => 'checkbox',
            ],
            'enable_order_intent' => [
                'title'     => __('Pre-approve the buyer during checkout and disable Tillit if the buyer is declined', 'woocommerce-gateway-tillit'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes',
            ],
            'enable_b2b_b2c_radio' => [
                'title'     => __('Activate B2C/B2B check-out radio button', 'woocommerce-gateway-tillit'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes',
            ],
            'clear_options_on_deactivation' => [
                'title'     => __('Clear settings on deactivation', 'woocommerce-gateway-tillit'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes',
            ]
        ]);
    }

    /**
     * Run the update execution
     *
     * @param $order_id
     */
    private function update_tillit_order($order)
    {

        $tillit_order_id = get_post_meta($order->get_id(), 'tillit_order_id', true);
        $notice_id = $tillit_order_id . '_after_order_update';


        // 1. Get information from the current order
        $response = $this->make_request("/v1/order/${tillit_order_id}", [], 'GET');

        $body = json_decode($response['body'], true);

        $company_id = get_post_meta($order->get_id(), 'company_id', true);
        if ($company_id) {
            $department = get_post_meta($order->get_id(), 'department', true);
            $project = get_post_meta($order->get_id(), 'project', true);
        } else {
            if (!$body || !$body['buyer'] || !$body['buyer']['company'] || !$body['buyer']['company']['organization_number']) {
                WC_Tillit_Helper::display_admin_reloaded_error(
                    $notice_id,
                    sprintf(__('Missing company ID, please check with Tillit admin for id %s', 'woocommerce-gateway-tillit'), $tillit_order_id));
                return;
            }
            $company_id = $body['buyer']['company']['organization_number'];
            $department = $body['buyer_department'];
            $project = $body['buyer_project'];
            update_post_meta($order->get_id(), 'company_id', $company_id);
            update_post_meta($order->get_id(), 'department', $department);
            update_post_meta($order->get_id(), 'project', $project);
        }
        $order_reference = get_post_meta($order->get_id(), '_tillit_order_reference', true);


        // 2. Cancel the current order
        $response = $this->make_request("/v1/order/${tillit_order_id}/cancel");

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            WC_Tillit_Helper::display_admin_reloaded_error(
                $notice_id,
                sprintf(__('Could not cancel the Tillit order, please check with Tillit admin for id %s', 'woocommerce-gateway-tillit'), $tillit_order_id));
            return;
        }


        // 3. Create new order
        $response = $this->make_request('/v1/order', WC_Tillit_Helper::compose_tillit_order(
            $order,
            $order_reference,
            $company_id,
            $department,
            $project,
            $this->get_option('tillit_merchant_id'),
            $this->get_option('days_on_invoice'),
        ));

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            WC_Tillit_Helper::display_admin_reloaded_error(
                $notice_id,
                __('Could not recreate new Tillit order, please check with Tillit admin', 'woocommerce-gateway-tillit'));
            return;
        }

        $body = json_decode($response['body'], true);

        $new_tillit_order_id = $body['id'];
        update_post_meta($order->get_id(), 'tillit_order_id', $new_tillit_order_id);

        WC_Tillit_Helper::remove_admin_reloaded_error($notice_id);


        // 4. Set new order to verified
        $notice_id = $new_tillit_order_id . '_after_order_update';
        $response = $this->make_request("/v1/verify_order/${new_tillit_order_id}", [], 'GET');

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            WC_Tillit_Helper::display_admin_reloaded_error(
                $notice_id,
                sprintf(__('Could not verify the Tillit order, please check with Tillit admin for id %s', 'woocommerce-gateway-tillit'), $new_tillit_order_id));
            return;
        }

        WC_Tillit_Helper::remove_admin_reloaded_error($notice_id);

    }

    /**
     * Make a request to Tillit API
     *
     * @param $endpoint
     * @param $payload
     * @param string $method
     *
     * @return WP_Error|array
     */
    private function make_request($endpoint, $payload = [], $method = 'POST')
    {
        return wp_remote_request(sprintf('%s%s', $this->tillit_checkout_host, $endpoint), [
            'method' => $method,
            'headers' => [
                'Content-Type' => 'application/json; charset=utf-8',
                'Tillit-Merchant-Id' => $this->get_option('tillit_merchant_id'),
                'Authorization' => sprintf('Basic %s', base64_encode(
                    $this->get_option('tillit_merchant_id') . ':' . $this->get_option('api_key')
                ))
            ],
            'timeout' => 30,
            'body' => empty($payload) ? '' : json_encode($payload),
            'data_format' => 'body'
        ]);
    }

    /**
     * On deactivating the plugin
     *
     * @return void
     */
    public function on_deactivate_plugin()
    {
        if($this->get_option('clear_options_on_deactivation') === 'yes') {
            delete_option('woocommerce_woocommerce-gateway-tillit_settings');
        }
    }

}
