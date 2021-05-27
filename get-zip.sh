#!/bin/bash
zip -r woocommerce-gateway-tillit.zip 'assets' 'class' 'views' 'readme.txt' '*.php' '*.pot' '*.mo' '*.po'
printf "\n\n"
read -n 1 -s -r -p "Zipping completed. Please press any key to exit"