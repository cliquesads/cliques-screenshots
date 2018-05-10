//first-party packages
var node_utils = require('@cliques/cliques-node-utils');
var logging = require('./screenshots_logging');

//third-party packages
//have to require PMX before express to enable monitoring
var winston = require('winston');
var path = require('path');
var util = require('util');

var logfile = path.join(
    process.env['HOME'],
    'data',
    'logs',
    util.format('screenshots_%s.log',node_utils.dates.isoFormatUTCNow())
);

// Fake logger just for testing
var devNullLogger = logger = new logging.ScreenshotsCLogger({transports: []});

if (process.env.NODE_ENV != 'test'){
    // Init logger
    logger = new logging.ScreenshotsCLogger({
        transports: [
            new (winston.transports.Console)({timestamp:true}),
            new (winston.transports.File)({filename:logfile,timestamp:true})
        ]
    });
} else {
    // just for running unittests so whole HTTP log isn't written to console
    logger = devNullLogger;
}

module.exports = logger;