const http = require("http");
const fs = require('fs');
const WebSocket = require("ws").Server;
const openradio = require("openradio");
const radio = openradio();
const ytdl = require("ytdl-core");
let playing = false;
let url = process.argv.slice(2)[0] || fs.readFileSync("yturl.txt", 'utf8');

// Query
let curSong = {
  name: null,
  id: null,
  rv: null
};

let nextSong = {
  name: null,
  id: null
}

// Sink management
let wsClient = new Map();

// Server

let repeater = openradio.repeater(radio);
let server = http.createServer(function(req, res) {
  res.setHeader("content-type", "audio/mpeg");
  if (req.method === "HEAD") return res.end();
  repeater(res);
});

server.listen(process.env.PORT || 8080, () => launch());
server.on('error', console.error);

// Websocket, for Song name information
let wss = new WebSocket({ server });

wss.on('connection', (ws, req) => {
  let id = Math.random().toString(36).slice(2);
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
let launch = function() {
  if (!url || url.length < 1) {
    console.error("No youtube URL provided. Aborting....");
    return process.exit(1);
  } else {
    console.log('Radio is now listening on port', process.env.PORT || 8080);
    return play();
  }
};

let play = function() {
  if (playing) return false;
  if (nextSong.id) {
    url = `https://youtu.be/${nextSong.id}`;
    fs.writeFileSync('yturl.txt', url, 'utf8');
  } else if (!nextSong.id && curSong.id) {
    nextSong.id = curSong.id;
  }
  let stream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio' });
  stream.on('info', async function(info) {
    curSong.name = info.videoDetails.title;
    curSong.id = info.videoDetails.id;
    curSong.rv = info.related_videos;
    nextSong.id = curSong.rv.shift().id;
    nextSong.name = curSong.rv.shift().title;
    // Then broadcast it
    radio.play(stream);
    wss.broadcast(curSong.name);
    console.log('-> Now Playing:', curSong.name);
    console.log('   Next:', nextSong.name);
    playing = true;
  });

  stream.on('error', (e) => {
  	console.error(e);
  	play();
  });
};

radio.on('finish', () => {
	playing = false;
	play();
});

radio.on('error', (e) => {
	playing = false;
	console.error(e);
	play();
});

console.log("Press enter to change Next query, Or type \"next\" to skip the current song.\n");
console.log("Available commands: next, setnext");
process.stdin.on('data', (d) => {
	d = d.toString('utf8');
	let args = d.split(" ").slice(1);
	if (!radio.stream) return;
	if (d.startsWith("next")) {
		console.log("-  Skipping....");
		playing = false
		return play();
	} else if (d.startsWith("setnext")) {
		if (!args.length) return console.log("-  Usage: setnext [youtube-video-url]");
		nextSong.id = ytdl.getVideoID(args[0]);
		return console.log("-  OK.");
	}

	if (!curSong.rv.length)
		return console.log("-  Out of query. Song will looped.");

	nextSong.id = curSong.rv.shift().id;
	nextSong.name = curSong.rv.shift().title;
	console.log("-  Next:", nextSong.name);
});
