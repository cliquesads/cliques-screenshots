/* jshint node: true */
'use strict';

const node_utils = require('@cliques/cliques-node-utils'),
    ScreenshotPubSub = node_utils.google.pubsub.ScreenshotPubSub,
    logger = require('./lib/logger'),
    path = require('path'),
    config = require('config'),
    appRoot = path.resolve(__dirname),
    crawler = require('./lib/crawler.js'),
    {promisify} = require('util'),
    EventEmitter = require('events'),
    db = require('./lib/connections').EXCHANGE_CONNECTION;

const redis = require('redis'),
    client = redis.createClient(),
    rpopAsync = promisify(client.rpop).bind(client),
    lpushAsync = promisify(client.lpush).bind(client);

const puppeteer = require('puppeteer');

/**
 * The allowed maximum number of chromium instances running concurrently 
 */
const MAX_NUMBER_CHROMIUM_INSTANCES = 20;
/**
 * The maximum elapsed time in seconds allowed for a chromium instance
 */
const MAX_HANGING_SECONDS = 1800;
const INSTANCE_NAME = 'chrome';

/* ---------------- SCREENSHOT PUBSUB INSTANCE & LISTENERS ----------------- */

// Here's where the Controller methods actually get hooked to signals from
// the outside world via Google PubSub api.
const projectId = config.get('Screenshots.google.projectId'),
    topic = config.get('Screenshots.google.topic');

var pubsub_options = {};
if (process.env.NODE_ENV == 'local-test') {
    pubsub_options = {
        projectId: projectId,
        test: true
    };
} else {
    pubsub_options = { projectId: projectId };
}
const screenshotPubSub = new ScreenshotPubSub(pubsub_options),
    subscriptionsAsync = promisify(screenshotPubSub.subscriptions[topic]);

let emitter = new EventEmitter();

function getNumberOfChromeInstances() {
    const execSync = require('child_process').execSync;
    try {
        var n = execSync(`pgrep -c ${INSTANCE_NAME}`).toString();
        return n;
    } catch(err) {
        return -1;
    }
}

/**
 * handleChromeInstances checks if any of the chrome instance has been hanging 
 * for too long and kill the overtime chrome instance if any
 */
function handleChromeInstances() {
    const execSync = require('child_process').execSync;
    try {
        var temp = execSync(`pgrep ${INSTANCE_NAME}`).toString();
        var pidList = temp.split('\n');
        for (var i = 0; i < pidList.length; i ++) {
            if (pidList[i] !== '') {
                var elapsedSeconds = execSync(`ps -p ${pidList[i]} -o etimes`).toString();
                elapsedSeconds = elapsedSeconds.replace('ELAPSED', '').trim();
                elapsedSeconds = parseInt(elapsedSeconds, 10);
                if (elapsedSeconds > MAX_HANGING_SECONDS) {
                    execSync(`kill ${pidList[i]}`);
                    emitter.emit('FINISH');
                }
            }
        }
    } catch(err) {
        return null;
    }
}

setInterval(() => {
    var numberOfChromiums = getNumberOfChromeInstances();
    if (numberOfChromiums >= MAX_NUMBER_CHROMIUM_INSTANCES) {
        handleChromeInstances();
    }
}, 1000);

/**
 * Screenshot message are saved in redis as a string with the following format:
 * `websiteUrl:http://some-url.com,pid:123x56,crgId:7891b`. This function parses
 * the string to an object
 * @param messageString {String}
 * @return messageObject {Object}
 */ 
function parseScreenshotMessageFromRedis(messageString) {
    var arr = messageString.split(',');
    var message = {};
    message.websiteUrl = arr[0].substring('websiteUrl:'.length);
    message.pid = arr[1].substring('pid:'.length);
    message.crgId = arr[2].substring('crgid:'.length);
    return message;
}

// ycx!!!!!!
/*
(async() => {
    var websiteInfo = {
        // websiteUrl: 'https://www.jetsetter.com/magazine/the-best-walking-shoes-for-women/',
        // pid: '5a1da639fd036a622ac66f6f',
        // crgId: '5bd86b3881d8242478b9a485'
        // websiteUrl: 'https://www.smartertravel.com/tips-rochester-warnings-dangers-stay-safe/',
        // pid: '59dd1bf7d2d6b76dfb5e9635',
        // crgId: '5aa1aee55cc72143f9b802dc'
        websiteUrl: 'https://www.jetsetter.com/magazine/packing-tips-you-need-to-know/?source=115966&u=B7HS5HEOIN&nltv=&nl_cs=50916767%3A%3A%3A%3A%3A%3A&mcid=57485',
        pid: '5a1da639fd036a622ac66f6f',
        crgId: '5bd86b3881d8242478b9a485'
    };
    const chromiumBrowser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    await crawler.captureScreen(websiteInfo, appRoot, db, chromiumBrowser);
})();
*/
// end of ycx!!!!!!

// ycx!!!!!!
(async () => {
    try {
        const chromiumBrowser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        // `FINISH` event will be emitted when a chromium instance exists
        emitter.on('FINISH', async () => {
            var numberOfChromiums = getNumberOfChromeInstances();
            console.log(`---====== inside on FINISH, numberOfChromiums: ${numberOfChromiums}`);
            if (numberOfChromiums < MAX_NUMBER_CHROMIUM_INSTANCES) {
                // Retrieve a screenshot message from redis, 
                // after rpop command, the message will be removed from 
                // redis `${topic}` list automatically
                const messageString = await rpopAsync(`${topic}`);
                if (messageString) {
                    const fetchedMessage = parseScreenshotMessageFromRedis(messageString);
                    logger.info(`Message fetched and removed: ------ ${messageString}`);

                    await crawler.captureScreen(fetchedMessage, appRoot, db, chromiumBrowser);
                    logger.info(`Finished crawling for the following message: ${messageString}`);
                    emitter.emit('FINISH');
                }
            }
        });

        const subscription = await subscriptionsAsync();
        // message listener
        subscription.on('message', async (message) => {
            var websiteInfo = message.attributes;
            message.ack();
            var messageString = `websiteUrl:${websiteInfo.websiteUrl},pid:${websiteInfo.pid},crgId:${websiteInfo.crgId}`;
            logger.info(`Received ${topic} message to capture screenshot: ------ ${messageString}`);
            var numberOfChromiums = getNumberOfChromeInstances();
            console.log(`---====== inside on message, numberOfChromiums: ${numberOfChromiums}`);
            if (numberOfChromiums < MAX_NUMBER_CHROMIUM_INSTANCES) {
                await crawler.captureScreen(websiteInfo, appRoot, db, chromiumBrowser);
                logger.info(`${messageString} FINISHED crawling`);
                emitter.emit('FINISH'); 
            } else {
                logger.info(`Reached maximum allowed chromium instances, save the following message and handle it later: ------ ${messageString}`);
                // Save screenshot message to redis in a LIST named `${topic}`
                await lpushAsync(`${topic}`, `${messageString}`);
            }
        });
        subscription.on('error', (err) => {
            var errorString;
            if (typeof err === 'string') {
                errorString = err;
            } else {
                errorString = JSON.stringify(err);
            }
            logger.error(`Error subscribing to ${topic} topic, will not be able to receive signals until this is fixed. Error message: ${errorString}`);
        });
    } catch(err) {
        logger.error(err);
    }
})();