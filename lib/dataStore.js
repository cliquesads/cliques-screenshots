/* jshint node: true */
'use strict';

/**
 * Message pool implementation, when too many messages arrived, the system cannot create
 * that many phantomjs instances all at once which could eat up server memory quicky.
 * So for those messages received but not yet handled, we save it here in an array 
 * and deal with it later when the number of concurrent running phantom instances is 
 * smaller than allowed maximum concurrent running number of phantomjs instances.
 *
 * TO-DO::: now all the data stored here, but maybe it's a better idea to put them in redis?
 */

var dataStore = {
	/**
	 * The allowed maximum number of phantomjs instances running concurrently 
	 */
	MAX_NUMBER_PHANTOM_INSTANCES: 5,
	/**
	 * The number of currently running phantomjs instances
	 */
	numberOfPhantoms: 0,
};

module.exports = dataStore;