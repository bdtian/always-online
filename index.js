var app = require('express')();
var http = require('http').Server(app);

var io = require('socket.io')(http);
var redisAdapter = require('socket.io-redis')

var log4js = require('log4js');
var redis = require('redis')
var util = require('util')

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
              fromUser.socket.emit('remoteJoin', {uid: user.uid});
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
  redis.get(uid, function(err, reply) {
      // reply is null when the key is missing
      if (reply == token) {
        socket.uid = uid;
        done();
      } else {
        logger.warn('auth failed, uid=%s, token=%s', uid, token);
        done(new Error('bad credentials'));
      }
  });
};

var postAuthHandler = function(socket) {
  var uid = socket.uid;
  var rid = socket.rid;
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
  onlineUsers[uid] = {socket: socket, roomId: rid};
  if (!(rid in onlineRooms)) {
    onlineRooms[rid] = {users: []}
  }
  onlineRooms[rid].users.push({uid: uid});

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
      socket.emit('join', {status: 0});
      socket.to(roomId).emit('remoteJoin', {uid: socket.uid});

      // TODO: send the user the rooms user that has already joined.
      //socket.emit('remoteJoin', {uid: 1});
      pub.publish('server-msg', JSON.stringify({
        cmd: 'query-room-users',
        data: {
          uid: uid,
          rid: rid,
          serverId: currentServerId,
          sid: sid
        }
      }));
    });

  });

  socket.on('leave', function(msg) {
    socket.leave(socket.rid, function(msg) {
      logger.info('leave room success, socket.id: %s, roomId: %s', socket.id, roomId);
    });

    socket.to(socket.rid).emit('remoteLeave', {uid: socket.uid});
    socket.disconnect(true);
  });

  socket.on('msg', function(msg) {
    logger.debug('recv a msg, socket.id: %s, roomId: %s, msg: ', socket.id, socket.rid, msg);

    var msgRoomKey = util.format("msg_%s", socket.rid);
    var ts = int(Date.now() / 1000);
    redis.lpush(msgRoomKey, JSON.stringify({data: msg, ts: ts, uid: socket.uid}));
    socket.to(socket.rid).emit('msg', msg);
  });

  socket.on('sync', function(msg) {
    // load datbase,
    logger.info('recv sync request, socket.id: %s, roomId: %s' , socket.id, socket.rid);
    var page = msg.page || 0;
    var msgRoomKey = util.format("msg_%s", socket.rid);

    redis.lrange(msgRoomKey, page * 200, (page + 1) * 200, function(err, res) {
      var resp = [];
      for(var d in res) {
          var r = JSON.parse(resp);
          resp.push(r.data);
      }

      socket.emit('sync', {data: resp, page: page})
    });
  });

  socket.on('disconnect', function() {
    // if the user has already join a room, broadcast to other users
    if (socket.rid) {
      socket.to(socket.rid).emit('remoteDisconnect', {uid: socket.uid});
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

})();
