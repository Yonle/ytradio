const miniget = require("miniget");
const stream = require("stream");

function clearListener(s, events = ["response", "error", "data", "end"]) {
  events.forEach(i => s.removeAllListeners(i));
}

function getSize(url, opt) {
  return new Promise((resolv, reject) => {
    let req = miniget(url, opt)
      .on("response", (res) => {
        req.destroy();
        resolv(res.headers["content-length"]);
      })
      .on("error", reject);
  });
}

function getChunk(beginRange, dup, streamingData, streamSize, sentSize = 0, lastConnErr = 0, headers = {}) {
  beginRange = parseInt(beginRange);

  let endRange = beginRange + parseInt(process.env.DLCHUNKSIZE || 1024 * 1024);
  if (endRange >= streamSize)
    endRange = "";

  headers.Range = `bytes=${beginRange}-${endRange}`;

  const s = miniget(streamingData.url, { headers })
    .on("response", (r) =>
      lastConnErr = 0
    )

    .on("error", (err) => {
      clearListener(s);
      console.error(err);
      if (
        dup.destroyed ||
        dup.ended
      )
        return;
      if (
        lastConnErr > 3 ||
        sentSize >= streamSize ||
        sentSize >= streamingData.content_length ||
        beginRange >= endRange
      )
        return dup.end();
      lastConnErr++;
      getChunk(beginRange + sentSize + 1, dup, streamingData, streamSize, sentSize, lastConnErr, headers);
    })

    .on("data", (c) => {
      if (
        dup.destroyed ||
        dup.ended
      ) {
        clearListener(s);
        return s.destroy();
      }
      dup.write(c);
      sentSize += c.length;
    })
    .on("end", (_) => {
      clearListener(s);
      if (
        dup.destroyed ||
        dup.ended
      )
        return;
      if (sentSize >= streamSize) {
        return dup.end();
      }

      getChunk(endRange + 1, dup, streamingData, streamSize, sentSize, lastConnErr, headers);
    });
}

module.exports = async function download(streamingData) {
  let dup = new stream.PassThrough();
  let size = await getSize(streamingData.url);

  getChunk(
    0, // Range begin from 0
    dup, // Duplex stream
    streamingData, // Streaming data
    size // Download size
  );

  dup.on('end', () => dup.destroy());

  return dup;
}
