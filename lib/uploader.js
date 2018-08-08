/* jshint node: true */
'use strict';

const logger = require('./logger'),
    auth = require('@cliques/cliques-node-utils').google.auth,
    gcloud = require('google-cloud'),
    path = require('path'),
    {promisify} = require('util'),
    config = require('config');

const AUTHFILE = path.resolve('../cliques-config/google/jwt.json'),
    PROJECT_ID = config.get('Screenshots.google.projectId'),
    BUCKET = config.get('Screenshots.google.bucket'),
    // Use non-secure URL for now, secureURL is virtual field on creative model
    BASE_URL = `http://storage.googleapis.com/${BUCKET}/`;

async function create(fileName, filePath, metadata) {
    var client = gcloud({
        projectId: PROJECT_ID,
        keyFilename: AUTHFILE
    }).storage();
    var assets_bucket = client.bucket(BUCKET);
    const object_path = encodeURIComponent(fileName);
    const options = {
        destination: object_path,
        resumable: true,
        validation: 'crc32c',
        metadata: metadata
    };
    const uploadAsync = promisify(assets_bucket.upload).bind(assets_bucket);
    return uploadAsync(filePath, options)
    .then(function(file, apiResponse) {
        makePublicAsync = promisify(file.makePublic).bind(file);
        var apiResponse = await makePublicAsync();
        apiResponse.url = BASE_URL + object_path;
        return apiResponse.url;
    })
    .catch(function(err) {
        logger.error('Error trying to upload screenshot: ' + fileName + ' to google cloud.');
        logger.error(err);
    });
}

module.exports = {
    create: create
}
