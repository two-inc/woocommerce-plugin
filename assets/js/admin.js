jQuery(function($){

    $('body').on('click', '.woocommerce-tillit-logo', function(e){

        e.preventDefault()

        const $button = $(this),
            custom_uploader = wp.media({
                title: 'Insert image',
                library : {
                    type : 'image'
                },
                button: {
                    text: 'Use this image'
                },
                multiple: false
            }).on('select', function() {

                const attachment = custom_uploader.state().get('selection').first().toJSON()

                const $context = $button.parent()
                let $image = $context.find('.image-container')

                $image.empty()
                $context.find('.logo_id').val(attachment.id).change().blur()
                $image.append('<img src="' + attachment.url + '">')

            }).open()

    })

    $('body').on('change', '#woocommerce_woocommerce-gateway-tillit_enable_company_name', function(e){

        let radioCompanyId = $('#woocommerce_woocommerce-gateway-tillit_enable_company_id')

        if(!$(this).prop('checked')) {
            radioCompanyId.prop('checked', false)
            radioCompanyId.attr('disabled', true)
        } else {
            radioCompanyId.attr('disabled', false)
        }

    })

    jQuery('h3.wc-settings-sub-title').append('<a href="#" class="collapsed setting-dropdown"><span class="dashicons dashicons-arrow-down-alt2"></span></a>')
    jQuery('h3.wc-settings-sub-title a').click(function(e) {
        e.preventDefault()

        if ($(this).hasClass('collapsed')) {
            $(this).parent().next().show()
            $(this).removeClass('collapsed')
            $(this).html('<span class="dashicons dashicons-arrow-up-alt2"></span>')
        } else {
            $(this).parent().next().hide()
            $(this).addClass('collapsed')
            $(this).html('<span class="dashicons dashicons-arrow-down-alt2"></span>')

        }
    })
    jQuery('h3.wc-settings-sub-title, p.submit').before('<hr class="setting-separator" />')

    jQuery('h3.wc-settings-sub-title').next().hide()
})
