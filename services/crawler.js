/* jshint node: true */
'use strict';

const phantom = require('phantom');

var screenshotImageFolder = 'screenshots';
var clipWidth = 1024;
var clipHeight = 768;


function captureScreen(url, appRoot) {
    var phantomInstance = null;
    phantom.create([
            '--ignore-ssl-errors=yes',
            '--load-images=yes'
        ])
        .then((instance) => {
            phantomInstance = instance;
            return instance.createPage();
        })
        .then((page) => {
            return page.property('clipRect', {
                    top: 0,
                    left: 0,
                    width: clipWidth,
                    height: clipHeight,
                })
                .then(() => page.open(url))
                .then(() => {
                    var screenshotFileName = url.replace('http://', '').replace('https://', '');
                    page.render(`${appRoot}/${screenshotImageFolder}/${screenshotFileName}.png`);
                    return phantomInstance.exit();
                });
        })
        .catch((err) => {
            console.error(err);
            phantomInstance.exit();
        });
}

module.exports = {
    captureScreen
};