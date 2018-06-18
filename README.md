# Always Online
always online offers an realtime message sync service which is based on socket.io.
## Feature
* Realtime message sync, only support broadcast in room right now
* Support message storage, which use redis as memory database
* Support Android/iOS/Web/WeChat mini program, which is benifit from socket.io
* Support cluster using redis sub/pub feature

## Dependencies
* socket.io
* redis

## Usage
* Install npm dependencies

	```
	cd always-online
	npm install
	```
* Install redis (Mac users)

	```
	brew install redis
	```
* Start redis server

	```
	redis-server
	```
* Put auth account at redis

	```
	redis-cli
	set {uid} {token} //example: set 123456 123456
	```

## Client Side Protocols
* authenticate

	```
	{uid: 1000, token: xxxx}
	```
* join

	```
	{roomId: 1000}
	```
* remoteJoin

	```
	{uid: 1000}
	```
* msg

	```
	{data: any data, type: xxx, tag: yyy}
	```
* leave

	```
	no data needed, just emit command
	```
* remoteLeave

	```
	{uid: 2000}
	```
* remoteDisconnect

	```
	{uid: 2000}
	```
* sync

	```
	Request: {type: [xxx], tag: [yyyy], page: 0}
	Response: {total:1000, pageSize:200, page: 1, data: []}
	```

Example [javascript]

```
var socket = io();
socket.on('connect', function() {
  socket.emit('authenticate', {uid:'123456', token:'123456'});
});

socket.on('authenticate', function(msg) {
  if (msg.status == 0) {
    socket.emit('join', {roomId: 1000})
  } else {
    console.log('auth failed')
  }
});

socket.on('join', function(msg) {
  if (msg.status == 0) {
    socket.emit('sync', {page: 0});
  }
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
```
