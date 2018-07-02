var app = require('express')();
var http = require('http').Server(app);
var bodyParser = require('body-parser');
var db = require('../database/db');
var logger = require('../utils/logger')('alway-online-api');
var response = require('../utils/response');
var util = require('../utils/util');

// express
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use('/user/', function(req, res, next) {
  var uid = req.query['uid'];
  var token = req.query['token'];
  if (uid && token) {
    db.admin.findOne({uid: uid}, function(err, ret) {
      if (!err && ret && ret.token == token) {
        next();
      } else {
        res.send(response.makeResponse(response.permission));
      }
    });

    logger.info('method=%s, path=/user%s, params=%s', req.method, req.path, JSON.stringify(req.query), req.body);
  } else {
    res.send(response.makeResponse(response.permission));
  }
});

app.post('/user/create_token', function(req, res) {
  var account = req.body;
  if (account && account.uid) {
    db.user.findOne({uid: account.uid}, function(err, ret) {
      if (err) {
        logger.error('user/create_token query failed: ', err);
        res.send(response.makeResponse(response.operationFailed, {uid: account.uid}));
      } else {
        if (ret) {
          res.send(response.makeResponse(response.userExists));
        } else {
          var randomToken = util.genRandString();
          var ts = parseInt(Date.now() / 1000);
          db.user.create({uid: account.uid, token: randomToken, createTime: ts, updateTime: ts}, function(err) {
            if (err) {
              logger.error('user/create_token create failed: ', err);
              res.send(response.makeResponse(response.operationFailed, {uid: account.uid}));
            } else {
              res.send(response.makeResponse(response.ok, {uid: account.uid, token: randomToken}))
            }
          });
        }
      }
    });
  } else {
    res.send(response.makeResponse(response.paramError));
  }
});

app.post('/user/refresh_token', function(req, res) {
  var account = req.body;
  logger.info(account);
  if (account && account.uid) {
    db.user.findOne({uid: account.uid}, function(err, ret) {
      if (err) {
        logger.error('user/refresh_token query failed: ', err);
        res.send(response.makeResponse(response.operationFailed, {uid: account.uid}));
      } else {
        if (ret) {
          var randomToken = util.genRandString();
          var ts = parseInt(Date.now() / 1000);
          db.user.update({uid: account.uid}, {$set: {token: randomToken, updateTime: ts}}, function(err) {
            if (err) {
              logger.error('user/refresh_token update failed: ', err);
              res.send(response.makeResponse(response.operationFailed, {uid: account.uid}));
            } else {
              res.send(response.makeResponse(response.ok, {uid: account.uid, token: randomToken}))
            }
          });
        } else {
          res.send(response.makeResponse(response.userNotExists, {uid: account.uid}));
        }
      }
    });
  } else {
    res.send(response.makeResponse(response.paramError));
  }
});

http.listen(4000, function(){
  logger.info('listening on *:4000');
});