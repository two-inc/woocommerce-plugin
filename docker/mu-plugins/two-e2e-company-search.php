<?php

/**
 * The e2e suite's fake for company search (TWO-27195). The shop's company search and company lookup calls to Two
 * are answered here from tests/e2e/fake/companies.json, which the specs read too. Every other call still goes to
 * Two. The suite tests the plugin, not Two's registry search, and a full matrix sharing one merchant key tripped
 * Two's rate limits on search.
 *
 * It answers at the shop's outbound HTTP layer, so the plugin's own proxy, rate limiter, parsing and checkout UI
 * all still run. Each answer carries an x-two-e2e-fake header, so the shop's API log shows who answered.
 *
 * Inert unless the wordpress container has TWO_E2E_FAKE_COMPANY_SEARCH=1, which the e2e legs set.
 */

if (getenv('TWO_E2E_FAKE_COMPANY_SEARCH') !== '1') {
    return;
}

/** The fixtures, read once per request. */
function two_e2e_fake_companies(): array
{
    static $companies = null;
    if ($companies === null) {
        $file = WP_PLUGIN_DIR . '/tillit-payment-gateway/tests/e2e/fake/companies.json';
        $companies = is_readable($file) ? json_decode((string) file_get_contents($file), true) : null;
        $companies = is_array($companies) ? $companies : [];
    }
    return $companies;
}

/** A response in the shape WP_Http returns, which the plugin reads with wp_remote_retrieve_*(). */
function two_e2e_fake_response(int $status, array $body): array
{
    $headers = ['content-type' => 'application/json', 'x-two-e2e-fake' => 'company-search'];
    // WordPress 6.2 moved the Requests library under a namespace; the floor (6.0) has only the old name.
    $dictionary = class_exists('WpOrg\Requests\Utility\CaseInsensitiveDictionary')
        ? 'WpOrg\Requests\Utility\CaseInsensitiveDictionary'
        : 'Requests_Utility_CaseInsensitiveDictionary';
    return [
        'headers' => new $dictionary($headers),
        'body' => wp_json_encode($body),
        'response' => ['code' => $status, 'message' => $status === 200 ? 'OK' : 'Not Found'],
        'cookies' => [],
        'filename' => null,
    ];
}

/** Two's search answer: the country's companies whose name starts with the query, up to the limit. */
function two_e2e_fake_search(array $query): array
{
    $country = strtoupper((string) ($query['country'] ?? ''));
    $term = strtoupper(trim((string) ($query['q'] ?? '')));
    $limit = max(1, (int) ($query['limit'] ?? 10));
    $items = [];
    foreach (two_e2e_fake_companies() as $company) {
        if ($company['country'] !== $country || $term === '' || strpos($company['name'], $term) !== 0) {
            continue;
        }
        $items[] = [
            'name' => $company['name'],
            'highlight' => '<mark><b>' . esc_html(substr($company['name'], 0, strlen($term))) . '</b></mark>'
                . esc_html(substr($company['name'], strlen($term))),
            'national_identifier' => $company['national_identifier'],
            'lookup_id' => $company['lookup_id'],
        ];
    }
    return two_e2e_fake_response(200, ['items' => array_slice($items, 0, $limit), 'degraded' => false]);
}

/** Two's lookup answer: the company's registry record, or a 404 for an id no fixture carries. */
function two_e2e_fake_lookup(string $lookup_id): array
{
    foreach (two_e2e_fake_companies() as $company) {
        if ($company['lookup_id'] === $lookup_id) {
            return two_e2e_fake_response(200, [
                'name' => $company['name'],
                'country' => $company['country'],
                'national_identifier' => $company['national_identifier'],
                'addresses' => $company['addresses'],
            ]);
        }
    }
    return two_e2e_fake_response(404, ['error' => 'not found']);
}

// Only the two company paths; anything else returns $pre untouched and goes to Two.
add_filter('pre_http_request', function ($pre, $args, $url) {
    $path = (string) wp_parse_url($url, PHP_URL_PATH);
    if (!preg_match('#^/companies/v2/company(?:/([^/]+))?$#', $path, $match)) {
        return $pre;
    }
    if (strtoupper((string) ($args['method'] ?? 'GET')) !== 'GET') {
        return $pre;
    }
    if (isset($match[1])) {
        return two_e2e_fake_lookup(rawurldecode($match[1]));
    }
    parse_str((string) wp_parse_url($url, PHP_URL_QUERY), $query);
    return two_e2e_fake_search($query);
}, 10, 3);
