/* jshint node: true */
'use strict';

var node_utils = require('@cliques/cliques-node-utils'),
    ScreenshotPubSub = node_utils.google.pubsub.ScreenshotPubSub;
var logger = require('./lib/logger');
var path = require('path');
var config = require('config');
var appRoot = path.resolve(__dirname);
var crawler = require('./lib/crawler.js');

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

screenshotPubSub.subscriptions[topic](function(err, subscription) {
    if (err) throw new Error('Error creating subscription to createScreenshot topic: ' + err);
    // message listener
    subscription.on('message', function(message) {
        var captureScreenInfo = message.attributes;
        crawler.captureScreen(captureScreenInfo, appRoot);
        logger.info(`Received createScreenshot message to scrape website: ${captureScreenInfo.websiteUrl}`);
    });
    subscription.on('error', function(err) {
        logger.error('Error subscribing to createScreenshot topic, will not be able to receive signals until this is fixed');
        logger.error(err);
    });
});
