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
                    .then(function() {
                        return page.open(captureScreenInfo.websiteURL);
                    })
                    .then(function(status) {
                        if (status != 'success') {
                            phantomInstance.exit();
                            throw `Error trying to open ${captureScreenInfo.websiteURL} with phantomjs`;
                        }
                        // Evaluate page to get iframe position
                        return page.evaluate(function() {
                            // TO-DO:::ycx should use tagTemplate to evaluate DOM
                            var iframes = document.getElementsByTagName('iframe');
                            if (iframes.length > 0) {
                                return iframes[0].getBoundingClientRect();
                            }
                            return null;
                        });
                    })
                    .then(function(iframePositionRect) {
                        if (!iframePositionRect) {
                            // The iframe imp_tag not found on this webpage
                            throw 'Unable to find iframe tag.';
                        }
                        var clipRectTop = 0;
                        var clipRectLeft = 0;
                        // Before setting up the page clipRect property, make sure the created screenshot includes the imp iframe tag
                        if (iframePositionRect.top + iframePositionRect.height > clipHeight) {
                            clipRectTop = iframePositionRect.top + iframePositionRect.height - clipHeight;
                        }
                        if (iframePositionRect.left + iframePositionRect.width > clipWidth) {
                            clipRectLeft = iframePositionRect.left + iframePositionRect.width - clipWidth;
                        }
                        return page.property('clipRect', {
                            top: clipRectTop,
                            left: clipRectLeft,
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
