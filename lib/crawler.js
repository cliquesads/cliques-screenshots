/* jshint node: true */
'use strict';

// first-party packages
var node_utils = require('@cliques/cliques-node-utils');
var tags = node_utils.tags;
var phantom = require('phantom');
var config = require('config');
var logger = require('./logger');
var connections = require('./connections');
var db = node_utils.mongodb;
var EXCHANGE_CONNECTION = connections.EXCHANGE_CONNECTION;

/*  ------------------ MongoDB Model Sets ------------------- */
var advertiser_models = new db.models.AdvertiserModels(EXCHANGE_CONNECTION);

/**
 * Parses the content of the createScreenshot message published through Google PubSub service
 * @param {String} messageContent - the message content that contains the creativeGroupID and websiteURL, the format looks like this: crgid=${creativeGroupId}&websiteURL=${websiteURL}
 */
function parseMessageContent(messageContent) {
    var creativeGroupId = messageContent.substring(messageContent.indexOf('crgid=') + 'crgid='.length, messageContent.indexOf('&websiteURL='));
    var websiteURL = messageContent.substring(messageContent.indexOf('&websiteURL=') + '&websiteURL='.length);
    // remove the last character of URL if the last character is '/'
    var lastCharacterOfURL = websiteURL.substring(websiteURL.length - 1);
    if (lastCharacterOfURL === '/') {
        websiteURL = websiteURL.substring(0, websiteURL.length - 1);
    }
    return {
        crgid: creativeGroupId,
        websiteURL: websiteURL
    };
}

/**
 * Captures screenshot from website designated in messageContent, also the viewport of the screenshot should includes the tag template with certain creative group details.
 * @param {String} messageContent - the message content that contains the creativeGroupID and websiteURL, the format looks like this: crgid=${creativeGroupId}&websiteURL=${websiteURL}
 * @param {String} appRoot - the app root folder path
 */
function captureScreen(messageContent, appRoot) {
    var phantomInstance = null;
    var screenshotImageFolder = config.get('Screenshots.screenshotImageFolder');
    var clipWidth = config.get('Screenshots.clipWidth');
    var clipHeight = config.get('Screenshots.clipHeight');

    var captureScreenInfo = parseMessageContent(messageContent);

    // make the db call to get creative group details
    return advertiser_models.getNestedObjectById(captureScreenInfo.crgid, 'CreativeGroup', function(err, obj) {
        if (err) {
            logger.error('Error trying to query creativeGroup from DB: ' + err);
            return;
        }
        var ADSERVER_HOST = config.get('AdServer.http.external.hostname');
        var ADSERVER_SECURE_HOST = config.get('AdServer.https.external.hostname');
        var ADSERVER_PORT = config.get('AdServer.http.external.port');
        var tag = new tags.ImpTag(ADSERVER_HOST, {
            port: ADSERVER_PORT,
            secure_hostname: ADSERVER_SECURE_HOST,
            // TO-DO:::ycx should not be hard coded!
            secure: true
        });
        var tagTemplate = tag.render(obj);

        return phantom.create([
                '--ignore-ssl-errors=yes',
                '--load-images=yes'
            ])
            .then(function(instance) {
                phantomInstance = instance;
                return instance.createPage();
            })
            .then(function(page) {
                return page.property('viewportSize', {
                        width: clipWidth,
                        height: clipHeight,
                    })
                    .then(page.property('clipRect', {
                        top: 200,
                        left: 0,
                        width: clipWidth,
                        height: clipHeight,
                    }))
                    .then(function() {
                        return page.open(captureScreenInfo.websiteURL);
                    })
                    .then(function(status) {
                        if (status !== 'success') {
                            logger.error(`Error trying to open ${captureScreenInfo.websiteURL} with phantomjs`);
                            return phantomInstance.exit();
                        }
                        // Evaluate page to get iframe position
                        return page.evaluate(function() {
                            // TO-DO:::ycx should use tagTemplate to evaluate DOM
                            return document.getElementsByTagName('iframe')[0].getBoundingClientRect();
                        });
                    })
                    .then(function(iframePositionRect) {
                        var clipRectTop = 0;
                        if (iframePositionRect.top + iframePositionRect.height > clipHeight) {
                            clipRectTop = iframePositionRect.top + iframePositionRect.height - clipHeight;
                        }
                        return page.property('clipRect', {
                            top: clipRectTop,
                            left: 0,
                            width: clipWidth,
                            height: clipHeight,
                        });
                    })
                    .then(function() {
                        var screenshotFileName = captureScreenInfo.websiteURL.replace('http://', '').replace('https://', '');
                        page.render(appRoot + '/' + screenshotImageFolder + '/' + screenshotFileName + '.png');
                        return phantomInstance.exit();
                    });
            })
            .catch(function(err) {
                logger.error('Error scraping screenshot from: ' + captureScreenInfo.websiteURL);
                logger.error(err);
                return phantomInstance.exit();
            });
    });
}

module.exports = {
    captureScreen: captureScreen
};
