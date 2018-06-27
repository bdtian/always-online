var redis = require('redis');
var util = require('util');
var logger = require('../utils/logger')('always-online-model');

// used for msg storage.
var redisClient = redis.createClient({ 
  host: 'localhost', 
  port: 6379,
  retry_strategy: function (options) {
    if (options.error.code === 'ECONNREFUSED') {
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
  if (!(msg.storage in msgStorageType)) {
    // default to insert
    msg.storage = 0;
  }

  var msgId = msg.msgId;
  var msgStorageTypeValue = msgStorageType[msg.storage];
  var msgRoomKey = util.format('msg_%s_%s', roomId, msgStorageTypeValue);

  var ts = parseInt(Date.now() / 1000);
  var content = JSON.stringify({data: msg, ts: ts, uid: uid});
  if (msgStorageTypeValue == 'insert') {
    // list insert
    redisClient.lpush(msgRoomKey, content);
  } else if (msgStorageTypeValue == 'update') {
    // dict field update
    redisClient.hset(msgRoomKey, msgId, content);
    // backup update msg
    redisClient.lpush(util.format('%s_backup', msgRoomKey), content);
  } else if (msgStorageTypeValue == 'ignore') {
    // backup ignore msg
    redisClient.lpush(msgRoomKey, content);
  }
}

module.exports = {
  getRoomMessage: getRoomMessage,
  saveRoomMessage: saveRoomMessage
}