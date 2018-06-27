var express = require('express'); 
var app = express();
var logger = require('../utils/logger')('always-online-test');

app.use(express.static(__dirname + '/whiteboard'));

app.get('/test', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});

var http = require('http').Server(app);
http.listen(5000, function(){
  logger.info('listening on *:5000');
});
