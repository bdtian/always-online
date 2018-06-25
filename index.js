var app = require('express')();
var bodyParser = require('body-parser');
var http = require('http').Server(app);

var io = require('socket.io')(http);
var redisAdapter = require('socket.io-redis');

var log4js = require('log4js');
var redis = require('redis');
var util = require('util');
var user = require('./database/db').user;

const uuidv4 = require('uuid/v4');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// init logger
log4js.configure({
  appenders: {
    console: {
      type: 'stdout'
    },
    file: {
      type: 'dateFile',
      filename: 'logs/always-online_',
      pattern: 'yyyy-MM-dd.log',
      alwaysIncludePattern: true,
      maxLogSize: 8 * 1024 * 1024,
      backups: 4
    }
  },
  categories: { default: { appenders: ['console', 'file'], level: 'trace' } }
});

const logger = log4js.getLogger();

var redisClient = redis.createClient;

// used for cluster sync 'server-msg'
var pub = redisClient({ host: 'localhost', port: 6379 });
var sub = redisClient({ host: 'localhost', port: 6379 });

// used for socket.io msg sync.
var adapter = redisAdapter({ host: 'localhost', port: 6379 });

// used for msg storage.
var redis = redisClient({ host: 'localhost', port: 6379 });


var onlineUsers = {
  //uid:{socket: socket, roomId:}
};

var onlineRooms = {
  //rid: {users: [{uid:}]}
};

function getIPAdress(){
    var interfaces = require('os').networkInterfaces();
    for(var devName in interfaces){
          var iface = interfaces[devName];
          for(var i=0;i<iface.length;i++){
               var alias = iface[i];
               if(alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal){
                     return alias.address;
               }
          }
    }
}

var currentServerId = util.format('%s:%s', getIPAdress(), process.pid);

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

var init = function() {
  adapter.pubClient.on('error', function() {
    logger.error('socket.io-redis pubClient error');
  });
  adapter.subClient.on('error', function() {
    logger.error('socket.io-redis subClient error');
  });

  io.adapter(adapter);

  sub.subscribe('server-msg');

  sub.on('message', function(channel, message) {
    // resp struct {'cmd': 'data':}
    if (channel == 'server-msg') {
      logger.debug('server-msg: %s', message);
      var data = JSON.parse(message);
      var cmd = data.cmd;

      if (cmd == 'socket-connected') {
        var uid = data.data.uid;
        var sid = data.data.sid;
        kickout(uid, sid);
      } else if (cmd == 'query-room-users') {
        var fromServerId = data.data.serverId;
        var fromUid = data.data.uid;
        var fromRoomId = data.data.rid;
        var fromSocketId = data.data.sid;

        if (fromRoomId in onlineRooms) {
          var content = JSON.stringify({
            cmd: 'query-room-users-ack',
            data: {
              users: onlineRooms[fromRoomId].users,
              serverId: fromServerId,
              uid: fromUid,
              rid: fromRoomId,
              sid: fromSocketId
            }
          });

          pub.publish('server-msg', content);
        }

      } else if (cmd == 'query-room-users-ack') {
        var fromServerId = data.data.serverId;
        var fromUid = data.data.uid;
        var fromRoomId = data.data.rid;
        var fromSocketId = data.data.sid;
        var roomUsers = data.data.users;
        var fromUser = null;
        if (fromUid in onlineUsers) {
          fromUser = onlineUsers[fromUid];
        }
        // make sure the socket does not change.
        if (fromServerId == currentServerId
          && fromUser != null
          && fromUser.socket.id == fromSocketId
          && fromUser.roomId == fromRoomId)
        {
          for(var idx in roomUsers) {
            var user = roomUsers[idx];
            if (user.uid != fromUid) {
              fromUser.socket.emit('remote_join', {uid: user.uid});
            }
          }
        }
      }
    }
  });
}

// hook to connection message, and call auth handler.
var authProcessor = function(io, auth, options, callback) {
  var timeout;

  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  options.timeout || (options.timeout = 1000);

  timeout = function(time, fn) {
    return setTimeout(fn, time);
  };

  return io.on('connection', function(socket) {
    var ip = socket.handshake.address;
    logger.info('recv a connection from ip: %s, socket.id: %s', ip, socket.id);

    var disconnect = function(error) {
      if (error == null) {
        error = 'unauthorized';
      }
      if (error instanceof Error) {
        error = error.message;
      }
      socket.emit('authenticate', {status: 1, data: error});
      return socket.disconnect(true);
    };

    timeout(options.timeout, function() {
      if (!socket.authenticated) {
        return disconnect('authentication timeout');
      }
    });

    socket.authenticated = false;

    return socket.on('authenticate', function(data) {
      logger.debug('authenticate msg: %s', JSON.stringify(data));
      return auth(socket, data, function(error) {
        if (error != null) {
          logger.warn('auth error');
          return disconnect(error);
        } else {
          logger.debug('auth pass');
          socket.authenticated = true;
          socket.emit('authenticate', {status: 0});
          return callback(socket);
        }
      });
    });
  });
}

var authHandler = function(socket, data, done) {
  // check for valid credential data
  var uid = data.uid;
  var token = data.token;
  // redis.get(uid, function(err, reply) {
  //     // reply is null when the key is missing
  //     if (reply == token) {
  //       socket.uid = uid;
  //       done();
  //     } else {
  //       logger.warn('auth failed, uid=%s, token=%s', uid, token);
  //       done(new Error('bad credentials'));
  //     }
  // });
  user.findOne({uid: uid, token: token}, function(err, ret) {
    if (err) {
        logger.warn('auth error, uid=%s, token=%s', uid, token);
        done(new Error('server error'));
    } else {
      if (ret) {
        logger.warn('auth success, uid=%s, token=%s', uid, token);
        socket.uid = uid;
        done();
      } else {
        logger.warn('auth failed, uid=%s, token=%s', uid, token);
        done(new Error('auth failed'));
      }
    }
  });
};

var postAuthHandler = function(socket) {
  var uid = socket.uid;
  var sid = socket.id;

  pub.publish('server-msg',JSON.stringify({
    cmd:'socket-connected',
    data: {
      uid: uid,
      sid: sid
    }
  }));

  kickout(uid, sid);

  // save user info and room in memory
  onlineUsers[uid] = {socket: socket};

  socket.on('join', function(msg){

    logger.info('recv a join with msg: %s', JSON.stringify(msg));

    var roomId = msg.roomId;
    socket.rid = roomId;

    if (roomId === '' || roomId == 'undefined') {
       socket.emit('join', {'status': 1});
       return;
    }

    socket.join(roomId, function() {
      logger.info('join room success, uid: %s, roomId: %s, socketId: %s', uid, roomId, sid);

      if (!(roomId in onlineRooms)) {
        onlineRooms[roomId] = {users: []}
      }
      onlineRooms[roomId].users.push({uid: uid});
      onlineUsers[uid].roomId = roomId;

      socket.emit('join', {status: 0});
      socket.to(roomId).emit('remote_join', {uid: socket.uid});

      // TODO: send the user the rooms user that has already joined.
      //socket.emit('remoteJoin', {uid: 1});
      pub.publish('server-msg', JSON.stringify({
        cmd: 'query-room-users',
        data: {
          uid: uid,
          rid: roomId,
          serverId: currentServerId,
          sid: sid
        }
      }));
    });

  });

  socket.on('leave', function(msg) {
    if (socket.rid) {
      socket.leave(socket.rid, function(msg) {
        logger.info('leave room success, socket.id: %s, roomId: %s', socket.id, roomId);
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
      msg.storage = 0;
    }

    var msgId = msg.msgId;
    var msgStorageTypeValue = msgStorageType[msg.storage];
    var msgRoomKey = util.format('msg_%s_%s', socket.rid, msgStorageTypeValue);

    var ts = parseInt(Date.now() / 1000);
    var content = JSON.stringify({data: msg, ts: ts, uid: socket.uid});
    if (msgStorageTypeValue == 'insert') {
      // list insert
      redis.lpush(msgRoomKey, content);
    } else if (msgStorageTypeValue == 'update') {
      // dict field update
      redis.hset(msgRoomKey, msgId, content);
      // backup update msg
      redis.lpush(util.format('%s_backup', msgRoomKey), content);
    } else if (msgStorageTypeValue == 'ignore') {
      // backup ignore msg
      redis.lpush(msgRoomKey, content);
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

    redis.lrange(msgRoomKey, offset, offset + pageSize, function(err, res) {
      res = res || [];
      for(var idx in res) {
        var v = res[idx];
        var r = JSON.parse(v);
        msgs.push(r.data);
      }

      //if no more insert msgs
      if (msgs.length < pageSize) {
        msgRoomKey = util.format('msg_%s_%s', socket.rid, 'update');

        redis.hgetall(msgRoomKey, function(err, res) {
          res = res || {};
          for (var k in res) {
            // var field = res[i];
            var v = res[k];
            try {
              v = JSON.parse(v);
            } catch(e) {
              logger.warn(e);
            }
            msgs.push(v.data);
          }

          var content = {data: msgs, offset: offset + msgs.length, next: 0};
          logger.debug('send sync resp finish: %s', JSON.stringify(content))
          socket.emit('sync', content);

        });
      } else {
        var content = {data: msgs, offset: offset + msgs.length, next: 1};
        logger.debug('send sync resp: %s', JSON.stringify(content))
        socket.emit('sync', content);
      }

    });
  });

  socket.on('disconnect', function() {
    // if the user has already join a room, broadcast to other users
    if (socket.rid) {
      socket.to(socket.rid).emit('remote_disconnect', {uid: socket.uid});
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

    delete onlineUsers[socket.uid];

    logger.info('disconnect: socket.id:', socket.id);
  });
};


// main
(function main() {
  init();
  authProcessor(io, authHandler, {timeout: 10000}, postAuthHandler);

  http.listen(3000, function(){
    logger.info('listening on *:3000');
  });

  app.get('/', function(req, res) {
    res.sendFile(__dirname + '/index.html');
  });

  app.post('/user/create_token', function(req, res) {
    var accountInfo = req.body;
    if (accountInfo && accountInfo.uid) {
      user.findOne({uid: accountInfo.uid}, function(err, ret) {
        if (err) {
          logger.error('auth/create_token query failed: %s', err);
          res.send({status: 3, msg: 'server error', uid: accountInfo.uid});
        } else {
          if (ret) {
            res.send({status: 1, msg: 'user exists', uid: accountInfo.uid});
          } else {
            var random_token = uuidv4();
            logger.info("token:" + random_token);
            user.create({uid: accountInfo.uid, token: random_token}, function(err) {
              if (err) {
                res.send({status: 2, msg: 'create_token failed', uid: accountInfo.uid});
              } else {
                res.send({status: 0, uid: accountInfo.uid, token: random_token});
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
    var accountInfo = req.body;
    logger.info(accountInfo);
    if (accountInfo && accountInfo.uid) {
      user.findOne({uid: accountInfo.uid}, function(err, ret) {
        if (err) {
          logger.error('auth/refresh_token query failed: %s', err);
          res.send({status: 3, msg: 'server error', uid: accountInfo.uid});
        } else {
          if (ret) {
            var random_token = uuidv4();
            user.update({uid: accountInfo.uid}, {$set: {token: random_token}}, function(err) {
              if (err) {
                res.send({status: 2, msg: 'refresh_token failed', uid: accountInfo.uid});
              } else {
                res.send({status: 0, uid: accountInfo.uid, token: random_token});
              }
            });
          } else {
            res.send({status: 1, msg: 'user not exists', uid: accountInfo.uid});
          }
        }
      });
    } else {
      res.send({status: 4, msg: 'params error'});
    }

  });


})();
