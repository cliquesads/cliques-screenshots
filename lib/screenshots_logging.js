var cliques_node_utils = require('@cliques/cliques-node-utils');
var logging = cliques_node_utils.logging;
var util = require('util');
var uuid = require('node-uuid');

/**
 * AdServer-specific CLogger subclass...which itself is a subclass of winston.logger
 *
 * @param options winston logger options object
 * @constructor
 */
function ScreenshotsCLogger(options){
    logging.CLogger.call(this, options);
}
util.inherits(ScreenshotsCLogger, logging.CLogger);


/**
 * Impression logger
 *
 * @param request
 * @param response
 * @param impURL
 * @param creative_group
 * @param creative
 */
ScreenshotsCLogger.prototype.impression = function(request, response, impURL, creative_group, creative){
    var imp_meta = {
        type: 'IMPRESSION',
        uuid: request.uuid,
        creative: creative.id,
        creativegroup: creative_group.id,
        campaign: creative_group.parent_campaign.id,
        advertiser: creative_group.parent_advertiser.id,
        adv_clique: creative_group.parent_campaign.clique,
        placement: impURL.pid,
        impid: impURL.impid
    };
    logger.info('Impression', imp_meta);
};

/**
 * Click logger
 *
 * @param request
 * @param response
 * @param click_url
 */
ScreenshotsCLogger.prototype.click = function(request, response, click_url){
    var click_meta = {
        type: 'CLICK',
        uuid: request.uuid,
        clickid: uuid.v4(),
        creative: click_url.cid,
        campaign: click_url.campid,
        creativegroup: click_url.crgid,
        advertiser: click_url.advid,
        placement: click_url.pid,
        redir: click_url.redir,
        impid: click_url.impid
    };
    logger.info('Click', click_meta)
};

/**
 * Action logger
 *
 * @param request
 * @param response
 * @param act_url
 */
ScreenshotsCLogger.prototype.action = function(request, response, act_url){
    var conv_meta = {
        type: 'ACTION',
        uuid: request.uuid,
        actionid: uuid.v4(),
        actionbeacon: act_url.abid,
        advertiser: act_url.advid,
        value: act_url.value
    };
    logger.info('Action', conv_meta)
};

exports.ScreenshotsCLogger = ScreenshotsCLogger;