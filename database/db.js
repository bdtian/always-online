var mongoose = require('mongoose');
var logger = require('../utils/logger')('always-online-db');
var config = require('config');
var util = require('util');

const options = {
	keepAlive: 1,
  reconnectTries: Number.MAX_VALUE, // Never stop trying to reconnect
  reconnectInterval: 500, // Reconnect every 500ms
  poolSize: 10, // Maintain up to 10 socket connections
  // If not connected, return errors immediately rather than waiting for reconnect
  bufferMaxEntries: 0
};

var connectStr = util.format(
	'mongodb://%s:%d/%s',
	config.get('mongodb.host') || 'localhost',
	config.get('mongodb.port') || 27017,
	config.get('mongodb.db') || 'account'
);

var db = mongoose.createConnection(connectStr, options).on('error',
function(err) {
	logger.error('mongodb error:', err);
}).once('open', function() {
	logger.info('mongodb opened');
});

// *   1. disconnect
// *   2. error
// *   3. exit
// *   4. listening
// *   5. message
// *   6. online


var Schema = mongoose.Schema;
var userSchema = new Schema({
	uid: {type: String, unique: true},
	token: String,
	createTime: Number,
	updateTime: Number,
});

var adminSchema = new Schema({
	uid: {type: String, unique: true},
	token: String,
	createTime: Number,
	updateTime: Number,
});

exports.user = db.model('user', userSchema);
exports.admin = db.model('admin', adminSchema);