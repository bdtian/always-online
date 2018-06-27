var mongoose = require('mongoose');
var logger = require('../utils/logger')('always-online-db');

const options = {
	keepAlive: 1,
  reconnectTries: Number.MAX_VALUE, // Never stop trying to reconnect
  reconnectInterval: 3000, // Reconnect every 500ms
  poolSize: 10, // Maintain up to 10 socket connections
  // If not connected, return errors immediately rather than waiting for reconnect
  bufferMaxEntries: 0
};

var db = mongoose.createConnection('mongodb://localhost/account', options).on('error', 
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
	uid: String,
	token: String
});

var adminSchema = new Schema({
	uid: String,
	token: String
});

exports.user = db.model('user', userSchema);
exports.admin = db.model('admin', adminSchema);