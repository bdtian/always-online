var app = require('express')();
var http = require('http').Server(app);
var bodyParser = require('body-parser');
const uuidv4 = require('uuid/v4');
var user = require('../database/db').user;
var logger = require('../utils/logger')('alway-online-api');

// express
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

var errMsg = {
  0: 'success',
  1: 'user exists',
  2: 'operation failed',
  3: 'server error',
  4: 'param error',
  5: 'user not exists'
};

app.post('/user/create_token', function(req, res) {
  var account = req.body;
  if (account && account.uid) {
    user.findOne({uid: account.uid}, function(err, ret) {
      if (err) {
        logger.error('auth/create_token query failed: ', err);
        res.send({status: 3, msg: errMsg[3], uid: account.uid});
      } else {
        if (ret) {
          res.send({status: 1, msg: errMsg[1], uid: account.uid});
        } else {
          var random_token = uuidv4();
          logger.info("token: ", random_token);
          user.create({uid: account.uid, token: random_token}, function(err) {
            if (err) {
              logger.error('auth/create_token create failed: ', err);
              res.send({status: 2, msg: errMsg[2], uid: account.uid});
            } else {
              res.send({status: 0, msg: errMsg[0], uid: account.uid, token: random_token});
            }
          });
        }
      }
    });
  } else {
    res.send({status: 4,  msg: errMsg[4]});
  }
});

app.post('/user/refresh_token', function(req, res) {
  var account = req.body;
  logger.info(account);
  if (account && account.uid) {
    user.findOne({uid: account.uid}, function(err, ret) {
      if (err) {
        logger.error('auth/refresh_token query failed: ', err);
        res.send({status: 3,  msg: errMsg[3], uid: account.uid});
      } else {
        if (ret) {
          var random_token = uuidv4();
          user.update({uid: account.uid}, {$set: {token: random_token}}, function(err) {
            if (err) {
              logger.error('auth/refresh_token update failed: ', err);
              res.send({status: 2, msg: errMsg[2], uid: account.uid});
            } else {
              res.send({status: 0, msg: errMsg[0], uid: account.uid, token: random_token});
            }
          });
        } else {
          res.send({status: 5,  msg: errMsg[5], uid: account.uid});
        }
      }
    });
  } else {
    res.send({status: 4, msg: errMsg[4]});
  }

});

http.listen(4000, function(){
  logger.info('listening on *:4000');
});