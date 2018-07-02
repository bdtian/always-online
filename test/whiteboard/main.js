'use strict';

(function() {
  var ready = true;
  var socket;
  var socket_init = function(url, uid, token, roomId) {
    url = url || 'ws://localhost:3000?transport=websocket';
    socket = io.connect(url, {transports: ['websocket']});
    socket.on('connect', function() {
      socket.emit('authenticate', {uid: uid, token: token});
    });
  
    socket.on('authenticate', function(msg) {
      if (msg.status == 0) {
        console.log('auth success')
        socket.emit('join', {roomId: roomId})
      } else {
        console.log('auth failed')
      }
    });
  
    socket.on('join', function(msg) {
      if (msg.status == 0) {
        console.log('join success');
        document.getElementById('login').style.display = 'none';
        document.getElementById('whiteboard').style.display = '';
        socket.emit('sync', {offset: 0});
      } else {
        console.log('join failed');
      }
    });
  
    socket.on('sync', function(msg) {
      for (var idx in msg.data) {
        var data = msg.data[idx];
        if (data.msgId == 'move') {
          onDrawingEvent(data.data.points);
        }
      }
  
      if (msg.next) {
        socket.emit('sync', {offset: msg.offset});
      } else {
        console.log('sync finish');
      }
    });
  
    socket.on('remoteJoin', function(msg) {
      console.log('remote join uid:', msg.uid);
    });
  
  
    socket.on('remoteLeave', function(msg) {
      console.log('remote leave uid:', msg.uid);
    });
  
    socket.on('msg', function(msg) {
      if (msg.msgId == 'move') {
        onDrawingEvent(msg.data.points);
      }
    });
  
    socket.on('kickout', function(msg) {
      console.log('kickout');
    });
  }

  document.getElementById('btn_login').addEventListener('click', function(e) {
    var uid = document.getElementById('uid').value;
    var token = document.getElementById('token').value;
    var url = document.getElementById('url').value;
    var roomId = document.getElementById('roomId').value;
    socket_init(url, uid, token, roomId);
  });
  
  var canvas = document.getElementsByClassName('whiteboard')[0];
  var colors = document.getElementsByClassName('color');
  var context = canvas.getContext('2d');

  var current = {
    color: 'black'
  };
  var drawing = false;

  canvas.addEventListener('mousedown', onMouseDown, false);
  canvas.addEventListener('mouseup', onMouseUp, false);
  canvas.addEventListener('mouseout', onMouseUp, false);
  canvas.addEventListener('mousemove', throttle(onMouseMove, 10), false);

  for (var i = 0; i < colors.length; i++){
    colors[i].addEventListener('click', onColorUpdate, false);
  }

  window.addEventListener('resize', onResize, false);
  onResize();


  function drawLine(x0, y0, x1, y1, color, emit){
    console.log(x0, y0, x1, y1);
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
    context.closePath();

    if (!emit) { return; }
    var w = canvas.width;
    var h = canvas.height;
    if (socket) {
      socket.emit('msg', {
        msgId: 'move',
        storage: 0,
        data: {
          msgId: 'move',
          points: {
            x0: x0 / w,
            y0: y0 / h,
            x1: x1 / w,
            y1: y1 / h,
            color: color  
          }
        }
      });  
    }
  }

  function onMouseDown(e){
    if (!ready) {
      return;
    }
    drawing = true;
    current.x = e.clientX;
    current.y = e.clientY;
  }

  function onMouseUp(e){
    if (!drawing) { return; }
    drawing = false;
    drawLine(current.x, current.y, e.clientX, e.clientY, current.color, true);
  }

  function onMouseMove(e){
    if (!drawing) { return; }
    drawLine(current.x, current.y, e.clientX, e.clientY, current.color, true);
    current.x = e.clientX;
    current.y = e.clientY;
  }

  function onColorUpdate(e){
    current.color = e.target.className.split(' ')[1];
  }

  // limit the number of events per second
  function throttle(callback, delay) {
    var previousCall = new Date().getTime();
    return function() {
      var time = new Date().getTime();

      if ((time - previousCall) >= delay) {
        previousCall = time;
        callback.apply(null, arguments);
      }
    };
  }

  function onDrawingEvent(data){
    var w = canvas.width;
    var h = canvas.height;
    drawLine(data.x0 * w, data.y0 * h, data.x1 * w, data.y1 * h, data.color);
  }

  // make the canvas fill its parent
  function onResize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

})();
