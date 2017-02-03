//first-party packages
var node_utils = require('@cliques/cliques-node-utils');
var logger = require('./logger');
var db = node_utils.mongodb;
var util = require('util');
var config = require('config');

/* ------------------- MONGODB - EXCHANGE DB ------------------- */

// Build the connection string
var exchangeMongoURI = util.format('mongodb://%s:%s/%s',
    config.get('Screenshots.mongodb.exchange.host'),
    config.get('Screenshots.mongodb.exchange.port'),
    config.get('Screenshots.mongodb.exchange.db'));

var exchangeMongoOptions = {
    user: config.get('Screenshots.mongodb.exchange.user'),
    pass: config.get('Screenshots.mongodb.exchange.pwd'),
    auth: {authenticationDatabase: config.get('Screenshots.mongodb.exchange.db')}
};
exports.EXCHANGE_CONNECTION = db.createConnectionWrapper(exchangeMongoURI, exchangeMongoOptions, function(err, logstring){
    if (err) throw err;
    logger.info(logstring);
});