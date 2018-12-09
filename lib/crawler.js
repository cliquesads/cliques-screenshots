/* jshint node: true */
'use strict';

// first-party packages
const config = require('config'),
	logger = require('./logger'),
	uploader = require('./uploader'),
	metadataSaver = require('./metadata_saver'),
	models = require('@cliques/cliques-node-utils').mongodb.models,
	uuidv4 = require('uuid/v4'),
	{promisify} = require('util'),
	fs = require('fs');

const screenshotExpirationHours = config.get('Screenshots.screenshotExpirationHours'),
	screenshotImageFolder = config.get('Screenshots.screenshotImageFolder'),
	clipWidth = config.get('Screenshots.clipWidth'),
	clipHeight = config.get('Screenshots.clipHeight');

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
 * @param {db} db - the db connection
 * @param {chromiumBrowser} - the chromium instance used by puppeteer
 */
async function captureScreen(captureScreenInfo, appRoot, db, puppeteerPage) {
	logger.info(`Start to capture screenshot for this request: ------ websiteUrl: ${captureScreenInfo.websiteUrl}, pid: ${captureScreenInfo.pid}, crgId: ${captureScreenInfo.crgId}`);
	// Screenshot meta data
	var advertiserId, publisherId, pageId, siteId, campaignId, campaignName;
	// If placement type is `native`, the crawler search criteria is different 
	var placementType, multiPaneNativeCount;
	try {
		// First off, check if the same screenshot has been created 
		// within the last ${screenshotExpirationHours} time window. 
		// If so, DO NOT create a duplicate screenshot
		const screenshotModels = new models.ScreenshotModels(db);
		const screenshots = await screenshotModels.Screenshot.find({
			placement: captureScreenInfo.pid,
			creativegroup: captureScreenInfo.crgId		
		});
		if (screenshots && screenshots.length > 0) {
			const screenshotCreatedTime = new Date(screenshots[0].tstamp);
			const screenshotExpirationHoursAgo = new Date();
			screenshotExpirationHoursAgo.setHours(screenshotExpirationHoursAgo.getHours() - screenshotExpirationHours);
			if (screenshotExpirationHoursAgo < screenshotCreatedTime) {
			    // Such screenshot already exists and has NOT expired yet
			    throw {
			        logLevel: 'warn',
			        message: `Screenshot for ${captureScreenInfo.websiteUrl} with creativeGroupID: ${captureScreenInfo.crgId} and placementId: ${captureScreenInfo.pid} has been created recently.`

			    };
			}
		}
		// Get parent advertiser model and parent publisher model based on crgid and pid
		var advertiserModels = new models.AdvertiserModels(db);
		advertiserModels.getNestedObjectById = promisify(advertiserModels.getNestedObjectById);
		var publisherModels = new models.PublisherModels(db);
		publisherModels.getNestedObjectById = promisify(publisherModels.getNestedObjectById);
	    const creativeGroup = await advertiserModels.getNestedObjectById(captureScreenInfo.crgId, 'CreativeGroup');
		const placement = await publisherModels.getNestedObjectById(captureScreenInfo.pid, 'Placement');
		if (!creativeGroup) {
			throw {
			    logLevel: 'error',
			    message: `Error finding creative group with _id: ${captureScreenInfo.crgId}`
			};
		}
		if (!placement) {
			throw {
			    logLevel: 'error',
			    message: `Error finding placement with _id: ${captureScreenInfo.pid}`
			};
		}
		const jsonPlacement = JSON.parse(JSON.stringify(placement));
		if (jsonPlacement.type === 'native') {
			placementType = 'native';
		} else if (jsonPlacement.type === 'multiPaneNative') {
			placementType = 'multiPaneNative';
			multiPaneNativeCount = jsonPlacement.multiPaneNative.count.desktop;
		}
		const parentAdvertiser = creativeGroup.parent_advertiser,
			parentCampaign = creativeGroup.parent_campaign,
			parentPublisher = placement.parent_publisher,
			parentPage = placement.parent_page,
			parentSite = placement.parent_site;

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

		if (!protocolPrefixExistsInWebsiteUrl(captureScreenInfo.websiteUrl)) {
		    captureScreenInfo.websiteUrl = `http://${captureScreenInfo.websiteUrl}`;
		}
		// load page and wait until it FULLY loaded, 
		// `networkidle0` option means consider navigation to be finished when there are no more than 0 network connections for at least 500 ms.
		await puppeteerPage.goto(captureScreenInfo.websiteUrl, {
			waitUntil: 'networkidle0'
		});
		// TO-DO::: For cliques content inside iframe or embedded iframe, 
		// also need to wait until the iframe is fully loaded

		// find out the bounding client rectange that contains the cliques ad images
		const clipRect = await puppeteerPage.evaluate((placementType) => {
			// For smartertravel.com, need to close the popup since it covers up the native images
			var closeButton = document.querySelector('div.closePopup');
			if (closeButton) {
				closeButton.click();
			}
			var rect;
			if (placementType === 'native') {
				const cliquesImage = document.querySelector('img[data-cliquesnative]');	
				if (!cliquesImage) {
					return undefined;
				}
				rect = cliquesImage.getBoundingClientRect();
			} else if (placementType === 'multiPaneNative') {
				// selector `div#cliques-widget` is for smartertravel.com
				var cliquesWidget = document.querySelector('div#cliques-widget');
				if (!cliquesWidget) {
					// selector `div.cliques-widget` is for all other websites
					cliquesWidget = document.querySelector('div.cliques-widget');
				}
				if (!cliquesWidget) {
					cliquesWidget = document.querySelector('div[data-cliques-multi-pane-native]');
				}
				if (!cliquesWidget) {
					return undefined;
				}
				rect = cliquesWidget.getBoundingClientRect();
			} else {
				const cliquesIframe = document.querySelector(`iframe[src*="crgid='${captureScreenInfo.crgId}'"][src*="pid='${captureScreenInfo.pid}'"]`);
				if (!cliquesIframe) {
					return undefined;
				}
				rect = cliquesIframe.getBoundingClientRect();
			}
			return {
				top: rect.y,
				left: rect.x,
				width: rect.width,
				height: rect.height
			};
		}, placementType);
		if (!clipRect) {
			// bounding client rect NOT found, throw err
			if (placementType === 'native') {
			    // The native ad image not found on this webpage
			    throw {
			        logLevel: 'error',
			        message: `Unable to find native ad with crgId: ${captureScreenInfo.crgId} and pid: ${captureScreenInfo.pid}.`

			    };
			} else if (placementType === 'multiPaneNative') {
			    throw {
			        logLevel: 'error',
			        message: `Unable to find multi-pane native ad with pid: ${captureScreenInfo.pid}.`
			    };
			} else {
			    // The iframe imp_tag not found on this webpage
			    throw {
			        logLevel: 'error',
			        message: `Unable to find cliques iframe tag with crgId: ${captureScreenInfo.crgId} and pid: ${captureScreenInfo.pid}.`
			    };
			}
		}
		// Start to capture screenshot
		var topOffset = 0;
		var leftOffset = 0;
		// Before setting up the page clipRect property, make sure the created screenshot includes the imp iframe tag or the native image(s)
		if (clipRect.top + clipRect.height > clipHeight) {
		    topOffset = clipRect.top + clipRect.height - clipHeight;
		}
		if (clipRect.left + clipRect.width > clipWidth) {
		    leftOffset = clipRect.left + clipRect.width - clipWidth;
		}
		const screenshotFileName = `${uuidv4()}-${new Date().getTime()}`;
		const filePath = `${appRoot}/${screenshotImageFolder}/${screenshotFileName}.png`;
		await puppeteerPage.evaluate(() => window.scrollBy(0, window.innherHeight));

		await puppeteerPage.waitFor((multiPaneNativeCount) => {
			var cliquesImages = [];
			if (multiPaneNativeCount > 1) {
				cliquesImages = document.querySelectorAll('img[data-cliquesnative]');
			} else {
				const img = document.querySelector('img[data-cliquesnative]');
				cliquesImages.push(img);
			}
			if (cliquesImages.length === 0) {
				return false;
			}
			for (var i = 0; i < cliquesImages.length; i ++) {
				if (!cliquesImages[i].complete) {
					return false;
				}
				if (cliquesImages[i].naturalWidth === 0) {
					return false;
				}
			}
			return true;
		}, {timeout: 60000}, multiPaneNativeCount);
		await puppeteerPage.screenshot({
			path: filePath,
			clip: {
				x: leftOffset,
				y: topOffset,
				width: clipWidth,
				height: clipHeight
			}
		});
		logger.info(`SUCCESS. Captured screenshot for this request: ------ websiteUrl: ${captureScreenInfo.websiteUrl}, pid: ${captureScreenInfo.pid}, crgId: ${captureScreenInfo.crgId}. Uploading to Google Cloud Storage...`);

		// upload the screenshot image to google cloud
		const screenshotImageURL = await uploader.create(screenshotFileName, filePath, {
			h: clipHeight,
			w: clipWidth,
			placement: captureScreenInfo.pid,
			creativegroup: captureScreenInfo.crgId,
			url: captureScreenInfo.websiteUrl
		});
		// save screenshot image metadata into mongodb
		logger.info(`SUCCESS. Screenshot uploaded. Now saving screenshot metadata to MongoDB for this request: ------ websiteUrl: ${captureScreenInfo.websiteUrl}, pid: ${captureScreenInfo.pid}, crgId: ${captureScreenInfo.crgId}`);
		await metadataSaver.saveScreenshotMetaData({
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
		fs.unlinkSync(filePath);
		logger.info(`Screenshot capturing finished SUCCESSFULLY!`);
	} catch (err) {
		if (err.logLevel) {
			if (err.logLevel === 'warn') {
				logger.warn(`${err.message}`);
			} else {
				logger.error(`Error scraping the following screenshot: ------ websiteUrl: ${captureScreenInfo.websiteUrl}, pid: ${captureScreenInfo.pid}, crgId: ${captureScreenInfo.crgId}. Error message: ${err.message}.`);
			}
		} else {
			logger.error(err);
		}
	}
}

module.exports = {
	captureScreen
};
