/* jshint node: true */
'use strict';

// first-party packages
var phantom = require('phantom');
var config = require('config');
var logger = require('./logger');
var uploader = require('./uploader');
var metadataSaver = require('./metadata_saver');
var models = require('@cliques/cliques-node-utils').mongodb.models;
var uuidv4 = require('uuid/v4');
var promise = require('bluebird');
var fs = require('fs');
var execSync = require('child_process').execSync;

// For current phantomjs version(2.1.x), there's a known bug 
// that sometimes phantom.exit() hangs and the phantom process never quits.
// So we need to set a timeout mechanism to manually kill the hanging phantom process
const MAX_PHANTOM_LIFETIME = 300; // 5 minutes in seconds

// Get process elapsed time in seconds given pid
function getProcessElapsedTime(pid) {
    try {
        var stdout = execSync(`ps -o etimes= -p ${pid}`);
        return parseInt(stdout);
    } catch(err) {
        // No such pid
        return -1;
    }
}
function killProcess(pid) {
    try {
        var stdout = execSync(`kill ${pid}`);
        return 0;
    } catch(err) {
        // No such pid
        return -1; 
    }
}

function protocolPrefixExistsInWebsiteUrl(websiteUrl) {
    if (websiteUrl.substring(0, 'http://'.length) !== 'http://') {
        if (websiteUrl.substring(0, 'https://'.length) !== 'https://') {
            return false;
        }
    }
    return true;
}
// Get all running phantom pids
function getAllPhantomPIDs() {
    var pids = [];
    try {
        var stdout = execSync('pgrep phantom').toString();
        var processIds = stdout.split('\n');
        for (var i = 0; i < processIds.length; i ++) {
            if (processIds[i] !== '') {
                pids.push(parseInt(processIds[i]));
            }
        }
        return pids;
    } catch(err) {
        return pids;
    }
}

function untilPhantomExists(phantomPID) {
    var allPhantomPIDS = getAllPhantomPIDs();
    if (allPhantomPIDS.indexOf(phantomPID) === -1) {
        return;
    } else {
        var phantomElapsedTime = getProcessElapsedTime(phantomPID);
        if (phantomElapsedTime === -1) {
            return;
        } else if (phantomElapsedTime >= MAX_PHANTOM_LIFETIME) {
            logger.info(`Phantom process ${phantomPID} is hanging, killing it programmatically...`);
            return killProcess(phantomPID);
        } else {
            return promise.delay(500)
            .then(function() {
                return untilPhantomExists(phantomPID);
            });
        }
    }
}

/**
 * A promisified function that check to see if asyncTest function returns true, 
 * otherwise retry after 250ms until reached max retries.
 * @param asyncTest the test function to test whether the condition satisfies
 * @param maxRetries number of max retries
 * @param errObj the error object to throw out/reject
 */
function waitUntil(asyncTest, maxRetries, errObj) {
    var numOfTries = 0;
    return new Promise(function(resolve, reject) {
        function wait() {
            numOfTries ++;
            asyncTest().then(function(value) {
                if (value === true) {
                    resolve();
                } else if (numOfTries < maxRetries) {
                    setTimeout(wait, 250);
                } else {
                    reject(errObj);
                }
            }).catch(function(e) {
                console.log('Error found. Rejecting.', e);
                reject(errObj);
            });
        }
        wait();
    });
}

/**
 * Captures screenshot from website designated in captureScreenInfo, also the viewport of the screenshot should includes the tag template with certain creative group details.
 * @param {Object} captureScreenInfo - the message content that contains the creativeGroupID(crgId), placementId(pid) and websiteUrl(websiteUrl)
 * @param {String} appRoot - the app root folder path
 */
function captureScreen(captureScreenInfo, appRoot, db) {
    logger.info(`Start to capture screenshot for this request: ------ websiteUrl: ${captureScreenInfo.websiteUrl}, pid: ${captureScreenInfo.pid}, crgId: ${captureScreenInfo.crgId}`);
    var phantomInstance = null;
    var phantomOpenPageTimeoutInSec = config.get('Screenshots.phantomOpenPageTimeoutInSec');
    var userAgentString = config.get('Screenshots.userAgent');

    var screenshotExpirationHours = config.get('Screenshots.screenshotExpirationHours');
    var screenshotImageFolder = config.get('Screenshots.screenshotImageFolder');
    var clipWidth = config.get('Screenshots.clipWidth');
    var clipHeight = config.get('Screenshots.clipHeight');
    var screenshotFileName, filePath, screenshotImageURL;

    // The phantom process id created by this function(captureScreen), when this function quits, we need to make sure such phantom process already exists
    var phantomPID;

    // Screenshot meta data
    var advertiserId, publisherId, pageId, siteId, campaignId, campaignName;
    // If placement type is `native`, the crawler search criteria is different 
    var placementType, multiPaneNativeCount;

    // First off, check if the same screenshot has been created within the last ${screenshotExpirationHours} time window. If so, DO NOT create a duplicate screenshot
    var screenshotModels = new models.ScreenshotModels(db);
    screenshotModels.Screenshot.promisifiedFind = promise.promisify(screenshotModels.Screenshot.find);
    return screenshotModels.Screenshot.promisifiedFind({
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
        var err;
        if (!values[0]) {
            err = {
                logLevel: 'error',
                message: 'Error finding creative group with _id: ' + captureScreenInfo.crgId
            };
            throw err;
        }
        if (!values[1]) {
            err = {
                logLevel: 'error',
                message: 'Error finding placement with _id: ' + captureScreenInfo.pid
            };
            throw err;
        }
        var jsonPlacement = JSON.parse(JSON.stringify(values[1]));
        if (jsonPlacement.type === 'native') {
            placementType = 'native';
        } else if (jsonPlacement.type === 'multiPaneNative') {
            placementType = 'multiPaneNative'; 
            multiPaneNativeCount = jsonPlacement.multiPaneNative.count;
        }

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
        return phantom.create([
            '--web-security=false',
            '--ignore-ssl-errors=yes',
            '--load-images=yes'
        ]);
    })
    .then(function(instance) {
        var j = getAllPhantomPIDs();
        phantomInstance = instance;
        phantomPID = phantomInstance.process.pid;
        return instance.createPage();
    })
    .then(function(page) {
        page.setting('resourceTimeout', phantomOpenPageTimeoutInSec * 1000);
        page.setting('userAgent', userAgentString);
        return page.property('onConsoleMessage', function(msg) {
            console.log(msg);
        })
        .then(function() {
            return page.property('viewportSize', {
                width: clipWidth,
                height: clipHeight,
            });
        })
        .then(function() {
            if (!protocolPrefixExistsInWebsiteUrl(captureScreenInfo.websiteUrl)) {
                captureScreenInfo.websiteUrl = 'http://' + captureScreenInfo.websiteUrl;
            }
            return page.open(captureScreenInfo.websiteUrl);
        })
        .then(function(status) {
            if (status != 'success') {
                var err = {
                    logLevel: 'error',
                    message: 'Error trying to open ' + captureScreenInfo.websiteUrl + ' with phantomjs, timed out'
                };
                throw err;
            }
            // Depending on whether the placement type is `native` or not, the page evaluating selector may be different
            if (placementType === 'native') {
                // Looking for native ad image
                var nativeImgSelector = 'img[data-cliquesnative]';
                return page.evaluate(function(nativeImgSelector) {
                    return document.querySelector(nativeImgSelector).getBoundingClientRect();
                }, nativeImgSelector);
            } else if (placementType === 'multiPaneNative') {
                var errObj = {
                    logLevel: 'error',
                    message: 'Unable to find multi-pane native ad with pid: ' + captureScreenInfo.pid + '.'
                };
                // Looking for data-cliques-multi-pane-native div wrapper
                var multiPaneSelector = 'div[data-cliques-multi-pane-native]';
                // The multi pane native ad wrapper loads asynchronously, so need to wait until it APPEARS in DOM when evaluating page
                return waitUntil(function() {
                    return page.evaluate(function(multiPaneSelector) {
                        var multiPaneWrapper = document.querySelector(multiPaneSelector);
                        return multiPaneWrapper !== null;
                    }, multiPaneSelector);
                }, 20, errObj)
                .then(function() {
                    // The multi-pane native wrapper has been loaded, yet
                    // the actual native ad loads asynchronously, so need to wait until it APPEARS inside of multiPaneNative ad wrapper
                    var nativePaneSelector = 'a[href*="pid=' + captureScreenInfo.pid + '"][href*="crgid=' + captureScreenInfo.crgId + '"]';
                    return waitUntil(function() {
                        return page.evaluate(function(nativePaneSelector) {
                            var nativePane = document.querySelector(nativePaneSelector);
                            return nativePane !== null;
                        }, nativePaneSelector);
                    }, 20, errObj);
                })
                .then(function() {
                    // link with pid and crgId has been loaded,
                    // now try to load the native images inside the pane
                    return waitUntil(function() {
                        return page.evaluate(function(multiPaneNativeCount) {
                            var nativeImgSelector = 'img[data-cliquesnative]'; 
                            var nativeImages = document.querySelectorAll(nativeImgSelector);
                            var hasImgLoaded = function(imgElement) {
                                if (imgElement) {
                                    return imgElement.complete && imgElement.naturalHeight !== 0;
                                }
                                return false;
                            };
                            if (!nativeImages) {
                                return false;
                            } else if (nativeImages < multiPaneNativeCount) {
                                return false;
                            } else {
                                // Now there're the correct number of multiPaneNative images in page,
                                // need to make sure all of the images 
                                // fully loaded before taking the screenshot
                                for (var i = 0; i < nativeImages.length; i ++) {
                                    if (!hasImgLoaded(nativeImages[i])) {
                                        return false;
                                    }
                                }
                                return true;
                            }
                        }, multiPaneNativeCount);
                    }, 20, errObj);
                })
                .then(function() {
                    return page.evaluate(function(multiPaneSelector) {
                        return document.querySelector(multiPaneSelector).getBoundingClientRect();
                    }, multiPaneSelector);
                });
            } else {
                // Evaluate page to get iframe position for NON-NATIVE placement ad
                var iframeTagSelector = 'iframe[src*="crgid=' + captureScreenInfo.crgId + '"][src*="pid=' + captureScreenInfo.pid + '"]';
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
            }
        })
        .then(function(iframePositionRect) {
            if (!iframePositionRect) {
                var err;
                if (placementType === 'native') {
                    // The native ad image not found on this webpage
                    err = {
                        logLevel: 'error',
                        message: 'Unable to find native ad with crgId: ' + captureScreenInfo.crgId + ' and pid: ' + captureScreenInfo.pid + '.'
                    };
                } else if (placementType === 'multiPaneNative') {
                    err = {
                        logLevel: 'error',
                        message: 'Unable to find multi-pane native ad with pid: ' + captureScreenInfo.pid + '.'
                    };
                } else {
                    // The iframe imp_tag not found on this webpage
                    err = {
                        logLevel: 'error',
                        message: 'Unable to find cliques iframe tag with crgId: ' + captureScreenInfo.crgId + ' and pid: ' + captureScreenInfo.pid + '.'
                    };
                }
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
            screenshotFileName = uuidv4() + '-' + new Date().getTime();
            filePath = appRoot + '/' + screenshotImageFolder + '/' + screenshotFileName + '.png';
            return page.render(filePath);
        })
        .then(function() {
            phantomInstance.exit();
            logger.info(`SUCCESS. Phantom PID: ${phantomPID}. Captured screenshot for this request: ------ websiteUrl: ${captureScreenInfo.websiteUrl}, pid: ${captureScreenInfo.pid}, crgId: ${captureScreenInfo.crgId}. Uploading to Google Cloud Storage...`);
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
            logger.info(`SUCCESS. Phantom PID: ${phantomPID} Now saving screenshot metadata to MongoDB for this request: ------ websiteUrl: ${captureScreenInfo.websiteUrl}, pid: ${captureScreenInfo.pid}, crgId: ${captureScreenInfo.crgId}`);
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
        })
        .then(function() {
            // Screenshot image file already uploaded, so can be removed from local disk
            fs.unlinkSync(filePath);
            // make sure the created phantom instance no longer exists before return this promise
            logger.info(`Screenshot capturing finished SUCCESSFULLY, waiting for phantom instance ${phantomPID} to exit`);
            return untilPhantomExists(phantomPID);
        });
    })
    .catch(function(err) {
        var errorString;
        if (typeof err === 'string') {
            errorString = err;
        } else {
            errorString = JSON.stringify(err);
        }
        if (err.logLevel && err.logLevel === 'warn') {
            logger.warn(`${err.message}. Phantom PID: ${phantomPID}`);
        } else {
            logger.error(`Error scraping the following screenshot: ------ websiteUrl: ${captureScreenInfo.websiteUrl}, pid: ${captureScreenInfo.pid}, crgId: ${captureScreenInfo.crgId}. Error message: ${errorString}. Phantom PID: ${phantomPID}`);
        }
        if (phantomInstance) {
            phantomInstance.exit();
            logger.info(`Screenshot capturing finished WITH ERROR, waiting for phantom instance ${phantomPID} to exit`);
            return untilPhantomExists(phantomPID);
        }
        return;
    });
}

module.exports = {
    captureScreen: captureScreen
};
