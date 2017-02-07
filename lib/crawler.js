/* jshint node: true */
'use strict';

// first-party packages
var phantom = require('phantom');
var config = require('config');
var logger = require('./logger');
var uploader = require('./uploader');
var metadataSaver = require('./metadata_saver');
var db = require('./connections').EXCHANGE_CONNECTION;
var models = require('@cliques/cliques-node-utils').mongodb.models;

function protocolPrefixExistsInWebsiteUrl(websiteUrl) {
    if (websiteUrl.substring(0, 'http://'.length) !== 'http://') {
        if (websiteUrl.substring(0, 'https://'.length) !== 'https://') {
            return false;
        }
    }
    return true;
}

/**
 * Captures screenshot from website designated in captureScreenInfo, also the viewport of the screenshot should includes the tag template with certain creative group details.
 * @param {Object} captureScreenInfo - the message content that contains the creativeGroupID(crgId), placementId(pid) and websiteUrl(websiteUrl)
 * @param {String} appRoot - the app root folder path
 */
function captureScreen(captureScreenInfo, appRoot) {
    var phantomInstance = null;
    var phantomOpenPageTimeoutInSec = config.get('Screenshots.phantomOpenPageTimeoutInSec');
    var screenshotExpirationHours = config.get('Screenshots.screenshotExpirationHours');
    var screenshotImageFolder = config.get('Screenshots.screenshotImageFolder');
    var clipWidth = config.get('Screenshots.clipWidth');
    var clipHeight = config.get('Screenshots.clipHeight');
    var screenshotFileName, filePath;

    // First off, check if the same screenshot has been created within the last ${screenshotExpirationHours} time window. If so, DO NOT create a duplicate screenshot
    var screenshotModels = new models.ScreenshotModels(db);
    var promise = require('bluebird');
    screenshotModels.Screenshot.promisifiedFind = promise.promisify(screenshotModels.Screenshot.find);
    return screenshotModels.Screenshot.promisifiedFind({
            url: captureScreenInfo.websiteUrl,
            placement: captureScreenInfo.pid,
            creativegroup: captureScreenInfo.crgId
        })
        .then(function(screenshots) {
            if (screenshots) {
                if (screenshots.length > 0) {
                    var screenshotCreatedTime = new Date(screenshots[0].tstamp);
                    var screenshotExpirationHoursAgo = new Date();
                    screenshotExpirationHoursAgo.setHours(screenshotExpirationHoursAgo.getHours() - screenshotExpirationHours);

                    if (screenshotExpirationHoursAgo < screenshotCreatedTime) {
                        // Such screenshot already exists and has NOT expired yet
                        var err = {
                            logLevel: 'warn',
                            message: 'Screenshot for ' + captureScreenInfo.websiteUrl + ' with creativeGroupID: ' + captureScreenInfo.crgId + ' and placementId: ' + captureScreenInfo.pid + ' has been created recently.'
                        };
                        throw err;
                    }
                }
            }
            return phantom.create([
                '--web-security=false',
                '--ignore-ssl-errors=yes',
                '--load-images=yes'
            ]);
        })
        .then(function(instance) {
            phantomInstance = instance;
            return instance.createPage();
        })
        .then(function(page) {
            page.setting('resourceTimeout', phantomOpenPageTimeoutInSec * 1000);
            return page.property('viewportSize', {
                    width: clipWidth,
                    height: clipHeight,
                })
                .then(function() {
                    if (!protocolPrefixExistsInWebsiteUrl(captureScreenInfo.websiteUrl)) {
                        captureScreenInfo.websiteUrl = 'http://' + captureScreenInfo.websiteUrl;
                    }
                    return page.open(captureScreenInfo.websiteUrl);
                })
                .then(function(status) {
                    if (status != 'success') {
                        phantomInstance.exit();
                        var err = {
                            logLevel: 'error',
                            message: 'Error trying to open ' + captureScreenInfo.websiteUrl + ' with phantomjs, timed out'
                        };
                        throw err;
                    }
                    // Evaluate page to get iframe position
                    var iframeTagSelector = 'iframe[src*="crgid=' + captureScreenInfo.crgId + '&pid=' + captureScreenInfo.pid + '"]';
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
                        var err = {
                            logLevel: 'error',
                            message: 'Unable to find cliques iframe tag with crgId: ' + captureScreenInfo.crgId + ' and pid: ' + captureScreenInfo.pid + '.'
                        };
                        throw err;
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
                    screenshotFileName = captureScreenInfo.websiteUrl.replace('http://', '').replace('https://', '') + new Date().getTime();
                    filePath = appRoot + '/' + screenshotImageFolder + '/' + screenshotFileName + '.png';
                    return page.render(filePath);
                })
                .then(function() {
                    phantomInstance.exit();
                    logger.info('SUCCESS. Captured screenshot for ' + captureScreenInfo.websiteUrl + ', uploading to Google Cloud Storage...');
                    // upload the screenshot image to google cloud
                    return uploader.create(screenshotFileName, filePath, {
                        h: clipHeight,
                        w: clipWidth,
                        placement: captureScreenInfo.pid,
                        creativegroup: captureScreenInfo.crgId,
                        url: captureScreenInfo.websiteUrl
                    });
                })
                .then(function(imageURL) {
                    // save screenshot image metadata into mongodb
                    logger.info('SUCCESS. Now saving screenshot metadata to MongoDB for ' + captureScreenInfo.websiteUrl + '.');
                    return metadataSaver.saveScreenshotMetaData({
                        tstamp: new Date(),
                        h: clipHeight,
                        w: clipWidth,
                        url: captureScreenInfo.websiteUrl,
                        image_url: imageURL,
                        placement: captureScreenInfo.pid,
                        creativegroup: captureScreenInfo.crgId
                    });
                });
        })
        .catch(function(err) {
            if (err.logLevel) {
                if (err.logLevel == 'error') {
                    logger.error('Error scraping screenshot from: ' + captureScreenInfo.websiteUrl);
                    logger.error(err.message);
                } else if (err.logLevel == 'warn') {
                    logger.warn(err.message);
                }
            } else {
                logger.error('Error scraping screenshot from: ' + captureScreenInfo.websiteUrl);
                logger.error(err);
            }
            if (phantomInstance) {
                 phantomInstance.exit(); 
            }
            return;
        });
}

module.exports = {
    captureScreen: captureScreen
};
