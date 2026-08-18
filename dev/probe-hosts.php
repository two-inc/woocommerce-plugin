<?php

require '/var/www/html/wp-load.php';
$gateway = WC_Twoinc::get_instance();
echo "get_environment_host(api): " . WC_Twoinc_Helper::get_environment_host('api', $gateway) . "\n";
echo "get_environment_host(portal): " . WC_Twoinc_Helper::get_environment_host('portal', $gateway) . "\n";
echo "get_environment_host(checkout): " . WC_Twoinc_Helper::get_environment_host('checkout', $gateway) . "\n";
