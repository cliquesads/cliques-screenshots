/* jshint node: true */
'use strict';

const path = require('path');
const appRoot = path.resolve(__dirname);
const crawler = require('./services/crawler.js');

crawler.captureScreen('http://www.baidu.com', appRoot);