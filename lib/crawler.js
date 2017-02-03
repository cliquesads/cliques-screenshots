/* jshint node: true */
'use strict';

// first-party packages
var phantom = require('phantom');
var config = require('config');
var logger = require('./logger');
var uploader = require('./uploader');
var metadataSaver = require('./metadata_saver');

/**
 * Captures screenshot from website designated in captureScreenInfo, also the viewport of the screenshot should includes the tag template with certain creative group details.
 * @param {Object} captureScreenInfo - the message content that contains the creativeGroupID(crgid), placementId(pid) and websiteURL(websiteURL)
 * @param {String} appRoot - the app root folder path
 */
function captureScreen(captureScreenInfo, appRoot) {
    var phantomInstance = null;
    var screenshotImageFolder = config.get('Screenshots.screenshotImageFolder');
    var clipWidth = config.get('Screenshots.clipWidth');
    var clipHeight = config.get('Screenshots.clipHeight');
    var screenshotFileName, filePath;

    return phantom.create([
            '--ignore-ssl-errors=yes',
            '--load-images=yes'
        ])
        .then(function(instance) {
            phantomInstance = instance;
            console.log('1');
            return instance.createPage();
        })
        .then(function(page) {
            return page.property('viewportSize', {
                    width: clipWidth,
                    height: clipHeight,
                })
                .then(function() {
                    console.log('2');
                    return page.open(captureScreenInfo.websiteURL);
                })
                .then(function(status) {
                    if (status != 'success') {
                        phantomInstance.exit();
                        console.log('3');
                        throw `Error trying to open ${captureScreenInfo.websiteURL} with phantomjs`;
                    }
                    console.log('4');
                    // Evaluate page to get iframe position
                    var iframeTagSelector = `iframe[src*="crgid=${captureScreenInfo.crgid}&pid=${captureScreenInfo.pid}"]`;
                    return page.evaluate(function(iframeTagSelector) {
                        var iframeTag = document.querySelector(iframeTagSelector);
                        if (iframeTag) {
                            return iframeTag.getBoundingClientRect();
                        }
                        return null;
                    }, iframeTagSelector);
                })
                .then(function(iframePositionRect) {
                    console.log('5');
                    if (!iframePositionRect) {
                        // The iframe imp_tag not found on this webpage
                        console.log('6');
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
                    console.log('7');
                    return page.property('clipRect', {
                        top: clipRectTop,
                        left: clipRectLeft,
                        width: clipWidth,
                        height: clipHeight,
                    });
                })
                .then(function() {
                    console.log('8');
                    screenshotFileName = captureScreenInfo.websiteURL.replace('http://', '').replace('https://', '');
                    filePath = `${appRoot}/${screenshotImageFolder}/${screenshotFileName}.png`;
                    return page.render(filePath);
                })
                .then(function() {
                    phantomInstance.exit();
                    console.log('9');
                    // upload the screenshot image to google cloud
                    return uploader.create(screenshotFileName, filePath);
                })
                .then(function(imageURL) {
                    console.log('10');
                    // save screenshot image metadata into mongodb
                    return metadataSaver.saveScreenshotMetaData({
                        tstamp: new Date(),
                        h: clipHeight,
                        w: clipWidth,
                        url: captureScreenInfo.websiteURL,
                        image_url: imageURL,
                        placement: captureScreenInfo.pid,
                        creativegroup: captureScreenInfo.crgid
                    });
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
