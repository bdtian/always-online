module.exports.registerAuthProcessor = function(io, authhandler, options, callback) {
  var timeout;
  var logger = io.logger;

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
      return authhandler(socket, data, function(error) {
        if (error != null) {
          logger.warn('auth error, %s', JSON.stringify(data));
          return disconnect(error);
        } else {
          socket.authenticated = true;
          socket.emit('authenticate', {status: 0, data: 'auth success'});
          return callback(socket);
        }
      });
    });
  });
}