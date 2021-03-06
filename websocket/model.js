var redis = require('redis');
var util = require('util');
var config = require('config');
var logger = require('../utils/logger')('always-online-model');

// used for msg storage.
var redisClient = redis.createClient({ 
  host: config.get('redis.host') || 'localhost',
  port: config.get('redis.port') || 6379,
  retry_strategy: function (options) {
    if (options.error && options.error.code === 'ECONNREFUSED') {
        // End reconnecting on a specific error and flush all commands with a individual error 
        logger.error('refuse connect, retry', options.attempt);
    }

    if (options.times_connected > 10) {
        logger.error('retry connect more than 10 times');
    }

    // reconnect after
    return Math.max(options.attempt * 100, 3000);
  }
});

redisClient.on("error", function (err) {
  logger.error('redis error ', err);
});

var msgStorageType = {
  0: 'insert',
  1: 'update',
  2: 'ignore',
};

// Note: redis key format, msg_{roomId}_{storageType} or msg_{roomId}_{storageType}_backup
var getRoomMessage = function(roomId, offset, detail, callback) {
  if (typeof(detail) == 'function') {
    callback = detail;
    detail = false;
  }
  var msgRoomKey = util.format('msg_%s_%s', roomId, 'insert');

  var pageSize = 200;
  var msgs = [];

  redisClient.lrange(msgRoomKey, offset, offset + pageSize - 1, function(err, res) {
    res = res || [];
    for(var idx in res) {
      var v = res[idx];
      v = JSON.parse(v);
      if (detail) {
        msgs.push(v);
      } else {
        msgs.push(v.data);
      }
    }

    //if no more insert msgs
    if (msgs.length < pageSize) {
      msgRoomKey = util.format('msg_%s_%s', roomId, 'update');

      redisClient.hgetall(msgRoomKey, function(err, res) {
        res = res || {};
        for (var k in res) {
          var v = res[k];
          try {
            v = JSON.parse(v);
          } catch(e) {
            logger.warn(e);
          }
          if (detail) {
            msgs.push(v);
          } else {
            msgs.push(v.data);
          }
        }

        var content = {
          data: msgs,
          offset: offset + msgs.length,
          next: 0
        };

        callback(content);
      });

    } else {
      var content = {
        data: msgs,
        offset: offset + msgs.length,
        next: 1
      };

      callback(content);
    }

  });
}

var saveRoomMessage = function(roomId, uid, msg) {
  if (!(msg.s in msgStorageType)) {
    // default to insert
    msg.s = 0;
  }

  // 1 stands for msgId
  var msgId = msg[1];
  var msgStorageTypeValue = msgStorageType[msg.s];
  var msgRoomKey = util.format('msg_%s_%s', roomId, msgStorageTypeValue);

  var ts = parseInt(Date.now() / 1000);
  var content = JSON.stringify({data: msg, ts: ts});
  if (msgStorageTypeValue == 'insert') {
    // list insert
    redisClient.rpush(msgRoomKey, content);
  } else if (msgStorageTypeValue == 'update') {
    // dict field update
    redisClient.hset(msgRoomKey, msgId, content);
    // backup update msg
    redisClient.rpush(util.format('%s_backup', msgRoomKey), content);
  } else if (msgStorageTypeValue == 'ignore') {
    // backup ignore msg
    redisClient.rpush(msgRoomKey, content);
  }
}


var clearRoomMessage = function(roomId) {
  for (var idx in msgStorageType) {
    var msgStorageTypeValue = msgStorageType[idx];
    var msgRoomKey = util.format('msg_%s_%s', roomId, msgStorageTypeValue);
    redisClient.del(msgRoomKey);
    if (msgStorageTypeValue == 'update') {
      redisClient.del(util.format('%s_backup', msgRoomKey));
    }
  }
}

var checkAuthRateLimit = function(uid, cb) {
  redisClient.select('rate_limit', function() {
    redisClient.hgetall(uid, function(err, res) {
      var ts = parseInt(Date.now() / 1000);
      if (res) {
        res.limit--;
        redisClient.hset(uid, 'limit', res.limit);
        if (res.limit <= 0) {
          cb(false);
        } else {
          cb(true);
        }
      } else {
        redisClient.hset(uid, 'ts', ts);
        redisClient.hset(uid, 'limit', config.get('authRateLimit') || 30);
        redisClient.expire(uid, 60);
        cb(true);
      }
    });
  });
}

module.exports = {
  getRoomMessage: getRoomMessage,
  saveRoomMessage: saveRoomMessage,
  clearRoomMessage: clearRoomMessage,
  checkAuthRateLimit: checkAuthRateLimit
}