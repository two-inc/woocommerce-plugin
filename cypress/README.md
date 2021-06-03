# E2e Test for woocom plugin

To install dependencies, run
```
npm install
```

To run tests, run command
```
npx cypress run
npx cypress run --browser chrome
```

on local machine, create "cypress.env.json" on root folder with this content to set environment variable
```
{
  "TEST_WORDPRESS_HOST_NAME":"your_host",
  "TEST_WORDPRESS_ADMIN_USERNAME": "your_username",
  "TEST_WORDPRESS_ADMIN_PASSWORD": "your_password"
}

```
