# The e2e image for one WordPress x PHP leg (TWO-27171).
#
# docker-library rebuilds wordpress:php<minor>-apache for every PHP patch, but
# stops rebuilding a series tag such as wordpress:7.0-php8.4-apache once a newer
# WordPress series ships, so that tag's PHP falls behind. This keeps the
# maintained runtime and swaps in the WordPress core under test, at the exact
# version dev/support-matrix.sh resolved, verified against wordpress.org's
# published checksum. The image's entrypoint copies /usr/src/wordpress into a
# fresh volume on first boot, as it does for the stock image.
ARG PHP_MINOR
FROM wordpress:php${PHP_MINOR}-apache

ARG WORDPRESS_CORE
RUN set -eux; \
    test -n "${WORDPRESS_CORE}"; \
    cd /tmp; \
    curl -fsSL --retry 3 -o wordpress.tar.gz "https://wordpress.org/wordpress-${WORDPRESS_CORE}.tar.gz"; \
    sha1=$(curl -fsSL --retry 3 "https://wordpress.org/wordpress-${WORDPRESS_CORE}.tar.gz.sha1"); \
    echo "${sha1} *wordpress.tar.gz" | sha1sum -c -; \
    mkdir keep; \
    cp -a /usr/src/wordpress/.htaccess /usr/src/wordpress/wp-config-docker.php keep/; \
    rm -rf /usr/src/wordpress; \
    tar -xzf wordpress.tar.gz -C /usr/src/; \
    cp -a keep/. /usr/src/wordpress/; \
    rm -rf keep wordpress.tar.gz; \
    chown -R www-data:www-data /usr/src/wordpress; \
    grep -q "\$wp_version = '${WORDPRESS_CORE}';" /usr/src/wordpress/wp-includes/version.php

# PHP before 8.1 truncates each logged error at log_errors_max_len (1024 bytes
# in this image). A doing-it-wrong backtrace names the plugin past that point,
# so the e2e notice gate would file it as upstream. 0 means no limit; PHP 8.1
# removed the setting.
RUN if php -r 'exit(PHP_VERSION_ID < 80100 ? 0 : 1);'; then \
        echo 'log_errors_max_len = 0' > /usr/local/etc/php/conf.d/zz-log-errors-max-len.ini; \
    fi
