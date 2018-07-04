var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var db = require('../database/db');
var model = require('./model');
var logger = require('../utils/logger')('always-online-websocket');
io.logger = logger;

var auth = require('./io-auth');

var api = require('./api');
var config = require('config');

// for security, development env igore user auth by default,
// but can force user auth by set forceUserAuth to true using /admin/system/config api
if (app.runContext) {
  logger.error('app.runContext conflict');
}

app.runContext = {
  forceUserAuth: false,
  onlineUsers: {
    //uid:[{socket: socket}]
  },
  onlineRooms: {
    //rid: {users: [{socket: socket}]}
  },
  onlineUserCount: 0,
};

var authHandler = function(socket, data, done) {
  logger.info('online user count: %d', app.runContext.onlineUserCount);
  // check for valid credential data
  var uid = data.uid;
  var token = data.token;

  var ignoreUserAuth = false;
  if(config.has('ignoreUserAuth')) {
    ignoreUserAuth = config.get('ignoreUserAuth');
  }
  if (ignoreUserAuth && !app.runContext.forceUserAuth) {
    logger.info('ignore auth, uid: %s, token: %s', uid, token);
    socket.uid = uid;
    done();
  } else {
    db.user.findOne({uid: uid, token: token}, function(err, ret) {
      if (err) {
          logger.warn('auth error, uid: %s, token: %s, err: ', uid, token, err);
          done(new Error('server error'));
      } else {
        if (ret) {
          logger.info('auth success, uid: %s, token: %s', uid, token);
          socket.uid = uid;
          done();
        } else {
          logger.warn('auth failed, uid: %s, token: %s', uid, token);
          done(new Error('auth failed, uid or token is wrong'));
        }
      }
    });
  }
};

var kickout = function(uid, sid) {
  var onlineUsers = app.runContext.onlineUsers;

  if (uid in onlineUsers) {
    var sockets = onlineUsers[uid];
    var hasKicked = false;
    for (var idx in sockets) {
      var socket = sockets[idx].socket;
      if (socket.id != sid) {
        if (socket.rid) {
          socket.leave(socket.rid);
        }
        socket.kicked = true;

        logger.warn("kickout, uid: %s, socket.id: %s, roomId: %s", uid, socket.id, socket.rid);
        socket.emit('kickout', 0);

        //TODO: need set a timeout?
        socket.disconnect(true);
        hasKicked = true;
       }
    }
  }

  return hasKicked;
}

var postAuthHandler = function(socket) {
  var onlineUsers = app.runContext.onlineUsers;
  var onlineRooms = app.runContext.onlineRooms;

  app.runContext.onlineUserCount++;

  var uid = socket.uid;
  var sid = socket.id;

  var hasKicked = kickout(uid, sid);
  if (hasKicked) {
    // other client has logged in, set the client to kicker,
    // the kicker need't to broadcast join msg
    socket.kicker = true;
  }

  // save user info and room in memory
  if (!(uid in onlineUsers)) {
    onlineUsers[uid] = [];
  }

  onlineUsers[uid].push({socket: socket});

  // if not join room within 10 secs, disconnect the socket
  var joinTimeout = config.get('joinTimeout') || 1000;
  setTimeout(function() {
    if (!socket.rid) {
      logger.warn(
        "uid: %s, socket.id: %s, does not join a room within %s secs, will disconnect",
        uid, socket.id, joinTimeout);
      socket.disconnect(true);
    }
  }, joinTimeout);

  socket.on('join', function(msg){
    logger.info('recv a join with msg: ', msg);

    var roomId = msg.roomId;

    // dummy client can peep the room info.
    var dummy = msg.dummy || false;
    socket.dummy = dummy;

    if (roomId === '' || roomId == undefined) {
       socket.emit('join', {'status': 1, data: 'join failed, require roomId'});
       return;
    }

    socket.join(roomId, function() {
      logger.info('join room success, uid: %s, roomId: %s, socketId: %s', uid, roomId, sid);
      socket.rid = roomId;

      if (!(roomId in onlineRooms)) {
        onlineRooms[roomId] = {users: []}
      }
      onlineRooms[roomId].users.push({socket: socket});

      socket.emit('join', {status: 0, data: 'join success'});
      if (socket.kicker) {
        logger.info(
          'uid: %s kickout other client, no need to broadcast the join msg in room: %s',
          socket.uid,
          socket.rid
        );
      } else {
        if (dummy) {
          logger.info(
            'uid: %s dummy client, no need to broadcast the join msg in room: %s',
            socket.uid,
            socket.rid
          );
        } else {
          socket.to(roomId).emit('remote_join', {uid: socket.uid});
        }
      }

      //send other users to the client
      var roomUsers = onlineRooms[roomId].users;
      for (var idx in roomUsers) {
        var roomUser = roomUsers[idx];
        if (roomUser.socket.uid != socket.uid) {
          logger.info('send to uid: %s, remote_join, uid: %s', socket.uid, roomUser.socket.uid);
          socket.emit('remote_join', {uid: roomUser.socket.uid});
        }
      }
    });

  });

  socket.on('leave', function(msg) {
    if (socket.rid) {
      socket.leave(socket.rid, function(msg) {
        logger.info(
          'leave room success, uid: %s, roomId: %s, socket.id: %s',
          socket.uid,
          socket.rid,
          socket.id
        );
      });

      if (!socket.kicked && !socket.dummy) {
        socket.to(socket.rid).emit('remote_leave', {uid: socket.uid});
      }
    }

    socket.disconnect(true);
  });

  socket.on('msg', function(msg) {
    if (socket.dummy) {
      logger.info(
        'dummy client can not send msg, uid: %s, roomId: %s, socket.id',
        socket.uid,
        socket.rid,
        socket.id
      );
      return;
    }

    // 2 stands for uid
    msg[2] = socket.uid;

    logger.debug(
      'recv a msg, uid: %s, socket.id: %s, roomId: %s, msg size: %s bytes',
      socket.uid,
      socket.id,
      socket.rid,
      JSON.stringify(msg).length
    );
    model.saveRoomMessage(socket.rid, socket.uid, msg);
    socket.to(socket.rid).emit('msg', msg);
  });

  socket.on('sync', function(msg) {
    var offset = msg.offset || 0;

    logger.info(
      'recv sync request, uid: %s, socket.id: %s, roomId: %s',
      socket.uid,
      socket.id,
      socket.rid
    );

    if (msg.offset == 0 && !socket.dummy) {
      //if start sync, need notify other user, sync begin.
      socket.to(socket.rid).emit('remote_sync', {uid: socket.uid});
    }

    model.getRoomMessage(socket.rid, offset, function(content) {
      logger.debug(
        'send sync resp to uid: %s, msg size: %d bytes, msg count: %d',
        socket.uid,
        JSON.stringify(content).length,
        content.data.length
      );
      socket.emit('sync', content);
    });
  });

  socket.on('disconnect', function() {
    app.runContext.onlineUserCount--;
    logger.info('online user count: %d', app.runContext.onlineUserCount);

    // if the user has already join a room, broadcast to other users
    if (socket.rid) {
      if (!socket.kicked && !socket.dummy) {
        socket.to(socket.rid).emit('remote_disconnect', {uid: socket.uid});
      }

      // remove user in online rooms.
      if (socket.rid in onlineRooms) {
        var roomUsers = onlineRooms[socket.rid].users;
        for (var idx in roomUsers) {
          if (roomUsers[idx].socket == socket) {
            roomUsers.splice(idx, 1);
            if (roomUsers.length == 0) {
              delete onlineRooms[socket.rid];
              logger.info('delete room: %s', socket.rid);
            }
            break;
          }
        }
      }
    }

    // remove user in online user.
    if (socket.uid) {
      var sockets = onlineUsers[socket.uid];
      for (var idx in sockets) {
        if (sockets[idx].socket == socket) {
          sockets.splice(idx, 1);
          if (sockets.length == 0) {
            delete onlineUsers[socket.uid];
            logger.info('delete user: %s', socket.uid);
          }
          break;
        }
      }
    }

    logger.info(
      'disconnect: uid: %s, roomId: %s, socket.id: %s',
      socket.uid,
      socket.rid,
      socket.id
    );
  });
};

// main
(function main() {
  auth.registerAuthProcessor(io, authHandler, {timeout: config.get('authTimeout')}, postAuthHandler);
  api.regsiter(app);
  
  http.listen(3000, function(){
    logger.info('listening on *:3000');
  });

})();
