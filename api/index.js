var app = require('express')();
var http = require('http').Server(app);
var bodyParser = require('body-parser');
const uuidv4 = require('uuid/v4');
var user = require('../database/db').user;
var logger = require('../utils/logger')('alway-online-api');

// express
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.post('/user/create_token', function(req, res) {
  var account = req.body;
  if (account && account.uid) {
    user.findOne({uid: account.uid}, function(err, ret) {
      if (err) {
        logger.error('auth/create_token query failed: %s', JSON.stringify(err));
        res.send({status: 3, msg: 'server error', uid: account.uid});
      } else {
        if (ret) {
          res.send({status: 1, msg: 'user exists', uid: account.uid});
        } else {
          var random_token = uuidv4();
          logger.info("token:" + random_token);
          user.create({uid: account.uid, token: random_token}, function(err) {
            if (err) {
              logger.error('auth/create_token create failed: %s', JSON.stringify(err));
              res.send({status: 2, msg: 'create_token failed', uid: account.uid});
            } else {
              res.send({status: 0, uid: account.uid, token: random_token});
            }
          });
        }
      }
    });
  } else {
    res.send({status: 4, msg: 'params error'});
  }
});

app.post('/user/refresh_token', function(req, res) {
  var account = req.body;
  logger.info(account);
  if (account && account.uid) {
    user.findOne({uid: account.uid}, function(err, ret) {
      if (err) {
        logger.error('auth/refresh_token query failed: %s', JSON.stringify(err));
        res.send({status: 3, msg: 'server error', uid: account.uid});
      } else {
        if (ret) {
          var random_token = uuidv4();
          user.update({uid: account.uid}, {$set: {token: random_token}}, function(err) {
            if (err) {
              logger.error('auth/refresh_token update failed: %s', JSON.stringify(err));
              res.send({status: 2, msg: 'refresh_token failed', uid: account.uid});
            } else {
              res.send({status: 0, uid: account.uid, token: random_token});
            }
          });
        } else {
          res.send({status: 1, msg: 'user not exists', uid: account.uid});
        }
      }
    });
  } else {
    res.send({status: 4, msg: 'params error'});
  }

});

http.listen(4000, function(){
  logger.info('listening on *:4000');
});