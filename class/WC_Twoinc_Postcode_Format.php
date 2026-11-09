<?php

if (!class_exists('WC_Twoinc_Postcode_Format')) {
    /**
     * Fits a registry postcode to its country's written format before company
     * autofill copies it into the address form (TWO-27159, as PrestaShop,
     * OpenCart and Magento). A register can give "1234AB" where the
     * Netherlands writes "1234 AB", or "00950" where Poland writes "00-950".
     *
     * WooCommerce's own postcode handling validates and normalises a handful
     * of countries rather than holding one format to write for each, so the
     * formats are held here, the same table as the other plugins.
     *
     * In a format, N is a digit and L is a letter; a space or a hyphen is a
     * separator.
     */
    final class WC_Twoinc_Postcode_Format
    {
        /** The postcode format of each country that has one fixed pattern. */
        public const FORMATS = [
            'AT' => 'NNNN', 'BE' => 'NNNN', 'BG' => 'NNNN', 'CH' => 'NNNN', 'CY' => 'NNNN', 'CZ' => 'NNN NN',
            'DE' => 'NNNNN', 'DK' => 'NNNN', 'EE' => 'NNNNN', 'ES' => 'NNNNN', 'FI' => 'NNNNN', 'FR' => 'NNNNN',
            'GR' => 'NNN NN', 'HR' => 'NNNNN', 'HU' => 'NNNN', 'IT' => 'NNNNN', 'LU' => 'NNNN', 'NL' => 'NNNN LL',
            'NO' => 'NNNN', 'PL' => 'NN-NNN', 'PT' => 'NNNN-NNN', 'RO' => 'NNNNNN', 'SE' => 'NNN NN', 'SK' => 'NNN NN',
            'IS' => 'NNN', 'LI' => 'NNNN', 'MT' => 'LLL NNNN', 'SI' => 'NNNN',
        ];

        /**
         * Spaces and hyphens are dropped and the format's separators put back
         * when what remains fills the format's slots exactly. Anything else,
         * and a country with no format, is returned unchanged. Letter case is
         * kept.
         */
        public static function fit(string $postcode, string $country): string
        {
            $format = self::FORMATS[strtoupper(trim($country))] ?? '';
            if ($format === '' || $postcode === '') {
                return $postcode;
            }
            $chars = str_replace([' ', '-'], '', $postcode);
            $out = '';
            $at = 0;
            for ($i = 0, $n = strlen($format); $i < $n; $i++) {
                $slot = $format[$i];
                if ($slot === ' ' || $slot === '-') {
                    $out .= $slot;
                    continue;
                }
                $char = substr($chars, $at, 1);
                if (preg_match($slot === 'N' ? '/^[0-9]$/' : '/^[a-zA-Z]$/', $char) !== 1) {
                    return $postcode;
                }
                $out .= $char;
                $at++;
            }

            return $at === strlen($chars) ? $out : $postcode;
        }

        /**
         * fit() applied to every address of a company-detail body, each
         * against the address's own country, else the company's. An address
         * with no string postcode, and a body with no address list, are
         * returned unchanged.
         *
         * @param array $body the decoded company-detail response
         * @return array
         */
        public static function fit_company(array $body): array
        {
            if (!is_array($body['addresses'] ?? null)) {
                return $body;
            }
            $company_country = is_string($body['country'] ?? null) ? $body['country'] : '';
            foreach ($body['addresses'] as $i => $address) {
                if (!is_array($address) || !is_string($address['postal_code'] ?? null)) {
                    continue;
                }
                $country = is_string($address['country'] ?? null) && $address['country'] !== ''
                    ? $address['country']
                    : $company_country;
                $body['addresses'][$i]['postal_code'] = self::fit($address['postal_code'], $country);
            }

            return $body;
        }
    }
}
