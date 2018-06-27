var http = require('http').Server();
var io = require('socket.io')(http);
var redis = require('redis');
var util = require('util');
var user = require('../database/db').user;
var logger = require('../utils/logger')('always-online-websocket');
io.logger = logger;

var auth = require('./io-auth');
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


var onlineUsers = {
  //uid:{socket: socket}
};

var onlineRooms = {
  //rid: {users: [{uid:}]}
};

var authHandler = function(socket, data, done) {
  // check for valid credential data
  var uid = data.uid;
  var token = data.token;
  if (process.env.NODE_ENV === 'development') {
    logger.info('[development env] ignore auth, uid=%s, token=%s', uid, token);
    socket.uid = uid;
    done();
  } else {
    user.findOne({uid: uid, token: token}, function(err, ret) {
      if (err) {
          logger.warn('auth error, uid=%s, token=%s', uid, token);
          done(new Error('server error'));
      } else {
        if (ret) {
          logger.info('auth success, uid=%s, token=%s', uid, token);
          socket.uid = uid;
          done();
        } else {
          logger.warn('auth failed, uid=%s, token=%s', uid, token);
          done(new Error('auth failed, uid or token is wrong'));
        }
      }
    });
  }
};

var kickout = function(uid, sid) {
  if (uid in onlineUsers) {
    var socket = onlineUsers[uid].socket;
    if (socket.id != sid) {
      logger.warn("kickout: " + socket.id);
      socket.emit('kickout', 0);
      socket.disconnect();
     }
  }
}

var postAuthHandler = function(socket) {
  var uid = socket.uid;
  var sid = socket.id;

  kickout(uid, sid);

  // save user info and room in memory
  onlineUsers[uid] = {socket: socket};

  socket.on('join', function(msg){
    logger.info('recv a join with msg: %s', JSON.stringify(msg));

    var roomId = msg.roomId;
    socket.rid = roomId;

    if (roomId === '' || roomId == 'undefined') {
       socket.emit('join', {'status': 1, data: 'join failed, require roomId'});
       return;
    }

    socket.join(roomId, function() {
      logger.info('join room success, uid: %s, roomId: %s, socketId: %s', uid, roomId, sid);

      if (!(roomId in onlineRooms)) {
        onlineRooms[roomId] = {users: []}
      }
      onlineRooms[roomId].users.push({uid: uid});

      socket.emit('join', {status: 0, data: 'join success'});
      socket.to(roomId).emit('remote_join', {uid: socket.uid});
    });

  });

  socket.on('leave', function(msg) {
    if (socket.rid) {
      socket.leave(socket.rid, function(msg) {
        logger.info('leave room success, socket.id: %s, socket.rid: %s', socket.id, socket.rid);
      });

      socket.to(socket.rid).emit('remote_leave', {uid: socket.uid});
    }

    socket.disconnect(true);
  });

  var msgStorageType = {
    0: 'insert',
    1: 'update',
    2: 'ignore',
  };

  socket.on('msg', function(msg) {
    logger.debug('recv a msg, socket.id: %s, roomId: %s, msg: ', socket.id, socket.rid, msg);

    if (!(msg.storage in msgStorageType)) {
      // default to insert
      msg.storage = 0;
    }

    var msgId = msg.msgId;
    var msgStorageTypeValue = msgStorageType[msg.storage];
    var msgRoomKey = util.format('msg_%s_%s', socket.rid, msgStorageTypeValue);

    var ts = parseInt(Date.now() / 1000);
    var content = JSON.stringify({data: msg, ts: ts, uid: socket.uid});
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
    socket.to(socket.rid).emit('msg', msg);
  });

  socket.on('sync', function(msg) {
    // load datbase,
    logger.info('recv sync request, socket.id: %s, roomId: %s' , socket.id, socket.rid);
    var offset = msg.offset || 0;

    var msgRoomKey = util.format('msg_%s_%s', socket.rid, 'insert');

    if (msg.offset == 0) {
      //if start sync, need notify other user, sync begin.
      socket.to(socket.rid).emit('remote_sync', {uid: socket.uid});
    }

    var pageSize = 200;
    var msgs = [];

    redisClient.lrange(msgRoomKey, offset, offset + pageSize, function(err, res) {
      res = res || [];
      for(var idx in res) {
        var v = res[idx];
        var r = JSON.parse(v);
        msgs.push(r.data);
      }

      //if no more insert msgs
      if (msgs.length < pageSize) {
        msgRoomKey = util.format('msg_%s_%s', socket.rid, 'update');

        redisClient.hgetall(msgRoomKey, function(err, res) {
          res = res || {};
          for (var k in res) {
            var v = res[k];
            try {
              v = JSON.parse(v);
            } catch(e) {
              logger.warn(e);
            }
            msgs.push(v.data);
          }

          var content = {
            data: msgs,
            offset: offset + msgs.length,
            next: 0
          };

          logger.debug('send sync resp finish: %s', JSON.stringify(content))
          socket.emit('sync', content);

        });
      } else {
        var content = {
          data: msgs,
          offset: offset + msgs.length,
          next: 1
        };

        logger.debug('send sync resp: %s', JSON.stringify(content))
        socket.emit('sync', content);
      }

    });
  });

  socket.on('disconnect', function() {
    // if the user has already join a room, broadcast to other users
    if (socket.rid) {
      socket.to(socket.rid).emit('remote_disconnect', {uid: socket.uid});

      // remove user in online rooms.
      if (socket.rid in onlineRooms) {
        var roomUsers = onlineRooms[socket.rid].users;
        for (var idx in roomUsers) {
          if (roomUsers[idx].uid == socket.uid) {
            roomUsers.splice(idx, 1);
            if (roomUsers.length == 0) {
              delete onlineRooms[socket.rid];
            }
            break;
          }
        }
      }
    }

    // remove user in online user.
    delete onlineUsers[socket.uid];

    logger.info('disconnect: socket.id:', socket.id);
  });
};

// main
(function main() {
  auth.registerAuthProcessor(io, authHandler, {timeout: 10000}, postAuthHandler);

  http.listen(3000, function(){
    logger.info('listening on *:3000');
  });

})();
