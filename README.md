# Always Online
Always online is an realtime message sync service which is based on [socket.io](https://github.com/socketio/socket.io).
## Feature
* Realtime message sync, only support broadcast in room right now
* Support message storage, using redis as memory database
* Support Android/iOS/Web/WeChat mini program, which is benifit from socket.io open source project
* Support cluster and horizontal scalability, using redis sub/pub feature

## Dependencies
* socket.io
* redis
* mongodb

## Usage
* Install npm dependencies

	```
	cd always-online
	npm install
	```
* Install redis/mongodb (Mac users)

	```
	brew install redis
	brew install mongodb
	```
* Start redis/mongo server

	```
	redis-server
	mongod --dbpath {path}
	```
* Create Test Users

	```
	post {uid: 1000} to http://{hostname}:3000/user/create_token, token will be returned
	```

## Socket.io build in Message Protocol
Please refer [socket io client](https://github.com/socketio/socket.io-client/blob/master/docs/API.md#new-managerurl-options)

* connect
* connect_error
* connect_timeout
* error
* disconnect
* reconnect
* reconnect_attempt
* reconnecting
* reconnect_error
* reconnect_failed
* ping
* pong

## Custom Message Protocol
* authenticate

	```
	{uid: 1000, token: xxxx}
	```
* join

	```
	{roomId: 1000}
	```
* remote_join

	```
	{uid: 1000}
	```
* msg

	```
	{data: json-object, storage: 0|1|2, msgId: string or integer}
	0: insert
	1: update
	2: ignore
	```
* leave

	```
	no data needed, just emit command
	```
* remote_leave

	```
	{uid: 2000}
	```
* remote_disconnect

	```
	{uid: 2000}
	```
* sync

	```
	Request: {offset: 0}
	Response: {next: 1, offset: 500, data: []}
	next:
		0: no data to get
		1: has more data, need do sync with offset again until next is 0
	```
* remote_sync

	```
	{uid: 1000}
	```

### Example (javascript):

```
var socket = io('ws://localhost:3000');
socket.on('connect', function() {
  console.log('connect to server, and start auth');
  socket.emit('authenticate', {uid:'123456', token:'123456'});
});

socket.on('authenticate', function(msg) {
  if (msg.status == 0) {
	var roomId = 1000;
    console.log('auth success, and start join room: %d', roomId);
    socket.emit('join', {roomId: roomId})
  } else {
    console.log('auth failed')
  }
});

socket.on('join', function(msg) {
  if (msg.status == 0) {
	console.log('join success and start sync');
	socket.emit('sync', {offset: 0});
  } else {
	console.log('join failed');
  }
});

socket.on('sync', function(msg) {
	// handle msg
	if (msg.next == 1) {
		console.log('get more data, offset: %d', msg.offset);
		socket.emit('sync', {offset: msg.offset});
	} else {
		console.log('sync data finish');
	}
});

socket.on('remote_join', function(msg) {
  console.log('remote join uid:', msg.uid);
});

socket.on('remote_leave', function(msg) {
  console.log('remote leave uid:', msg.uid);
});

socket.on('kickout', function(msg) {
  console.log('kickout');
});

socket.on('disconnect', function(msg) {
  console.log('disconnect');
});

......

```
