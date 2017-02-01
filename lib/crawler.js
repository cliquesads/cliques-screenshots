/* jshint node: true */
'use strict';

// first-party packages
var phantom = require('phantom');
var config = require('config');
var logger = require('./logger');

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
                    var iframeTagSelector = 'iframe[src*="' + captureScreenInfo.crgid + '"]';
                    // Evaluate page to get iframe position
                    return page.evaluate(function(iframeTagSelector) {
                        var iframeTag = document.querySelector(iframeTagSelector);
                        if (iframeTag) {
                            return iframeTag.getBoundingClientRect();
                        }
                        return null;
                    }, iframeTagSelector);
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
}

module.exports = {
    captureScreen: captureScreen
};
