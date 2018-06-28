var uid = 1;
module.exports = {
  
  /**
   * Before connection (optional, just for faye)
   * @param {client} client connection
   */
  beforeConnect : function(client) {
    // Example:
    // client.setHeader('Authorization', 'OAuth abcd-1234');
    // client.disable('websocket');
  },

  /**
   * On client connection (required)
   * @param {client} client connection
   * @param {done} callback function(err) {}
   */
  onConnect : function(client, done) {
    // Faye client
    // client.subscribe('/channel', function(message) { });

    // Socket.io client
    // client.emit('test', { hello: 'world' });

    // Primus client
    // client.write('Sailing the seas of cheese');

    // WAMP session
    // client.subscribe('com.myapp.hello').then(function(args) { });

    var socket = client;

    let userId = uid++;

    socket.emit('authenticate', {uid: userId, token: '0000'});
    console.log('user id: %d', uid);

    socket.on('authenticate', function(msg) {
      if (msg.status == 0) {
        console.log('auth success')
        var roomId = parseInt(userId + 1 / 2);
        console.log('uid: %d join room: %d', uid, roomId);
        socket.emit('join', {roomId: roomId});
      } else {
        console.log('auth failed')
      }
    });

    socket.on('join', function(msg) {
      if (msg.status == 0) {
        console.log('join success');
        socket.emit('sync', {offset: 0});
      } else {
        console.log('join failed');
      }
    });

    socket.on('sync', function(msg) {
      console.log('sync resp');
      socket.emit('msg', {msgId: 'test_insert', storage: 0, data:['sssssssssssssssssssssssssssssssssssssssssssssss']});
      socket.emit('msg', {msgId: 'test_update', storage: 1, data:['-----------------------------------------------']});    

      setInterval(function() {
        socket.emit('msg', {msgId: 'test_insert', storage: 0, data:['sssssssssssssssssssssssssssssssssssssssssssssss']});
        socket.emit('msg', {msgId: 'test_update', storage: 1, data:['-----------------------------------------------']});    
      }, 1000);
    });

    socket.on('remoteJoin', function(msg) {
      console.log('remote join uid:', msg.uid);
    });


    socket.on('remoteLeave', function(msg) {
      console.log('remote leave uid:', msg.uid);
    });


    socket.on('kickout', function(msg) {
      console.log('kickout');
    });

    socket.on('disconnect', function() {
      console.log('disconnect');
    });
  },

  /**
   * Send a message (required)
   * @param {client} client connection
   * @param {done} callback function(err) {}
   */
  sendMessage : function(client, done) {
    console.log('--------------send msg');
    client.emit('msg', {msgId: 'test_insert', storage: 0, data:['sssssssssssssssssssssssssssssssssssssssssssssss']});
    client.emit('msg', {msgId: 'test_update', storage: 1, data:['-----------------------------------------------']});
    // Example:
    // client.emit('test', { hello: 'world' });
    // client.publish('/test', { hello: 'world' });
    // client.call('com.myapp.add2', [2, 3]).then(function (res) { });
    done();
  },

  /**
   * WAMP connection options
   */
  options : {
    // realm: 'chat'
  }
};