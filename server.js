// server.js (updated)
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFile } from "music-metadata";
import multer from "multer";
import { exec } from "child_process"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = 8080;
const MUSIC_DIR = path.join(__dirname, "music");

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 }
});


app.use(express.static(path.join(__dirname, "public")));

// Get metadata for all songs
app.get("/api/songs", async (req, res) => {
    try {
        const files = fs.readdirSync(MUSIC_DIR)
            .filter(f => {
                const ext = f.toLowerCase();
                return ext.endsWith(".mp3") || ext.endsWith(".flac") || ext.endsWith(".m4a") || ext.endsWith(".wav") || ext.endsWith(".aac");
            });

        const songs = await Promise.all(files.map(async (file) => {
            const filePath = path.join(MUSIC_DIR, file);
            let metadata = {};
            try {
                metadata = await parseFile(filePath);
            } catch (err) {
                console.warn(`Failed to parse metadata for ${file}:`, err.message || err);
                metadata = {};
            }

            const common = metadata.common || {};
            const { title, artist, album } = common;

            // artwork

            let artBase64 = null;
            if (common?.picture?.[0]) {
                const pic = common.picture[0];
                const buf = Buffer.isBuffer(pic.data) ? pic.data : Buffer.from(pic.data);
                const fmt = pic.format || "jpeg";
                const mime = fmt.startsWith("image/") ? fmt : `image/${fmt}`;
                const b64 = buf.toString("base64");
                artBase64 = `data:${mime};base64,${b64}`;
            }

            /*
            // artwork: return URL instead of base64
            let artworkUrl = null;
            if (common?.picture?.[0]) {
                artworkUrl = `/artwork/${encodeURIComponent(file)}`;
            }
            */


            // duration (seconds, may be fractional). Fallback 0 if unavailable.
            const duration = metadata.format && isFinite(metadata.format.duration) ? metadata.format.duration : 0;

            return {
                filename: file,
                title: title || path.parse(file).name,
                artist: artist || "Unknown Artist",
                album: album || "Unknown Album",
                artwork: artBase64, // either data:<mime>;base64,<b64> or null
                //artwork: artworkUrl,
                duration, // seconds (float)
            };
        }));

        res.json(songs);
    } catch (err) {
        console.error("Error building songs list:", err);
        res.status(500).json({ error: "Failed to list songs" });
    }
});

// Stream a song (supports Range requests)
app.get("/stream/:filename", (req, res) => {
    const filePath = path.join(MUSIC_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).end("File not found");
    }
    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (!range) {
        res.writeHead(200, { "Content-Length": stat.size, "Content-Type": "audio/mpeg" });
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "audio/mpeg",
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
});


// Example: expose /artwork/:filename which returns artwork bytes (or 404 if none)
app.get('/artwork/:filename', async (req, res) => {
    const file = req.params.filename;
    const filePath = path.join(MUSIC_DIR, file);
    if (!fs.existsSync(filePath)) return res.status(404).end();

    try {
        const metadata = await parseFile(filePath);
        const pic = metadata.common?.picture?.[0];
        if (!pic) return res.status(404).end();
        const buf = Buffer.isBuffer(pic.data) ? pic.data : Buffer.from(pic.data);
        const mime = pic.format && pic.format.startsWith('image/') ? pic.format : 'image/jpeg';
        res.setHeader('Content-Type', mime);
        res.send(buf);
    } catch (e) {
        res.status(500).end();
    }
});

app.post(
  '/api/edit-metadata',
  upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const audio = req.files.audio[0];
      const cover = req.files.cover?.[0];

      const { title, artist, album } = req.body;

      const ext = path.extname(audio.originalname);
      const outputName = `${Date.now()}_${audio.originalname}`;
      const outputPath = path.join('outputs', outputName);

      let cmd = `ffmpeg -y -i "${audio.path}"`;

      // album art
      if (cover) {
        cmd += ` -i "${cover.path}" -map 0:a -map 1:v`;
        cmd += ` -c copy`;
        cmd += ` -disposition:v attached_pic`;
      } else {
        cmd += ` -c copy`;
      }

      // metadata
      if (title) cmd += ` -metadata title="${title}"`;
      if (artist) cmd += ` -metadata artist="${artist}"`;
      if (album) cmd += ` -metadata album="${album}"`;

      cmd += ` "${outputPath}"`;

      exec(cmd, err => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'FFmpeg failed' });
        }

        fs.unlink(audio.path, () => {});
        if (cover) fs.unlink(cover.path, () => {});

        res.json({
          downloadUrl: `/download/${outputName}`
        });
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Metadata edit failed' });
    }
  }
);


app.get('/download/:file', (req, res) => {
  const filePath = path.join(__dirname, 'outputs', req.params.file);

  res.download(filePath, err => {

    if (err) {
        console.error("Download error:", err);
        return;
    }

    fs.unlink(filePath, () => {});
  });
});



app.listen(PORT, () => console.log(`🎵 Server running at http://localhost:${PORT}`));

