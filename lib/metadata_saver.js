var logger = require('./logger');
var db = require('./connections').EXCHANGE_CONNECTION;
var models = require('@cliques/cliques-node-utils').mongodb.models;
var promise = require('bluebird');

function saveScreenshotMetaData(screenshotMetaData) {
    var screenshotModels = new models.ScreenshotModels(db);
    var screenshot = new screenshotModels.Screenshot(screenshotMetaData);
    screenshot.save = promise.promisify(screenshot.save);
    return screenshot.save()
        .catch(function(err) {
            logger.error('Error trying to save screenshot metadata into mongodb');
            logger.error(err);
        });
}

module.exports = {
    saveScreenshotMetaData: saveScreenshotMetaData
};
