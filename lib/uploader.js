/* jshint node: true */
'use strict';

var logger = require('./logger');
var auth = require('@cliques/cliques-node-utils').google.auth,
    gcloud = require('gcloud'),
    path = require('path'),
    config = require('config');



var AUTHFILE = path.resolve('../cliques-config/google/jwt.json');
var PROJECT_ID = config.get('Screenshots.google.projectId');
var BUCKET = config.get('Screenshots.google.bucket');

// Use non-secure URL for now, secureURL is virtual field on creative model
var BASE_URL = 'http://storage.googleapis.com/' + BUCKET + '/';

var create = function(fileName, filePath, metadata) {
    var client = gcloud({
        projectId: PROJECT_ID,
        keyFilename: AUTHFILE
    }).storage();
    var assets_bucket = client.bucket(BUCKET);
    var object_path = encodeURIComponent(fileName);
    var options = {
        destination: object_path,
        resumable: true,
        validation: 'crc32c',
        metadata: metadata
    };
    var promise = require('bluebird');
    assets_bucket.upload = promise.promisify(assets_bucket.upload);
    return assets_bucket.upload(filePath, options)
        .then(function(file, apiResponse) {
            file.makePublic = promise.promisify(file.makePublic);
            return file.makePublic();
        })
        .then(function(apiResponse) {
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
