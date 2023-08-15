"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const redis = require("redis");
const memcached = require("memcached");
const util = require("util");
const KEY = `account1/balance`;
const DEFAULT_BALANCE = 100;
const MAX_EXPIRATION = 60 * 60 * 24 * 30;
const memcachedClient = new memcached(`${process.env.ENDPOINT}:${process.env.PORT}`);
const DELAY_KEY = "foobar";
// NOTE: to enable intentional delays, Lambda max execution time must be lifted to more than 4s
const DELAY_MS = 3000;
let client = null;
exports.chargeRequestRedis = async function (input) {
    const redisClient = await getRedisClient();
    await watchRedis(redisClient, KEY);
    var remainingBalance = await getBalanceRedis(redisClient, KEY);
    var charges = getCharges(input);
    const isAuthorized = authorizeRequest(remainingBalance, charges);
    if (!isAuthorized) {
        return {
            remainingBalance,
            isAuthorized,
            charges: 0,
        };
    }
    await checkDelay(input);
    const multi = redisClient.multi();
    multi.decrby(KEY, charges);
    const remainingBalanceNew = await execRedis(multi);
    if (!remainingBalanceNew) {
        // another operation changed the value, transaction rolled back
        // well we could choose to retry the entire function, but let's not do that now
        return {
            remainingBalance,
            isAuthorized: false,
            charges: 0,
        };
    }
    remainingBalance = remainingBalanceNew[0];

    // old code without transaction support
    // remainingBalance = await chargeRedis(redisClient, KEY, charges);

    // keep the connection alive
    // await disconnectRedis(redisClient);
    return {
        remainingBalance,
        charges,
        isAuthorized,
    };
};
exports.resetRedis = async function () {
    const redisClient = await getRedisClient();
    const ret = new Promise((resolve, reject) => {
        redisClient.set(KEY, String(DEFAULT_BALANCE), (err, res) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(DEFAULT_BALANCE);
            }
        });
    });
    // keep the connection alive
    // await disconnectRedis(redisClient);
    return ret;
};
exports.resetMemcached = async function () {
    var ret = new Promise((resolve, reject) => {
        memcachedClient.set(KEY, DEFAULT_BALANCE, MAX_EXPIRATION, (res, error) => {
            if (error)
                resolve(res);
            else
                reject(DEFAULT_BALANCE);
        });
    });
    return ret;
};
exports.chargeRequestMemcached = async function (input) {
    var [remainingBalance, cas] = await getBalanceMemcached(KEY);
    const charges = getCharges(input);
    const isAuthorized = authorizeRequest(remainingBalance, charges);
    if (!authorizeRequest(remainingBalance, charges)) {
        return {
            remainingBalance,
            isAuthorized,
            charges: 0,
        };
    }
    await checkDelay(input);
    // old code not using cas
    // remainingBalance = await chargeMemcached(KEY, charges, cas);
        const result = await chargeCasMemcached(KEY, remainingBalance - charges, cas);
        if (!result) {
            // value written during operation, we could retry but we choose to abort for now
            // (for ease of testing)
            return {
                remainingBalance,
                isAuthorized: false,
                charges: 0,
            };
        }

        console.log('chargeCasMemcached:', result);
        remainingBalance -= charges;
        return {
            remainingBalance,
            charges,
            isAuthorized,
        };
};
// used to exaggerate race conditions by intentionally delaying execution
async function checkDelay(input) {
    if (input && input.delay && input.delay == DELAY_KEY) {
        console.log('intentionally delaying execution');
        await new Promise(resolve => {
            setTimeout(resolve, DELAY_MS);
        });
        console.log('resuming execution');
    }
}
async function getRedisClient() {
    return new Promise((resolve, reject) => {
        console.log('connecting to redis');
        try {
            // connect to redis if not connected
            if (!client) {
                client = new redis.RedisClient({
                    host: process.env.ENDPOINT,
                    port: parseInt(process.env.PORT || "6379"),
                });
                client.on("ready", () => {
                    console.log('redis client ready');
                    resolve(client);
                });
                // if redis gets disconnected
                client.on("end", () => {
                    console.log('redis client destroyed');
                    client = null;
                });
                // if redis has error for unspecified reasons
                client.on("error", (e) => {
                    console.error('redis client error', e);
                    client = null;
                });
            } else {
                // reuse existing client
                console.log('reusing redis client');
                resolve(client);
            }
        }
        catch (error) {
            client = null;
            reject(error);
        }
    });
}
async function disconnectRedis(client) {
    return new Promise((resolve, reject) => {
        client.quit((error, res) => {
            if (error) {
                reject(error);
            }
            else if (res == "OK") {
                console.log('redis client disconnected');
                resolve(res);
            }
            else {
                reject("unknown error closing redis connection.");
            }
        });
    }); 
}
function authorizeRequest(remainingBalance, charges) {
    return remainingBalance >= charges;
}
function getCharges(input) {
    if (!input || !input.unit) throw new Error('required: unit');
    // basic sanitisation for input.unit
    // redis implementation uses parseInt so we have to check for integer
    if (!Number.isInteger(input.unit) || input.unit < 0) throw new Error('invalid: unit');
    return input.unit;
}
async function getBalanceRedis(redisClient, key) {
    const res = await util.promisify(redisClient.get).bind(redisClient).call(redisClient, key);
    return parseInt(res || "0");
}
async function chargeRedis(redisClient, key, charges) {
    return util.promisify(redisClient.decrby).bind(redisClient).call(redisClient, key, charges);
}
async function watchRedis(redisClient, key) {
    return util.promisify(redisClient.watch).bind(redisClient).call(redisClient, key);
}
async function execRedis(redisClient) {
    return util.promisify(redisClient.exec).bind(redisClient).call(redisClient);
}
async function getBalanceMemcached(key) {
    return new Promise((resolve, reject) => {
        memcachedClient.gets(key, (err, data) => {
            if (err) {
                reject(err);
            }
            else {
                resolve([Number(data[key]), data.cas]);
            }
        });
    });
}
async function chargeMemcached(key, charges) {
    return new Promise((resolve, reject) => {
        memcachedClient.decr(key, charges, (err, result) => {
            if (err) {
                reject(err);
            }
            else {
                return resolve(Number(result));
            }
        });
    });
}
async function chargeCasMemcached(key, remainingBalance, cas) {
    return new Promise((resolve, reject) => {
        memcachedClient.cas(key, remainingBalance, cas, MAX_EXPIRATION, (err, result) => {
            if (err) {
                reject(err);
            }
            else {
                return resolve(result);
            }
        });
    });
}
