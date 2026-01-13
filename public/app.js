// app.js (updated)
const songList = document.getElementById("songList");
const search = document.getElementById("search");
const sortBy = document.getElementById("sortBy");
const audio = document.getElementById("audio");
const titleEl = document.getElementById("title");
const artistEl = document.getElementById("artist");
const artworkEl = document.getElementById("artwork");

const playBtn = document.getElementById("play");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const progress = document.getElementById("progress");
const timeEl = document.getElementById("time");
const volumeEl = document.getElementById("volume");

const PREV_THRESHOLD = 3;

let songs = [];     // master array from server
let filtered = [];  // current filtered + sorted array shown in UI
let currentFilteredIndex = -1; // index into 'filtered' for currently playing song
let isSeeking = false;

// convenience: format seconds to M:SS
function formatTime(s) {
    if (!isFinite(s) || !s) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
}

async function loadSongs() {
    const res = await fetch("/api/songs");
    songs = await res.json();
    applyFiltersAndSort();
}

function applyFiltersAndSort() {
    const q = (search.value || "").toLowerCase();
    // start from master songs array so filtering is always across full dataset
    let base = songs.filter(s => {
        if (!q) return true;
        return (s.title || "").toLowerCase().includes(q) || (s.artist || "").toLowerCase().includes(q);
    });

    // sort
    const key = sortBy.value || "title";
    base.sort((a, b) => {
        const va = (a[key] || "").toString();
        const vb = (b[key] || "").toString();
        return va.localeCompare(vb, undefined, { sensitivity: "base" });
    });

    filtered = base;
    renderSongs();
}

function renderSongs() {
    songList.innerHTML = "";
    filtered.forEach((song, idx) => {
        const li = document.createElement("li");
        li.className = "song-item";

        const img = document.createElement("img");
        img.className = "song-art";
        img.src = song.artwork || "/default_art.png";
        img.alt = `${song.title} artwork`;

        const meta = document.createElement("div");
        meta.className = "song-meta";

        const t = document.createElement("div");
        t.className = "song-title";
        t.textContent = song.title;

        const a = document.createElement("div");
        a.className = "song-artist";
        a.textContent = song.artist;

        meta.appendChild(t);
        meta.appendChild(a);

        const dur = document.createElement("div");
        dur.className = "song-duration";
        dur.textContent = formatTime(song.duration || 0);

        li.appendChild(img);
        li.appendChild(meta);
        li.appendChild(dur);

        li.onclick = () => playFilteredIndex(idx);
        songList.appendChild(li);
    });
}


// --- Media Session integration (paste into app.js) ---

function updateMediaSessionForSong(song) {
    if (!('mediaSession' in navigator)) return;

    // Prepare artwork entries: prefer a real URL if you have one (recommended).
    // If your server returns inline data URIs in `song.artwork`, that's OK too.
    const artworkSrc = song.artwork || '/default_art.png';

    // supply multiple sizes if available — helps the OS pick the best resolution
    const artwork = [
        { src: artworkSrc, sizes: '96x96', type: 'image/png' },
        { src: artworkSrc, sizes: '128x128', type: 'image/png' },
        { src: artworkSrc, sizes: '192x192', type: 'image/png' },
        { src: artworkSrc, sizes: '512x512', type: 'image/png' }
    ];

    navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || 'Unknown Title',
        artist: song.artist || 'Unknown Artist',
        album: song.album || '',
        artwork
    });

    // Action handlers: tie into your existing playback functions.
    // Make sure playFilteredIndex, currentFilteredIndex, filtered[] are accessible.
    try {
        navigator.mediaSession.setActionHandler('play', () => audio.play());
        navigator.mediaSession.setActionHandler('pause', () => audio.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => {
            if (filtered.length === 0 || currentFilteredIndex < 0) return;

            if (audio.currentTime <= PREV_THRESHOLD) {
                playFilteredIndex(currentFilteredIndex - 1);
            } else {
                audio.currentTime = 0;
            }
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
            if (filtered.length && currentFilteredIndex >= 0) playFilteredIndex(currentFilteredIndex + 1);
        });

        // Seeking support (seekto is used by some system UIs, and seekforward/backward by media keys)
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const offset = details && details.seekOffset ? details.seekOffset : 10;
            // if the backward request would move us before the threshold, treat it as "previous track"
            if (audio.currentTime <= PREV_THRESHOLD || audio.currentTime - offset <= 0) {
                // If we're already very close to start, go previous; otherwise set to start
                if (audio.currentTime <= PREV_THRESHOLD) {
                    if (filtered.length && currentFilteredIndex >= 0) playFilteredIndex(currentFilteredIndex - 1);
                } else {
                    audio.currentTime = 0;
                }
            } else {
                audio.currentTime = Math.max(0, audio.currentTime - offset);
            }
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const offset = details && details.seekOffset ? details.seekOffset : 10;
            audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + offset);
        });
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details && typeof details.seekTime === 'number') audio.currentTime = details.seekTime;
        });
    } catch (err) {
        // Some browsers throw for unsupported handlers — ignore safely.
        console.warn("MediaSession handler registration failed:", err);
    }
}

// Update position state (progress) while playing
function updateMediaSessionPosition() {
    if (!('mediaSession' in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== 'function') return;

    // Some browsers require `duration` to be finite
    const duration = isFinite(audio.duration) ? audio.duration : (filtered[currentFilteredIndex]?.duration || 0);

    try {
        navigator.mediaSession.setPositionState({
            duration: duration || 0,
            playbackRate: audio.playbackRate || 1,
            position: audio.currentTime || 0
        });
    } catch (err) {
        // setPositionState can throw on unsupported contexts; ignore
        // console.warn("setPositionState failed:", err);
    }
}

// Hook the audio events to update media session info
audio.addEventListener('loadedmetadata', () => {
    // ensure media session knows duration
    updateMediaSessionPosition();
});

audio.addEventListener('timeupdate', () => {
    updateMediaSessionPosition();
});

// When you start playing a song (your playFilteredIndex), call updateMediaSessionForSong(song)
// e.g. inside playFilteredIndex after setting audio.src and updating UI:


function playFilteredIndex(i) {
    if (!filtered || filtered.length === 0) return;
    currentFilteredIndex = (i + filtered.length) % filtered.length;
    const song = filtered[currentFilteredIndex];

    audio.src = `/stream/${encodeURIComponent(song.filename)}`;
    audio.play().catch(err => console.warn("play() rejected:", err));

    titleEl.textContent = song.title;
    artistEl.textContent = song.artist;
    artworkEl.src = song.artwork || '/default_art.png';
    updatePlayButton();
    updateMediaSessionForSong(song);
}

// prev/next follow the filtered list
prevBtn.addEventListener("click", () => {
    if (filtered.length === 0 || currentFilteredIndex < 0) return;

    if (audio.currentTime <= PREV_THRESHOLD) {
        playFilteredIndex(currentFilteredIndex - 1);
    }
    else {
        audio.currentTime = 0;
    }
});
nextBtn.addEventListener("click", () => {
    if (filtered.length === 0 || currentFilteredIndex < 0) return;
    playFilteredIndex(currentFilteredIndex + 1);
});

// play/pause toggle
playBtn.addEventListener("click", () => {
    if (audio.paused) {
        audio.play();
    } else {
        audio.pause();
    }
    updatePlayButton();
});

function updatePlayButton() {
    if (audio.paused) {
        playBtn.classList.remove('playing');
        playBtn.classList.add('paused');
    } else {
        playBtn.classList.remove('paused');
        playBtn.classList.add('playing');
    }
    // accessibility fallback
    playBtn.textContent = audio.paused ? "▶" : "⏸";
}

// progress/time updates
audio.addEventListener("loadedmetadata", () => {
    // set progress max to duration if available
    progress.max = Math.floor(audio.duration) || 0;
    timeEl.textContent = `${formatTime(0)} / ${formatTime(audio.duration)}`;
});

audio.addEventListener("timeupdate", () => {
    if (!isSeeking) progress.value = Math.floor(audio.currentTime);
    timeEl.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    updatePlayButton();
    
    const percent = (audio.currentTime / audio.duration) * 100 || 0;
    progress.style.setProperty('--progress', `${percent}%`);

});

audio.addEventListener("ended", () => {
    if (filtered.length === 0 || currentFilteredIndex < 0) return;

    playFilteredIndex(currentFilteredIndex + 1);
})


// seek by dragging progress
progress.addEventListener("input", () => {
    isSeeking = true;
    timeEl.textContent = `${formatTime(progress.value)} / ${formatTime(audio.duration)}`;

    audio.currentTime = (((progress.value / 100) * audio.duration) / audio.duration) * 100 || 0;
    //console.log(audio.currentTime);
});
progress.addEventListener("change", () => {
    audio.currentTime = Number(progress.value);
    isSeeking = false;
});

// volume
volumeEl.addEventListener("input", () => {
    audio.volume = Number(volumeEl.value);
});

// keyboard: space toggles play/pause when player focused
document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        if (audio.paused) audio.play(); else audio.pause();
        updatePlayButton();
    }
});

// keep play button state in sync
audio.addEventListener("play", updatePlayButton);
audio.addEventListener("pause", updatePlayButton);

// wire search and sort controls
search.addEventListener("input", () => {
    applyFiltersAndSort();
});

sortBy.addEventListener("change", () => {
    applyFiltersAndSort();
});

// initial load
loadSongs();
