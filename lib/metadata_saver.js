const logger = require('./logger'),
	db = require('./connections').EXCHANGE_CONNECTION,
	models = require('@cliques/cliques-node-utils').mongodb.models,
	{promisify} = require('util');

async function saveScreenshotMetaData(screenshotMetaData) {
    const screenshotModels = new models.ScreenshotModels(db);
    var screenshot = new screenshotModels.Screenshot(screenshotMetaData);
    const saveAsync = promisify(screenshot.save).bind(screenshot);
    try {
	    await saveAsync();
	} catch(err) {
        logger.error('Error trying to save screenshot metadata into mongodb');
        logger.error(err);
    }
}

module.exports = {
    saveScreenshotMetaData
};
