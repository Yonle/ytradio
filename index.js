const http = require("http");
const fs = require('fs');
const WebSocket = require("ws").Server;
const throttle = require("throttle");
const ffmpeg = require("prism-media").FFmpeg;
const ytdl = require("ytdl-core");

function convert() {
        return new ffmpeg({
                args: [
                '-analyzeduration', '0',
                '-loglevel', '0',
                '-f', 'mp3',
                '-ar', '48000',
                '-ac', '2'
                ]
        });
};

var url = fs.readFileSync("yturl.txt", 'utf8');

// Query
var curSong = {
	name: null,
	id: null
};

var nextSong = {
	name: null,
	id: null
}
// Sink management
var sink = new Map();
var wsClient = new Map();

// Server

var server = http.createServer(function (req, res) {
	var id = Math.random().toString(36).slice(2);
	res.setHeader("content-type", "audio/mpeg");
	res.setHeader("title", curSong.title || "No songs....");
	sink.set(id, res);

	req.on('close', function () {
		sink.delete(id);
	});
});

server.listen(8080, () => launch());
server.on('error', console.error);

server.broadcast = (function (data) {
	sink.forEach(function (res, id) {
		res.write(data, error => {
			if (error) {
				sink.delete(id);
			}
		});
	});
});

// Websocket, for Song name information
var wss = new WebSocket({ server });

wss.on('connection', (ws, req) => {
	var id = Math.random().toString(36).slice(2);
	wsClient.set(id, ws);
	if (curSong.name != null) ws.send(curSong.name);
	req.on('close', function () {
		wsClient.delete(id);
	});
});

wss.broadcast = (function (data) {
	wsClient.forEach(function (ws, id) {
		ws.send(data, function (error) {
			if (error) {
				wsClient.delete(id);
			}
		});
	});
});

// Player
var launch = function () {
	if (!url || url.length < 1) {
		console.error("No youtube URL provided. Aborting....")
		return prorcess.exit(1);
	} else { 
		console.log('Radio is now listening on port', 8080);
		return play();
	}
};

var play = function () {
	if (nextSong.id) {
		url = `https://youtu.be/${nextSong.id}`;
		fs.writeFileSync('yturl.txt', url, 'utf8');
	}
	var stream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio'});
	stream.on('info', async function (info) {
		title = info.videoDetails.title;
		nextSong.id = info.related_videos[Math.floor(Math.random() * info.related_videos.length)].id;
		nextSong.name = info.related_videos[Math.floor(Math.random() * info.related_videos.length)].title;
		// Convert into mp3
		audio = stream.pipe(convert());
		// Then broadcast it
		broadcast(audio, title);
	});
};

var broadcast = function (ReadStream, title) {
	stream = new throttle(128000 / 8);
	ReadStream.pipe(stream);
	wss.broadcast(title);
	console.log('-> Now Playing:', title);
	stream.on('data', server.broadcast);
	stream.on('end', play);
};
