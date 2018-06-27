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
* Start Server

	```
	cd always-online
	node index.js all
	```

## Rest API for account
Need called from business server to register account for security.

Status Code:

```
var errMsg = {
  0: 'success',
  1: 'user exists',
  2: 'operation failed',
  3: 'server error',
  4: 'param error',
  5: 'user not exists'
};

```
### create_token

```
http://{hostname}:4000/user/create_token

Method: POST

Request:
{uid: '1000'}

Response:
{status: 0, uid: '1000', token: 'xxxxxx'}

```
### refresh_token

```
http://{hostname}:4000/user/refresh_token

Method: POST

Request:
{uid: '1000'}

Response:
{status: 0, uid: '1000', token: 'xxxxxx'}

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
Status Code

```
0: success, other: failed
```

* authenticate

	```
	Request:
	{uid: 1000, token: xxxx}
	Response:
	{status: 0, data: 'auth success'}
	```
* join

	```
	Request:
	{roomId: 1000}
	Response:
	{status: 0, data: 'xxxx'}
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

## Monitor API
use those api to debug

### stat

```
http://{hostname}:3000/admin/monitor/stat?uid=xxx&token=xxx

Method: GET

Request:
uid: xxx
token: xxxx

Response:
{status: 0, data: {online_user_count: 2, online_room_count: 1}}
```
### room_users

```
http://{hostname}:3000/admin/monitor/room_users?roomId=xxx&uid=xxx&token=xxx

Method: GET

Request:
uid: xxx
token: xxxx
roomId: xxxx

Response:
{status: 0, data: [{uid: xxx}, {uid: xxx}]}
```
### room_msgs

```
http://{hostname}:3000/admin/monitor/room_msgs?roomId=xxx&uid=xxx&token=xxx

Method: GET

Request:
uid: xxx
token: xxxx
roomId: xxxx

Response:
{"status":0,"data":{"data":[{"data":{"data":"4444","storage":1,"msgId":"touch_begin"},"ts":1530009108,"uid":"4000"}],"offset":1,"next":0}}
```
