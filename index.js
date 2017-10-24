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

var handleMessageLater = function() {
    if (dataStore.messagePool.length === 0) {
        // No unhandled message exists
        return;
    }
    // There are at least 1 unhandled message, check 1 sec later to see if
    // it is allowed to create phantomjs instance to capture screenshot,
    // otherwise wait for another 1 sec before check again
    setTimeout(function() {
        if (dataStore.numberOfRunningPhantomInstances < dataStore.MAX_NUMBER_PHANTOM_INSTANCES) {
            var earliestMessageInPool = dataStore.messagePool.shift();
    	    logger.info('Number of phantom instances: ' + dataStore.numberOfRunningPhantomInstances);
            dataStore.numberOfRunningPhantomInstances ++;
            return crawler.captureScreen(earliestMessageInPool.attributes, appRoot)
            .then(function() {
                dataStore.numberOfRunningPhantomInstances --;
            });
        } else {
            handleMessageLater();
        }
    }, 1000);
};

screenshotPubSub.subscriptions[topic](function(err, subscription) {
    if (err) throw new Error('Error creating subscription to ' + topic + ' topic: ' + err);
    // message listener
    subscription.on('message', function(message) {
        var captureScreenInfo = message.attributes;
        logger.info(`Received ${topic} message to scrape website: ${captureScreenInfo.websiteUrl}, pid: ${captureScreenInfo.pid}, crgId: ${captureScreenInfo.crgId}`);
        if (dataStore.numberOfRunningPhantomInstances < dataStore.MAX_NUMBER_PHANTOM_INSTANCES) {
    	    logger.info('Number of phantom instances: ' + dataStore.numberOfRunningPhantomInstances);
            dataStore.numberOfRunningPhantomInstances ++;
            return crawler.captureScreen(captureScreenInfo, appRoot)
            .then(function() {
                dataStore.numberOfRunningPhantomInstances --;
            });
        } else {
            logger.info('Reached maximum allowed phantom instances, save message and handle it later');
            dataStore.messagePool.push(message);
        }
    });
    subscription.on('error', function(err) {
        logger.error('Error subscribing to ' + topic + ' topic, will not be able to receive signals until this is fixed');
        logger.error(err);
    });
});
