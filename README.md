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
redis-server
```
* Put auth account at redis

```
redis-cli
set {uid} {token}
```

## Client Side Protocols
* authenticate

	```
	{uid: 1000, token: xxxx}
	```
	js example:

	```
	socket.emit('authenticate', {uid:'123456', token:'123456'});
	```
* join

	```
	{roomId: 1000}
	```
	js example:

	```
	socket.emit('join', {roomId: 1000})
	```

* msg

	```
	{data: any data, type: xxx, tag: yyy}
	```
	js example:

	```
	socket.emit('msg', 	{data: any data, type: xxx, tag: yyy})
	```

* leave

	```
	no data needed, just emit command
	```
	js example:

	```
	socket.emit('leave', 0)
	```

* sync

	```
	Request: {type: [xxx], tag: [yyyy], page: 0}
	Response: {total:1000, pageSize:200, page: 1, data: []}
	```
	js example:

	```
	socket.emit('sync', {page: 0});
	```

