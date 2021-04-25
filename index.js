const http = require("http");
const fs = require('fs');
const WebSocket = require("ws").Server;
const openradio = require("openradio");
const radio = openradio();
const ytdl = require("ytdl-core");
var playing = false;
// null = Random
// Max: 18
// Default: null / 3 is recommended
var random_query_length = null;

var url = process.argv.slice(2)[0] || fs.readFileSync("yturl.txt", 'utf8');

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
var wsClient = new Map();

// Server

var server = http.createServer(function(req, res) {
  var id = Math.random().toString(36).slice(2);
  res.setHeader("content-type", "audio/mpeg");
  if (req.method === "HEAD") return res.end();
  radio.pipe(res);
});

server.listen(8080, () => launch());
server.on('error', console.error);

// Websocket, for Song name information
var wss = new WebSocket({ server });

wss.on('connection', (ws, req) => {
  var id = Math.random().toString(36).slice(2);
  wsClient.set(id, ws);
  if (curSong.name != null) ws.send(curSong.name);
  req.on('close', function() {
    wsClient.delete(id);
  });
});

wss.broadcast = (function(data) {
  wsClient.forEach(function(ws, id) {
    ws.send(data, function(error) {
      if (error) {
        wsClient.delete(id);
      }
    });
  });
});

// Player
var launch = function() {
  if (!url || url.length < 1) {
    console.error("No youtube URL provided. Aborting....");
    return process.exit(1);
  } else {
    console.log('Radio is now listening on port', 8080);
    return play();
  }
};

var play = function() {
  if (playing) return false;
  if (nextSong.id) {
    url = `https://youtu.be/${nextSong.id}`;
    fs.writeFileSync('yturl.txt', url, 'utf8');
  }
  var stream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio' });
  stream.on('info', async function(info) {
    var randomQuery = Math.floor(Math.random() * (random_query_length || info.related_videos.length));
    curSong.name = info.videoDetails.title;
    curSong.id = info.videoDetails.id;
    nextSong.id = info.related_videos[randomQuery].id;
    nextSong.name = info.related_videos[randomQuery].title;
    // Then broadcast it
    radio.play(stream);
    wss.broadcast(curSong.name);
    console.log('-> Now Playing:', curSong.name);
    playing = true;
  });

  stream.on('error', (e) => {
  	console.error(e);
  	playing = false;
  	play();
  });
};

radio.on('end', () => {
	playing = false;
	play();
});
radio.on('error', (e) => {
	console.error(e);
	play();
});

process.stdin.on('data', () => {
	if (!radio.stream) return;
	playing = false;
	play();
});
