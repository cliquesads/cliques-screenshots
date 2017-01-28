/* jshint node: true */
'use strict';

const phantom = require('phantom');
const config = require('config');

function captureScreen(url, appRoot) {
    var phantomInstance = null;
    var screenshotImageFolder = config.get('Screenshots.screenshotImageFolder');
    var clipWidth = config.get('Screenshots.clipWidth');
    var clipHeight = config.get('Screenshots.clipHeight');

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