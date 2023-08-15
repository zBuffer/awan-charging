# Cloud Charging
Author: Lance Chong

## Lambda
Lambda functions are located at `index.js`.

## Test
Be sure to install all dependencies first `npm i`. The test uses developer parameters to intentionally slow down the API to test for race-conditions. Please refer to `DELAY_KEY` and `DELAY_MS` for the (naive) key and delay settings.

Configure endpoints in `test/test.js` first, then run the test suite with the following command:

```bash
npm run test
```