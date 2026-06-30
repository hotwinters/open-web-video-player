# open-web-video-player

Browser-based video player supporting HLS, HTTP-FLV, and WebRTC with H.264/H.265 codec. H.265 playback is powered by ffmpeg.wasm.

## Features

- **HLS** (.m3u8) — via hls.js
- **HTTP-FLV** (.flv) — via flv.js
- **WebRTC** — native RTCPeerConnection
- **H.265/HEVC** — automatic detection + ffmpeg.wasm decoding
- Auto-reconnect, low-latency HLS support

## Usage

```html
<div id="player" style="width: 640px; height: 360px;"></div>

<script type="module">
import { Player } from 'open-web-video-player';

const player = new Player({ container: '#player', autoPlay: true });
await player.load('https://example.com/stream.m3u8', { type: 'hls' });

player.on('load', ({ codec }) => console.log('Codec:', codec));
player.on('error', (err) => console.error(err));
</script>
```

## API

### `new Player(config)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `container` | `string \| HTMLElement` | required | CSS selector or element |
| `autoPlay` | `boolean` | `false` | Start playback immediately |
| `autoReconnect` | `boolean` | `true` | Auto-reconnect on disconnect |
| `showControls` | `boolean` | `true` | Show native controls |

### Methods

`load(url, options?)` — Load a stream (`{ type: 'hls'|'flv'|'webrtc', codec? }`)
`play()` / `pause()` / `setVolume(0-1)` / `getStats()` / `destroy()`

### H.265

When H.265 is detected, the player automatically downloads ffmpeg-core (31MB, cached in IndexedDB), intercepts stream data, decodes via ffmpeg.wasm, and renders to a `<canvas>`.

For streams that don't advertise H.265 in the manifest (e.g. ZLMediaKit), pass `{ codec: 'h265' }` in load options.

## Development

```bash
npm install
npm run dev      # dev server on :5173
npm run build    # production build to dist/
```

The dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` for SharedArrayBuffer support.
