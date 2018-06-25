var mongoose = require('mongoose');
var db = mongoose.createConnection('mongodb://localhost/account');
var Schema = mongoose.Schema;
var userSchema = new Schema({
	uid: String,
	token: String
});
exports.user = db.model('user', userSchema);