<?php

/**
 * Brand fixture whose merchant-portal signup URL carries a query and a
 * fragment. A dev portal override swaps the origin and must keep both — a
 * developer sent to a bare path lands on a different portal route than
 * production uses.
 */

return [
    'code' => 'querysignupbrand',
    'sign_up_url' => 'https://portal.two.inc/auth/merchant/signup?ref=wc#step1',
];
