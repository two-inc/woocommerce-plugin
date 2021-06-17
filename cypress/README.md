# E2e Test for woocom plugin

To install dependencies, run
```
npm install
```

To run tests
```
# On local
npx cypress run --browser chrome --config-file "local-cypress.json" --config baseUrl=http://localhost

# On staging
export CYPRESS_TEST_WP_ADMIN_USERNAME="YOUR_USERNAME"
export CYPRESS_TEST_WP_ADMIN_PASSWORD="YOUR_PASSWORD"
npx cypress run --browser chrome --config-file "staging-cypress.json" --config baseUrl=https://staging.demo.tillit.ai
```