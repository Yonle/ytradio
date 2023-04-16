const http = require("http");
const fs = require('fs');
const WebSocket = require("ws").Server;
const openradio = require("openradio");
const miniget = require("miniget");
const radio = openradio({
  format: "mp3",
  bitrate: 128
});

const YouTube = require("youtubei.js");

let client = null;
let curSong = null;

let url = process.argv.slice(2)[0] || fs.readFileSync("yturl.txt", 'utf8');

// Query
let playlist = [];

// Sink management
let wsClient = new Map();

// Server

let repeater = openradio.repeater(radio);
let server = http.createServer(function(req, res) {
  res.setHeader("content-type", "audio/mpeg");
  if (req.method === "HEAD") return res.end();
  repeater(res);
  res.on('error', console.error);
});

YouTube.Innertube.create().then(a => {
  client = a;
  server.listen(process.env.PORT || 8080, () => launch());
  server.on('error', console.error);
});

// Websocket, for Song name information
let wss = new WebSocket({ server });

wss.on('connection', (ws, req) => {
  let id = Math.random().toString(36).slice(2);
  wsClient.set(id, ws);
  if (curSong) ws.send(`${curSong.basic_info.author} - ${curSong.basic_info.title}`);
  req.on('close', function() {
    wsClient.delete(id);
  });
});

wss.broadcast = (function(data) {
  console.log("-- Now Playing:", data);
  wsClient.forEach(function(ws, id) {
    ws.send(data, function(error) {
      if (error) {
        wsClient.delete(id);
      }
    });
  });
});

function getVideoID(url) {
  let u = new URL(url);
  if (u.hostname === "youtu.be") return u.pathname.slice(1);
  if (u.searchParams.has("v")) return u.searchParams.get("v");
}

function getURL(song) {
  let streamingData = song.streaming_data.adaptive_formats
    .filter(i => !i.has_video && i.has_audio)
    .pop();
  return streamingData.decipher(client.session.player);
}

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

let play = async function() {
  if (!curSong && !playlist.length && url) {
    let song = await client.music.getInfo(getVideoID(url));
    playlist = (await song.getUpNext()).contents;
  }

  if (!playlist.length) {
    playlist = (await curSong.getUpNext()).contents;
  }

  let song = await client.music.getInfo(playlist.shift().video_id);
  radio.play(miniget(getURL(song)));
  wss.broadcast(`${song.basic_info.author} - ${song.basic_info.title}`);
  console.log("   Up next:", `${playlist[0].author} - ${playlist[0].title.text}`);
  curSong = song;

  fs.writeFileSync("yturl.txt", "https://youtu.be/" + song.basic_info.id, "utf8");
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
