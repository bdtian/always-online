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
    logger.info(
      'recv a connection socket.id: %s, details: %s',
      socket.id,
      JSON.stringify(socket.handshake)
    );

    var disconnect = function(error) {
      if (error == null) {
        error = 'unauthorized';
      }
      if (error instanceof Error) {
        error = error.message;
      }

      logger.warn('auth error, %s', error);

      socket.emit('authenticate', {status: 1, data: error});
      return socket.disconnect(true);
    };

    timeout(options.timeout, function() {
      if (!socket.authenticated) {
        logger.warn(
          "socket.id: %s, does not auth within %s ms, will disconnect",
          socket.id, options.timeout);
        return disconnect('authentication timeout');
      }
    });

    socket.authenticated = false;

    return socket.on('authenticate', function(data) {
      return authhandler(socket, data, function(error) {
        if (error != null) {
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