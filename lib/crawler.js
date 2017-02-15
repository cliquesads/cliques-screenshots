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
    var screenshotFileName, filePath, screenshotImageURL;

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
                        var allIframes = [];
                        // Traverse all iframes using depth first search
                        var traverseIframe = function(node, allIframes) {
                            var notFound = false;
                            var selfDocument;
                            if (node == document) {
                                selfDocument = document;
                            } else {
                                selfDocument = node.contentDocument;
                            }
                            var expectedIframe = selfDocument.querySelector(iframeTagSelector);
                            if (!expectedIframe) {
                                // No expected iframe found, query its child iframes recursively
                                var iframes = selfDocument.getElementsByTagName('iframe');
                                if (iframes.length > 0) {
                                    for (var i = 0; i < iframes.length; i++) {
                                        // parent iframe is also saved since it is the root iframe rect position that we want
                                        allIframes.push({
                                            selfIframe: iframes[i],
                                            parentIframe: node == document ? null : node,
                                            isExpected: false
                                        });
                                        if (traverseIframe(iframes[i], allIframes)) {
                                            break;
                                        }
                                    }
                                }
                                return notFound;
                            } else {
                                // Expected iframe found
                                allIframes.push({
                                    selfIframe: expectedIframe,
                                    parentIframe: node == document ? null : node,
                                    isExpected: true
                                });
                                return !notFound;
                            }
                        };
                        // Invoke the recursive function to search for the expected iframe
                        traverseIframe(document, allIframes);
                        var expectedIframeInfo;
                        for (var j = 0; j < allIframes.length; j++) {
                            if (allIframes[j].isExpected) {
                                expectedIframeInfo = allIframes[j];
                            }
                        }
                        if (!expectedIframeInfo) {
                            return null;
                        }
                        var rect;
                        if (!expectedIframeInfo.parentIframe) {
                            // The expected iframe is right under window.document
                            return expectedIframeInfo.selfIframe.getBoundingClientRect();
                        } else {
                            var getParent = function(iframe, allIframes) {
                                for (var k = 0; k < allIframes.length; k++) {
                                    if (iframe == allIframes[k].selfIframe) {
                                        return allIframes[k].parentIframe;
                                    }
                                }
                            };
                            // The expected iframe is embedded in another iframe, now find the ancestor iframe that is right under window.document
                            var containerIframe = expectedIframeInfo.parentIframe;
                            while (containerIframe) {
                                if (getParent(containerIframe, allIframes)) {
                                    containerIframe = getParent(containerIframe, allIframes);
                                } else {
                                    break;
                                }
                            }
                            return containerIframe.getBoundingClientRect();
                        }
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
                    screenshotImageURL = imageURL;
                    // save screenshot image metadata into mongodb
                    logger.info('SUCCESS. Now saving screenshot metadata to MongoDB for ' + captureScreenInfo.websiteUrl + '.');
                    // Get parent advertiser model and parent publisher model based on crgid and pid
                    var advertiserModels = new models.AdvertiserModels(db);
                    advertiserModels.getNestedObjectById = promise.promisify(advertiserModels.getNestedObjectById);
                    var publisherModels = new models.PublisherModels(db);
                    publisherModels.getNestedObjectById = promise.promisify(publisherModels.getNestedObjectById);
                    return promise.all([
                        advertiserModels.getNestedObjectById(captureScreenInfo.crgId, 'CreativeGroup'),
                        publisherModels.getNestedObjectById(captureScreenInfo.pid, 'Placement')
                    ]);
                })
                .then(function(values) {
                    var advertiserId, publisherId, pageId, siteId, campaignId, campaignName;
                    var parentAdvertiser = values[0].parent_advertiser;
                    var parentCampaign = values[0].parent_campaign;
                    var parentPublisher = values[1].parent_publisher;
                    var parentPage = values[1].parent_page;
                    var parentSite = values[1].parent_site;

                    if (parentAdvertiser) {
                        advertiserId = parentAdvertiser._id;
                    }
                    if (parentCampaign) {
                        campaignId = parentCampaign._id;
                        campaignName = parentCampaign.name;
                    }
                    if (parentPublisher) {
                        publisherId = parentPublisher._id;
                    }
                    if (parentPage) {
                        pageId = parentPage._id;
                    }
                    if (parentSite) {
                        siteId = parentSite._id;
                    }
                    return metadataSaver.saveScreenshotMetaData({
                        tstamp: new Date(),
                        h: clipHeight,
                        w: clipWidth,
                        url: captureScreenInfo.websiteUrl,
                        image_url: screenshotImageURL,
                        placement: captureScreenInfo.pid,
                        creativegroup: captureScreenInfo.crgId,
                        advertiser: advertiserId,
                        publisher: publisherId,
                        page: pageId,
                        site: siteId,
                        campaign: campaignId,
                        campaignName: campaignName
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
