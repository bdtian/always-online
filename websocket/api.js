var response = require('../utils/response');
var logger = require('../utils/logger')('always-online-websocket');
var db = require('../database/db');
var model = require('./model');
var bodyParser = require('body-parser');

module.exports.regsiter = function(app) {
  // express
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));
  
  app.use('/admin/', function(req, res, next) {
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
      logger.info(
        'method=%s, path=/admin%s, params=%s, body=',
        req.method,
        req.path,
        JSON.stringify(req.query),
        req.body
      );
    } else {
      res.send(response.makeResponse(response.permission));
    }
  });
  
  app.post('/admin/system/push', function(req, res) {
    var data = req.body;
    var roomId = data.roomId || req.query['roomId'];
    var content = data.content;
    if (roomId && roomId != '') {
      if (roomId in onlineRooms) {
        io.to(data.roomId).emit('system', content);
        res.send(response.makeResponse(response.ok));
      } else {
        res.send(response.makeResponse(response.roomNotExists));
      }
    } else {
      res.send(response.makeResponse(response.paramError));
    }
  });
  
  app.post('/admin/system/config', function(req, res) {
    var data = req.body;
    var configForceUserAuth = data.forceUserAuth;
    if (configForceUserAuth != 'undefined') {
      app.runContext.forceUserAuth = configForceUserAuth;
    }
  
    // other config options can be added
  
    res.send(response.makeResponse(response.ok));
  });
  
  app.post('/admin/system/clear_room_msg', function(req, res) {
    var roomId = req.query['roomId'] || req.body.roomId;
    if (roomId && roomId != '') {
      model.clearRoomMessage(roomId);
      res.send(response.makeResponse(response.ok));
    } else {
      res.send(response.makeResponse(response.paramError));
    }
  });
  
  app.get('/admin/monitor/stat', function(req, res) {
    var onlineUsers = app.runContext.onlineUsers;
    var onlineRooms = app.runContext.onlineRooms;
    var forceUserAuth = app.runContext.forceUserAuth;
    var onlineUserCount = app.runContext.onlineUserCount;

    var users = [];
    var rooms = [];
  
    for (var k in onlineUsers) {
      for (var m in onlineUsers[k]) {
        users.push({uid: k, socketId: onlineUsers[k][m].socket.id});
      }
    }
  
    for (var k in onlineRooms) {
      if (onlineRooms[k].users.length > 0) {
        rooms.push(k);
      }
    }
  
    var stat = {
      online_user_count: users.length,
      online_users: users,
      online_room_count: rooms.length,
      online_rooms: rooms,
      online_socket_count: onlineUserCount,
      force_user_auth: forceUserAuth,
      env: process.env.NODE_ENV,
      memory: process.memoryUsage(),
    };
  
    res.send(response.makeResponse(response.ok, stat));
  });
  
  app.get('/admin/monitor/room_users', function(req, res) {
    var onlineRooms = app.runContext.onlineRooms;

    var roomId = req.query['roomId'];
    var offset = req.query['offset'] || 0;
    if (roomId && roomId != '') {
      var users = [];
      if (roomId in onlineRooms) {
        var us = onlineRooms[roomId].users;
        for (var idx in us) {
          users.push({uid: us[idx].socket.uid});
        }
      }
      res.send(response.makeResponse(response.ok, {users: users}));
    } else {
      res.send(response.makeResponse(response.paramError));
    }
  });
  
  app.get('/admin/monitor/room_msgs', function(req, res) {
    var roomId = req.query['roomId'];
    var offset = req.query['offset'] || 0;
    if (roomId && roomId != '') {
      model.getRoomMessage(roomId, offset, true, function(msgs) {
        logger.debug(
          'monitor server room, msg size: %d bytes, msg number: %d',
          JSON.stringify(msgs).length,
          msgs.data.length
        );
        res.send(response.makeResponse(response.ok, {msgs: msgs}));
      });
  
    } else {
      res.send(response.makeResponse(response.paramError));
    }
  });
}
