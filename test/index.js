var app = require('express')();
var logger = require('../utils/logger')('always-online-test');

app.get('/', function(req, res) {
  logger.info('dir:', __dirname);
  res.sendFile(__dirname + '/index.html');
});

var http = require('http').Server(app);
http.listen(5000, function(){
  logger.info('listening on *:5000');
});
