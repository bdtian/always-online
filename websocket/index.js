var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var util = require('util');
var db = require('../database/db');
var model = require('./model');
var logger = require('../utils/logger')('always-online-websocket');
io.logger = logger;

var auth = require('./io-auth');

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
    db.user.findOne({uid: uid, token: token}, function(err, ret) {
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
      logger.warn("kickout, uid:%s, socket.id: %s", uid, socket.id);
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
  if (uid in onlineUsers) {
    logger.warn('user should not in onlineUsers, uid:%d', uid);
  }

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

  socket.on('msg', function(msg) {
    logger.debug('recv a msg, socket.id: %s, roomId: %s, msg: ', socket.id, socket.rid, msg);
    model.saveRoomMessage(socket.rid, socket.uid, msg);
    socket.to(socket.rid).emit('msg', msg);
  });

  socket.on('sync', function(msg) {
    // load datbase,
    logger.info('recv sync request, socket.id: %s, roomId: %s' , socket.id, socket.rid);
    var offset = msg.offset || 0;

    if (msg.offset == 0) {
      //if start sync, need notify other user, sync begin.
      socket.to(socket.rid).emit('remote_sync', {uid: socket.uid});
    }

    model.getRoomMessage(socket.rid, offset, function(content) {
      logger.debug('send sync resp: %s', JSON.stringify(content))
      socket.emit('sync', content);
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
  
  app.use('/admin/monitor/', function(req, res, next) {
    var uid = req.query['uid'];
    var token = req.query['token'];
    console.log(req.query, uid, token);
    if (uid && token) {
      db.admin.findOne({uid: uid}, function(err, ret) {
        if (!err && ret && ret.token == token) {
          next();
        } else {
          res.send({status: 1, data: 'require permission'});
        }
      });  
    } else {
      res.send({status: 1, data: 'require permission'});
    }
  });

  app.get('/admin/monitor/stat', function(req, res) {
    var online_user_count = 0;
    var online_room_count = 0;
    for (var k in onlineUsers) {
      online_user_count++;
    }
  
    for (var k in onlineRooms) {
      online_room_count++;
    }
  
    var stat = {
      online_user_count: online_user_count,
      online_room_count: online_room_count
    };
  
    logger.info('monitor server stat:', JSON.stringify(stat));

    res.send({status: 0, data: stat});  
  });

  app.get('/admin/monitor/room_users', function(req, res) {
    var roomId = req.query['roomId'];
    var offset = req.query['offset'] || 0;
    if (roomId && roomId != '') {
      var users = [];
      if (roomId in onlineRooms) {
        users = onlineRooms[roomId].users;
      }
      res.send({status: 0, data: users});
    } else {
      res.send({status: 1, data: 'require roomId'});
    }
  });

  app.get('/admin/monitor/room_msgs', function(req, res) {
    var roomId = req.query['roomId'];
    var offset = req.query['offset'] || 0;
    if (roomId && roomId != '') {
      model.getRoomMessage(roomId, offset, true, function(msgs) {
        logger.debug('monitor server room: %s', JSON.stringify(msgs))
        res.send({status: 0, data: msgs});
      });

    } else {
      res.send({status: 1, data: 'require roomId'});
    }
  });
  
  http.listen(3000, function(){
    logger.info('listening on *:3000');
  });

})();
