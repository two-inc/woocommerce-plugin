jQuery(function($){

    $('body').on('click', '.woocommerce-tillit-logo', function(e){

        e.preventDefault();

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

                const attachment = custom_uploader.state().get('selection').first().toJSON();

                const $context = $button.parent();
                let $image = $context.find('.image-container');

                $image.empty();
                $context.find('.logo_id').val(attachment.id).change().blur();
                $image.append('<img src="' + attachment.url + '">');

            }).open();

    });

});
