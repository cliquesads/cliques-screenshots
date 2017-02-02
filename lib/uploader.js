/* jshint node: true */
'use strict';

var logger = require('./logger');
var auth = require('@cliques/cliques-node-utils').google.auth,
    gcloud = require('gcloud'),
    path = require('path');


var AUTHFILE = path.resolve('../cliques-config/google/jwt.json');
var PROJECT_ID = 'mimetic-codex-781';
var BUCKET = 'cliquesads-screenshots';
// Use non-secure URL for now, secureURL is virtual field on creative model
var BASE_URL = `http://storage.googleapis.com/${BUCKET}/`;

var create = function(fileName, filePath) {
    var client = gcloud({
        projectId: PROJECT_ID,
        keyFilename: AUTHFILE
    }).storage();
    var assets_bucket = client.bucket(BUCKET);
    var object_path = fileName;
    var options = {
        destination: object_path,
        resumable: true,
        validation: 'crc32c',
        metadata: {}
    };
    assets_bucket.upload(filePath, options, function(err, file, apiResponse) {
        if (err) {
            logger.error(err);
            return;
        }
        // make file public and get public facing URL
        file.makePublic(function(err, apiResponse) {
            if (err) {
                logger.error(err);
                return;
            }
            // construct public URL of newly-uploaded asset
            // to return to client in apiResponse
            // Not sure if it's necessary to include full apiResponse
            // but it can't hurt
            apiResponse.url = BASE_URL + object_path;
            return apiResponse;
        });
    });
};

module.exports = {
    create: create
}
