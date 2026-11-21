<?php

/**
 * What the "Tax codes for 0% lines" settings section shows (TWO-26153). Admin only: nothing at order time reads it.
 * WC_Twoinc::get_tax_code_section_state() gathers the facts; this decides, first match wins:
 *
 *   no API key                    hidden
 *   no merchant profile           profile_error why it could not be read (rejected when the key was refused)
 *   no answer from the code list  list_error    why it could not be read
 *   codes mandatory at 0%         rows          the mapping table
 *   otherwise                     notice        the saved mapping's standing, else hidden
 *
 * On top of every view but hidden: an unreadable saved mapping (N3, with Clear), and checkout holding other merchant
 * details than the profile (W1).
 */
class WC_Twoinc_Tax_Code_Section
{
    const VIEW_HIDDEN = 'hidden';
    const VIEW_PROFILE_ERROR = 'profile_error';
    const VIEW_LIST_ERROR = 'list_error';
    const VIEW_ROWS = 'rows';
    const VIEW_NOTICE = 'notice';

    /** The saved mapping cannot be read, so checkout withholds the payment method. */
    const NOTICE_UNREADABLE = 'N3';
    /** Checkout holds another merchant id or country than the profile. */
    const NOTICE_CHECKOUT_STALE = 'W1';
    /** Every saved code is listed at 0% for the country, which does not require them. */
    const NOTICE_SAVED_VALID = 'N1';
    /** A saved code is unlisted, or not at 0%, for the country. */
    const NOTICE_SAVED_INVALID = 'N2';

    /**
     * @param array $facts
     *   has_key          bool
     *   readable         bool, WC_Twoinc::read_tax_code_map() !== null
     *   entries          array<string,string>, the saved mapping ([] when unreadable or none)
     *   profile          array{merchant_id:string,country:string}|null
     *   profile_failure  array{stage:string,category:string,http:int}|null, why there is no profile
     *   list             array{codes:array,mandatory:bool}|null, null when there is no answer
     *   list_http        int, the list fetch's HTTP status when there is no answer (0 when none)
     *   checkout_id      string, the merchant id checkout uses
     *   checkout_country string, the merchant country checkout uses
     * @return array{view:string,notices:string[],clear:bool,country:string,codes:array,rejected:bool,http:int}
     */
    public static function state(array $facts)
    {
        $state = ['view' => self::VIEW_HIDDEN, 'notices' => [], 'clear' => false, 'country' => '', 'codes' => [], 'rejected' => false, 'http' => 0];
        if (empty($facts['has_key'])) {
            return $state;
        }
        if (empty($facts['readable'])) {
            $state['notices'][] = self::NOTICE_UNREADABLE;
            $state['clear'] = true;
        }
        $profile = $facts['profile'] ?? null;
        if (null === $profile) {
            $failure = (array) ($facts['profile_failure'] ?? []);
            $state['view'] = self::VIEW_PROFILE_ERROR;
            $state['http'] = (int) ($failure['http'] ?? 0);
            $state['rejected'] = in_array($state['http'], [401, 403], true);
            return $state;
        }
        $state['country'] = $profile['country'];
        if ($profile['merchant_id'] !== (string) ($facts['checkout_id'] ?? '') || $profile['country'] !== (string) ($facts['checkout_country'] ?? '')) {
            $state['notices'][] = self::NOTICE_CHECKOUT_STALE;
        }
        if (null === ($facts['list'] ?? null)) {
            $state['view'] = self::VIEW_LIST_ERROR;
            $state['http'] = (int) ($facts['list_http'] ?? 0);
            return $state;
        }
        $state['codes'] = $facts['list']['codes'];
        if (!empty($facts['list']['mandatory'])) {
            $state['view'] = self::VIEW_ROWS;
            return $state;
        }
        if (!empty($facts['readable']) && ($facts['entries'] ?? []) !== []) {
            $state['notices'][] = self::all_zero_and_listed($facts['entries'], $state['codes']) ? self::NOTICE_SAVED_VALID : self::NOTICE_SAVED_INVALID;
            $state['clear'] = true;
        }
        $state['view'] = [] === $state['notices'] ? self::VIEW_HIDDEN : self::VIEW_NOTICE;
        return $state;
    }

    /**
     * Whether the metadata of GET /v1/tax_codes/<country> makes a code mandatory on a 0% line: mandatory codes are
     * enabled and one of the mandatory rates is numerically zero.
     *
     * @param mixed $metadata
     * @return bool
     */
    public static function is_mandatory_at_zero($metadata)
    {
        if (!is_array($metadata) || empty($metadata['mandatory_tax_codes_enabled']) || !is_array($metadata['mandatory_tax_rates'] ?? null)) {
            return false;
        }
        foreach ($metadata['mandatory_tax_rates'] as $rate) {
            if (is_numeric($rate) && 0.0 === (float) $rate) {
                return true;
            }
        }
        return false;
    }

    /**
     * The codes a 0% line may carry: the listed codes at rate 0. Two refuses any other code on a 0% line.
     *
     * @param array $codes the code list's entries
     * @return array
     */
    public static function zero_rated(array $codes)
    {
        return array_values(array_filter($codes, static function ($code) {
            return is_array($code) && is_numeric($code['rate'] ?? null) && 0.0 === (float) $code['rate'];
        }));
    }

    /**
     * @param array<string,string> $entries
     * @param array $codes
     * @return bool whether every saved code is listed at rate 0
     */
    private static function all_zero_and_listed(array $entries, array $codes)
    {
        $zero = array_column(self::zero_rated($codes), 'code');
        foreach ($entries as $code) {
            if (!in_array($code, $zero, true)) {
                return false;
            }
        }
        return true;
    }
}
