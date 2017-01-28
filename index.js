/* jshint node: true */
'use strict';

var node_utils = require('@cliques/cliques-node-utils'),
    ScreenshotPubSub = node_utils.google.pubsub.ScreenshotPubSub;
var logger = require('./lib/logger');

/* ---------------- SCREENSHOT PUBSUB INSTANCE & LISTENERS ----------------- */

// Here's where the Controller methods actually get hooked to signals from
// the outside world via Google PubSub api.

if (process.env.NODE_ENV == 'local-test') {
    var pubsub_options = {
        projectId: 'mimetic-codex-781',
        test: true
    }
} else {
    pubsub_options = { projectId: 'mimetic-codex-781' };
}
var screenshotPubSub = new ScreenshotPubSub(pubsub_options);

const path = require('path');
const appRoot = path.resolve(__dirname);
const crawler = require('./services/crawler.js');

screenshotPubSub.subscriptions.captureScreenshot(function(err, subscription) {
	if (err) throw new Error('Error creating subscription to captureScreenshot topic: ' + err);
	// message listener
	subscription.on('message', function(message) {
		var websiteURL = message.data;
		crawler.captureScreen(websiteURL, appRoot);
		logger.info('Received captureScreenshot message for website: ' + websiteURL);
	});
	subscription.on('error', function(err) {
		logger.error('Error subscribing to captureScreenshot topic, will not be able to receive signals until this is fixed');	
		logger.error(err);
	});
});
