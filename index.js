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

const puppeteer = require('puppeteer'),
    openPageTimeoutInMilliSec = config.get('Screenshots.phantomOpenPageTimeoutInSec') * 30000,
    userAgentString = config.get('Screenshots.userAgent'),
    clipWidth = config.get('Screenshots.clipWidth'),
    clipHeight = config.get('Screenshots.clipHeight');

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

var crawling = false;
(async () => {
    try {
        const chromiumBrowser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        var puppeteerPage = await chromiumBrowser.newPage();
        // setup crawler
        if (process.env.NODE_ENV !== 'production') {
            // turn on chrome log for dev/local-test only
            puppeteerPage.on('console', msg => console.log('PUPPETEER LOG: ' , msg.text()));
        }
        await puppeteerPage.setViewport({
            width: clipWidth,
            height: clipHeight
        });
        await puppeteerPage.setUserAgent(userAgentString);
        await puppeteerPage.setDefaultNavigationTimeout(openPageTimeoutInMilliSec);

        setInterval(() => {
            if (!crawling) {
                emitter.emit('CANCRAWL');
            }
        }, 1000);

        // `CANCRAWL` event will be emitted when a chromium page has finished crawling
        emitter.on('CANCRAWL', async () => {
            // Retrieve a screenshot message from redis, 
            // after rpop command, the message will be removed from 
            // redis `${topic}` list automatically
            const messageString = await rpopAsync(`${topic}`);
            if (messageString) {
                const fetchedMessage = parseScreenshotMessageFromRedis(messageString);
                logger.info(`Message fetched and removed: ------ ${messageString}`);
                crawling = true;
                await crawler.captureScreen(fetchedMessage, appRoot, db, puppeteerPage);
                crawling = false;
                logger.info(`Finished crawling for the following message: ${messageString}`);
            }
        });

        const subscription = await subscriptionsAsync();
        // message listener
        subscription.on('message', async (message) => {
            var websiteInfo = message.attributes;
            message.ack();
            var messageString = `websiteUrl:${websiteInfo.websiteUrl},pid:${websiteInfo.pid},crgId:${websiteInfo.crgId}`;
            logger.info(`Received ${topic} message to capture screenshot: ------ ${messageString}`);
            if (!crawling) {
                crawling = true;
                await crawler.captureScreen(websiteInfo, appRoot, db, puppeteerPage);
                crawling = false;
                logger.info(`${messageString} FINISHED crawling`);
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