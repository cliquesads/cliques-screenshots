/* jshint node: true */
'use strict';

var node_utils = require('@cliques/cliques-node-utils'),
    ScreenshotPubSub = node_utils.google.pubsub.ScreenshotPubSub;
var logger = require('./lib/logger');
var path = require('path');
var config = require('config');
var appRoot = path.resolve(__dirname);
var crawler = require('./lib/crawler.js');
var promise = require('bluebird');
var db = require('./lib/connections').EXCHANGE_CONNECTION;

var redis = require('redis'),
    client = redis.createClient();
promise.promisifyAll(redis.RedisClient.prototype);

/**
 * The allowed maximum number of phantomjs instances running concurrently 
 */
const MAX_NUMBER_PHANTOM_INSTANCES = 5;
/**
 * The number of currently running phantomjs instances
 */
var numberOfPhantoms = 0;


/* ---------------- SCREENSHOT PUBSUB INSTANCE & LISTENERS ----------------- */

// Here's where the Controller methods actually get hooked to signals from
// the outside world via Google PubSub api.
var projectId = config.get('Screenshots.google.projectId');
var topic = config.get('Screenshots.google.topic');

var pubsub_options = {};
if (process.env.NODE_ENV == 'local-test') {
    pubsub_options = {
        projectId: projectId,
        test: true
    };
} else {
    pubsub_options = { projectId: projectId };
}
var screenshotPubSub = new ScreenshotPubSub(pubsub_options);

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

var EventEmitter = require('events');
var emitter = new EventEmitter();
// `FINISH` event will be emitted when a phantom instance exists
emitter.on('FINISH', function() {
    if (numberOfPhantoms < MAX_NUMBER_PHANTOM_INSTANCES) {
        // Retrieve a screenshot message from redis, 
        // after rpop command, the message will be removed from 
        // redis `${topic}` list automatically
        return client.rpopAsync(`${topic}`)
        .then(function(messageString) {
            if (messageString) {
                var fetchedMessage = parseScreenshotMessageFromRedis(messageString);
                logger.info(`Message fetched and removed: ------ ${messageString}`);
                numberOfPhantoms ++;
                return crawler.captureScreen(fetchedMessage, appRoot, db)
                .then(function() {
                    numberOfPhantoms --;
                    logger.info(`Finished crawling for the following message: ${messageString}`);
                    emitter.emit('FINISH');
                });
            }
        });
    }
});

screenshotPubSub.subscriptions[topic](function(err, subscription) {
    if (err) {
        logger.error(`Error creating subscription to ${topic} topic: ${err}`);
        throw new Error(`Error creating subscription to ${topic} topic: ${err}`);
    }
    // message listener
    subscription.on('message', function(message) {
        var websiteInfo = message.attributes;
        var messageString = `websiteUrl:${websiteInfo.websiteUrl},pid:${websiteInfo.pid},crgId:${websiteInfo.crgId}`;
        logger.info(`Received ${topic} message to capture screenshot: ------ ${messageString}`);
        if (numberOfPhantoms < MAX_NUMBER_PHANTOM_INSTANCES) {
            numberOfPhantoms ++;
            return crawler.captureScreen(websiteInfo, appRoot, db)
            .then(function() {
                numberOfPhantoms --;
                logger.info(`${messageString} FINISHED crawling`);
                emitter.emit('FINISH'); 
            });
        } else {
            logger.info(`Reached maximum allowed phantom instances, save the following message and handle it later: ------ ${messageString}`);
            // Save screenshot message to redis in a LIST named `${topic}`
            return client.lpushAsync(`${topic}`, `${messageString}`);
        }
    });
    subscription.on('error', function(err) {
        var errorString;
        if (typeof err === 'string') {
            errorString = err;
        } else {
            errorString = JSON.stringify(err);
        }
        logger.error(`Error subscribing to ${topic} topic, will not be able to receive signals until this is fixed. Error message: ${errorString}`);
    });
});
