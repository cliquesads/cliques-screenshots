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

exports.ScreenshotsCLogger = ScreenshotsCLogger;