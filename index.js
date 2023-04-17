const http = require("http");
const gopher = require("gopherserver.js")();
const fs = require('fs');
const WebSocket = require("ws").Server;
const openradio = require("openradio");
const download = require("./download");
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

let gopherServer = gopher();

gopherServer.on('request', soc => {
  if (!soc.url && soc.query === "$") return soc.destroy();

  repeater(soc);
});

let repeater = openradio.repeater(radio);
let server = http.createServer(function(req, res) {
  res.setHeader("content-type", "audio/mpeg");
  if (req.method === "HEAD") return res.end();
  const conn = repeater(res);
  res.on('error', err => {
    console.error(err);
    conn();
  });
});

YouTube.Innertube.create({ location: process.env.GEOLOCATION || "US" }).then(a => {
  client = a;
  server.listen(process.env.PORT || 8080, () => launch());
  gopherServer(process.env.GOPHER_PORT || 8081);
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

function getStreamingData(song) {
  let streamingData = song.streaming_data.adaptive_formats
    .filter(i => !i.has_video && i.has_audio)
    .pop();
  streamingData.url = streamingData.decipher(client.session.player);

  return streamingData;
}

// Player
let launch = function() {
  if (!url || url.length < 1) {
    console.error("No youtube URL provided. Aborting....");
    return process.exit(1);
  } else {
    console.log('Radio is now listening on port', process.env.PORT || 8080);
    console.log('Gopher server is now listening on port', process.env.GOPHER_PORT || 8081);
    return play();
  }
};

let play = async function() {
  try {
    if (!curSong && !playlist.length && url) {
      let song = await client.music.getInfo(getVideoID(url));
      playlist = (await song.getUpNext()).contents;
    }

    let song = await client.music.getInfo(playlist.shift().video_id);
    if (!playlist.length) {
      playlist = (await curSong.getUpNext()).contents;
    }

    if (song.playability_status.status !== "OK") {
      console.error(`-! "${song.basic_info.title}" could not be played.`);
      console.error(`   Reason: ${song.playability_status.reason}`);
      console.error('   Skipping....');
      return play();
    }

    radio.play(await download(getStreamingData(song)));
    wss.broadcast(`${song.basic_info.author} - ${song.basic_info.title}`);
    console.log("   Up next:", `${playlist[0].author} - ${playlist[0].title.text}`);
    curSong = song;

    fs.writeFileSync("yturl.txt", "https://youtu.be/" + song.basic_info.id, "utf8");

    if (!playlist.length) {
      playlist = (await curSong.getUpNext()).contents;
    }
  } catch (err) {
    console.error(err);
    play();
  }
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
