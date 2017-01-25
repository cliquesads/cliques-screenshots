/* jshint node: true */
'use strict';

const phantom = require('phantom');
const promise = require('bluebird');
const constants = require('./config/constants.js');

var phantomInstance = null;
var urls = [
    'http://www.baidu.com',
    'http://www.sohu.com',
];
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
                width: constants.clipWidth,
                height: constants.clipHeight,
            })
            .then(() => {
                return promise.each(urls, (url) => {
                        return page.open(url)
                            .then(() => {
                                var screenshotFileName = url.replace('http://', '').replace('https://', '');
                                page.render(`${constants.screenshotImageFolder}/${screenshotFileName}.png`);
                            });
                    })
                    .then(() => {
                        return phantomInstance.exit();
                    });
            });
    })
    .catch((err) => {
        console.error(err);
        phantomInstance.exit();
    });
