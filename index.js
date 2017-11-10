/* jshint node: true */
'use strict';

var node_utils = require('@cliques/cliques-node-utils'),
    ScreenshotPubSub = node_utils.google.pubsub.ScreenshotPubSub;
var logger = require('./lib/logger');
var path = require('path');
var config = require('config');
var appRoot = path.resolve(__dirname);
var crawler = require('./lib/crawler.js');
var dataStore = require('./lib/dataStore.js');
var promise = require('bluebird');
var db = require('./lib/connections').EXCHANGE_CONNECTION;
var models = require('@cliques/cliques-node-utils').mongodb.models,
    screenshotModels = new models.ScreenshotModels(db);

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

var EventEmitter = require('events');
var emitter = new EventEmitter();
// `FINISH` event will be emitted when a phantom instance exists
emitter.on('FINISH', function() {
    if (dataStore.numberOfPhantoms < dataStore.MAX_NUMBER_PHANTOM_INSTANCES) {
        var fetchedMessage = null;
        var screenshotModels = new models.ScreenshotModels(db);
        screenshotModels.ScreenshotMessage.promisifiedFindOne = promise.promisify(screenshotModels.ScreenshotMessage.findOne);
        return screenshotModels.ScreenshotMessage.promisifiedFindOne()
        .then(function(message) {
            if (message) {
                fetchedMessage = message;
                // message fetched, remove from database immediately
                screenshotModels.ScreenshotMessage.promisifiedRemove = promise.promisify(screenshotModels.ScreenshotMessage.remove);
                return screenshotModels.ScreenshotMessage.promisifiedRemove(message)
                .then(function() {
                    logger.info(`Message fetched and removed: ------ ${JSON.stringify(fetchedMessage)}`);
                });
            } else {
                return;
            }
        })
        .then(function() {
            if (fetchedMessage) {
                dataStore.numberOfPhantoms ++;
                return crawler.captureScreen(fetchedMessage, appRoot, db)
                .then(function() {
                    dataStore.numberOfPhantoms --;
                    logger.info(`Finished crawling for the following message: ${JSON.stringify(fetchedMessage)}`);
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
        logger.info(`Received ${topic} message to capture screenshot: ------ websiteUrl: ${websiteInfo.websiteUrl}, pid: ${websiteInfo.pid}, crgId: ${websiteInfo.crgId}`);
        if (dataStore.numberOfPhantoms < dataStore.MAX_NUMBER_PHANTOM_INSTANCES) {
            dataStore.numberOfPhantoms ++;
            return crawler.captureScreen(websiteInfo, appRoot, db)
            .then(function() {
                dataStore.numberOfPhantoms --;
                logger.info(JSON.stringify(websiteInfo) + ' FINISHED crawling');
                emitter.emit('FINISH'); 
            });
        } else {
            logger.info(`Reached maximum allowed phantom instances, save the following message and handle it later: ------ websiteUrl: ${websiteInfo.websiteUrl}, pid: ${websiteInfo.pid}, crgId: ${websiteInfo.crgId}`);
            var screenshotModels = new models.ScreenshotModels(db);
            var newMessage = new screenshotModels.ScreenshotMessage(websiteInfo);
            newMessage.save();
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