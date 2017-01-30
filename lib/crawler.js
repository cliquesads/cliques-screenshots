/* jshint node: true */
'use strict';

var phantom = require('phantom');
var config = require('config');
var logger = require('./logger');

function captureScreen(url, appRoot) {
    var phantomInstance = null;
    var screenshotImageFolder = config.get('Screenshots.screenshotImageFolder');
    var clipWidth = config.get('Screenshots.clipWidth');
    var clipHeight = config.get('Screenshots.clipHeight');

    phantom.create([
            '--ignore-ssl-errors=yes',
            '--load-images=yes'
        ])
        .then(function(instance) {
            phantomInstance = instance;
            return instance.createPage();
        })
        .then(function(page) {
            return page.property('clipRect', {
                    top: 0,
                    left: 0,
                    width: clipWidth,
                    height: clipHeight,
                })
                .then(function() {
                    return page.open(url);
                })
                .then(function() {
                    var screenshotFileName = url.replace('http://', '').replace('https://', '');
                    page.render(appRoot + '/' + screenshotImageFolder + '/' + screenshotFileName + '.png');
                    return phantomInstance.exit();
                });
        })
        .catch(function(err) {
            logger.error('Error scraping screenshot from: ' + url);
            logger.error(err);
            phantomInstance.exit();
        });
}

module.exports = {
    captureScreen: captureScreen
};
