const assert = require('assert');
const sa = require('superagent');

const BASEURL_MEMCACHE = "https://ah2klyridb.execute-api.us-east-1.amazonaws.com/prod";
const BASEURL_REDIS = "https://w8p8vv0skf.execute-api.us-east-1.amazonaws.com/prod";

const ENDPOINT_CHARGE_MEMCACHED = "/charge-request-memcached";
const ENDPOINT_RESET_MEMCACHED = "/reset-memcached";

const ENDPOINT_CHARGE_REDIS = "/charge-request-redis";
const ENDPOINT_RESET_REDIS = "/reset-redis";

const DELAY_KEY = "foobar";

describe('Memcache', function() {
    this.timeout("10s");

    // this is not very accurate, verify in CloudWatch to be sure
    it('should have < 25 ms execution budget', async function () {
        let start = Date.now();
        await pingMemcache();
        await pingMemcache();
        await pingMemcache();
        const overheads = (Date.now() - start) / 3;
        
        // reset balance
        await postResetMemcache();

        // warm up
        await postChargeMemcache(2);

        // start benchmarking
        start = Date.now();
        await postChargeMemcache(2);
        await postChargeMemcache(2);
        await postChargeMemcache(2);
        const diff = (Date.now() - start) / 3 - overheads;
        assert.equal(true, diff < 25, `expected average less than 25 ms, actual: ${diff.toFixed(1)} ms`);
    });

    it('should deduct amounts properly', async function() {
        // reset balance
        await postResetMemcache();

        const r1 = await postChargeMemcache(10);
        assert.deepEqual(r1.body, {
            remainingBalance: 90,
            isAuthorized: true,
            charges: 10,
        });

        const r2 = await postChargeMemcache(50);
        assert.deepEqual(r2.body, {
            remainingBalance: 40,
            isAuthorized: true,
            charges: 50,
        });

        // note this must match remainingBalance above
        const amtRand = Math.floor(Math.random()*40);
        const r3 = await postChargeMemcache(amtRand);
        assert.deepEqual(r3.body, {
            remainingBalance: 40 - amtRand,
            isAuthorized: true,
            charges: amtRand,
        });

        // test edge condition: spend all
        const r4 = await postChargeMemcache(r3.body.remainingBalance);
        assert.deepEqual(r4.body, {
            remainingBalance: 0,
            isAuthorized: true,
            charges: r3.body.remainingBalance,
        });
    });

    it('should not allow negative unit', async function() {
        await postResetMemcache();
        await assert.rejects(() => postChargeMemcache(-1));
    });

    it('should not allow fraction unit', async function() {
        await postResetMemcache();
        await assert.rejects(() => postChargeMemcache(0.1));
    });

    it('should not allow non numeric unit', async function() {
        await postResetMemcache();
        await assert.rejects(() => postChargeMemcache("foobar"));
    });

    it('should not allow over spending', async function() {
        await postResetMemcache();
        const r1 = await postChargeMemcache(101);
        assert.deepEqual(r1.body, {
            remainingBalance: 100,
            isAuthorized: false,
            charges: 0,
        });
    });

    it('should reject race condition', async function() {
        await postResetMemcache();
        
        // force api to pause in the middle to allow us to inject another request in between
        const q1 = postChargeMemcache(100, DELAY_KEY);
        const q2 = postChargeMemcache(100, DELAY_KEY);

        const r1 = await q1;
        const r2 = await q2;
        // console.log(r1.body, r2.body);
        if (r1.body.isAuthorized) {
            assert.deepEqual(r1.body, {
                remainingBalance: 0,
                isAuthorized: true,
                charges: 100,
            });
            assert.deepEqual(r2.body, {
                remainingBalance: 100,
                isAuthorized: false,
                charges: 0,
            });
        }
        if (r2.body.isAuthorized) {
            assert.deepEqual(r2.body, {
                remainingBalance: 0,
                isAuthorized: true,
                charges: 100,
            });
            assert.deepEqual(r1.body, {
                remainingBalance: 100,
                isAuthorized: false,
                charges: 0,
            });
        }
    });
});

describe('Redis', function() {
    this.timeout("10s");

    // this is not very accurate, verify in CloudWatch to be sure
    it('should have < 25 ms execution budget', async function () {
        let start = Date.now();
        await pingRedis();
        await pingRedis();
        await pingRedis();
        const overheads = (Date.now() - start) / 3;
        
        // reset balance
        await postResetRedis();

        // warm up
        await postChargeRedis(2);

        // start benchmarking
        start = Date.now();
        await postChargeRedis(2);
        await postChargeRedis(2);
        await postChargeRedis(2);
        const diff = (Date.now() - start) / 3 - overheads;
        assert.equal(true, diff < 25, `expected average less than 25 ms, actual: ${diff.toFixed(1)} ms`);
    });

    it('should deduct amounts properly', async function() {
        // reset balance
        await postResetRedis();

        const r1 = await postChargeRedis(10);
        assert.deepEqual(r1.body, {
            remainingBalance: 90,
            isAuthorized: true,
            charges: 10,
        });

        const r2 = await postChargeRedis(50);
        assert.deepEqual(r2.body, {
            remainingBalance: 40,
            isAuthorized: true,
            charges: 50,
        });

        // note this must match remainingBalance above
        const amtRand = Math.floor(Math.random()*40);
        const r3 = await postChargeRedis(amtRand);
        assert.deepEqual(r3.body, {
            remainingBalance: 40 - amtRand,
            isAuthorized: true,
            charges: amtRand,
        });

        // test edge condition: spend all
        const r4 = await postChargeRedis(r3.body.remainingBalance);
        assert.deepEqual(r4.body, {
            remainingBalance: 0,
            isAuthorized: true,
            charges: r3.body.remainingBalance,
        });
    });

    it('should not allow negative unit', async function() {
        await postResetRedis();
        await assert.rejects(() => postChargeRedis(-1));
    });

    it('should not allow fraction unit', async function() {
        await postResetRedis();
        await assert.rejects(() => postChargeRedis(0.1));
    });

    it('should not allow non numeric unit', async function() {
        await postResetRedis();
        await assert.rejects(() => postChargeRedis("foobar"));
    });

    it('should not allow over spending', async function() {
        await postResetRedis();
        const r1 = await postChargeRedis(101);
        assert.deepEqual(r1.body, {
            remainingBalance: 100,
            isAuthorized: false,
            charges: 0,
        });
    });

    it('should reject race condition', async function() {
        await postResetRedis();
        
        // force api to pause in the middle to allow us to inject another request in between
        const q1 = postChargeRedis(100, DELAY_KEY);
        const q2 = postChargeRedis(100, DELAY_KEY);

        const r1 = await q1;
        const r2 = await q2;
        // console.log(r1.body, r2.body);
        if (r1.body.isAuthorized) {
            assert.deepEqual(r1.body, {
                remainingBalance: 0,
                isAuthorized: true,
                charges: 100,
            });
            assert.deepEqual(r2.body, {
                remainingBalance: 100,
                isAuthorized: false,
                charges: 0,
            });
        }
        if (r2.body.isAuthorized) {
            assert.deepEqual(r2.body, {
                remainingBalance: 0,
                isAuthorized: true,
                charges: 100,
            });
            assert.deepEqual(r1.body, {
                remainingBalance: 100,
                isAuthorized: false,
                charges: 0,
            });
        }
    });
});

// get endpoint, to measure roundabout time, ignore errors
async function pingMemcache() {
    try {
        await sa.get(BASEURL_MEMCACHE);
    } catch {}
}

// post charge operation to memcache endpoint
async function postChargeMemcache(unit, delay) {
    return throwOnError(await sa
    .post(`${BASEURL_MEMCACHE}${ENDPOINT_CHARGE_MEMCACHED}`)
    .send({
        serviceType: "voice",
        unit,
        delay
    }));
}

// post reset balance to memcache endpoint
async function postResetMemcache() {
    return await sa.post(`${BASEURL_MEMCACHE}${ENDPOINT_RESET_MEMCACHED}`);
}

// get endpoint, to measure roundabout time, ignore errors
async function pingRedis() {
    try {
        await sa.get(BASEURL_REDIS);
    } catch {}
}

// post charge operation to memcache endpoint
async function postChargeRedis(unit, delay) {
    return throwOnError(await sa
    .post(`${BASEURL_REDIS}${ENDPOINT_CHARGE_REDIS}`)
    .send({
        serviceType: "voice",
        unit,
        delay
    }));
}

// post reset balance to memcache endpoint
async function postResetRedis() {
    return await sa.post(`${BASEURL_REDIS}${ENDPOINT_RESET_REDIS}`);
}

// throws if api returns { errorType }
function throwOnError(resp) {
    if (!resp.body || resp.body.errorType == "Error")
        throw new Error(resp.body);
    return resp;
}
