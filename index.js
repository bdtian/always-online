var app = require('express')();
var http = require('http').Server(app);

var io = require('socket.io')(http);
var redisAdapter = require('socket.io-redis')

var log4js = require('log4js');
var redis = require('redis')

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
  //uid:{socket: socket}
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

var init = function() {
  adapter.pubClient.on('error', function() {
    logger.error('socket.io-redis pubClient error');
  });
  adapter.subClient.on('error', function() {
    logger.error('socket.io-redis subClient error');
  });

  io.adapter(adapter);

  sub.subscribe('server-msg')
  sub.on('message', function(err, resp) {
    // resp struct {'cmd': 'data':}
    var data = JSON.parse(resp);
    var cmd = data.cmd;
    if (cmd == 'socket-connected') {
      var uid = data.data.uid;
      var sid = data.data.sid;
      kickout(uid, sid);
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
      return socket.disconnect();
    };

    timeout(options.timeout, function() {
      if (!socket.authenticated) {
        return disconnect('authentication timeout');
      }
    });

    socket.authenticated = false;

    return socket.on('authenticate', function(data) {
      logger.debug('authenticate msg: %s', data);
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
      logger.debug(reply);
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

  pub.publish('server-msg',  JSON.stringify({cmd:'socket-connected', data: {uid: uid, sid: socket.id}}));
  kickout(uid, socket.id);

  onlineUsers[uid] = {socket: socket};

  socket.on('join', function(msg){

    logger.info('recv a join with msg: %s', msg);

    var roomId = msg.roomId;
    socket.rid = roomId;

    if (roomId === '' || roomId == 'undefined') {
       socket.emit('join',{'status': 1});
       return;
    }

    socket.join(roomId, function() {
      logger.info('join room success, roomId: %s', roomId);
      socket.emit('join', {status: 0});
      socket.to(roomId).emit('remoteJoin', {uid: socket.uid});
    });
  });

  socket.on('leave', function(msg) {
    socket.leave(socket.rid, function(msg) {
      logger.info('leave room success, socket.id: %s, roomId: %s', socket.id, roomId);
    });
  });

  socket.on('msg', function(msg) {
    logger.debug('recv a msg, socket.id: %s, roomId: %s, msg: ', socket.id, socket.rid, msg);

    redis.lpush(socket.rid, JSON.stringify({data: msg, ts:10000}));
    socket.to(socket.rid).emit('msg', msg);
  });

  socket.on('sync', function(msg) {
    // load datbase,
    logger.info('recv sync request, socket.id: %s, roomId: %s' , socket.id, socket.rid);
    var page = msg.page || 0;
    redis.lrange(socket.rid, page * 200, (page + 1) * 200, function(err, res) {
      var resp = [];
      for(var d in res) {
          var r = JSON.parse(resp);
          resp.push(r.data);
      }

      socket.emit('sync', {data: resp, page: page})
    });
  });

  socket.on('disconnect', function() {
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
