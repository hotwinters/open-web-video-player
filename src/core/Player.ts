import { EventEmitter } from './EventEmitter';
import { HLSHandler } from '../handlers/HLSHandler';
import { FLVHandler } from '../handlers/FLVHandler';
import { WebRTCHandler } from '../handlers/WebRTCHandler';
import { NativeRenderer } from '../renderers/NativeRenderer';
import type {
  PlayerConfig,
  StreamOptions,
  PlayerStats,
  IPlayer,
  IHandler,
  IRenderer,
  StreamMetadata,
} from './types';

const CACHE_VERSION = 1;
const DB_NAME = 'owvp-ffmpeg-cache';

let cacheDB: IDBDatabase | null = null;

function openCacheDB(): Promise<IDBDatabase> {
  if (cacheDB) return Promise.resolve(cacheDB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, CACHE_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs');
      }
    };
    req.onsuccess = () => {
      cacheDB = req.result;
      cacheDB.onclose = () => { cacheDB = null; };
      cacheDB.onversionchange = () => { cacheDB?.close(); cacheDB = null; };
      resolve(cacheDB);
    };
    req.onerror = () => reject(req.error);
  });
}

async function getCachedBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openCacheDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('blobs', 'readonly');
      const store = tx.objectStore('blobs');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function storeBlobInCache(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openCacheDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('blobs', 'readwrite');
      const store = tx.objectStore('blobs');
      store.put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
  }
}

let ffmpegPreloadPromise: Promise<void> | null = null;
let ffmpegCachedJS: Blob | null = null;
let ffmpegCachedWasm: Blob | null = null;

export const preloadProgress = { loaded: 0, total: 0 };

const PRELOAD_TIMEOUT = 15000;

async function ensureFFmpegLoaded(): Promise<void> {
  if (ffmpegPreloadPromise) return ffmpegPreloadPromise;

  ffmpegPreloadPromise = (async () => {
    try {
      const [cachedJS, cachedWasm] = await Promise.all([
        getCachedBlob('ffmpeg-core.js'),
        getCachedBlob('ffmpeg-core.wasm'),
      ]);

      if (cachedJS && cachedWasm) {
        ffmpegCachedJS = cachedJS;
        ffmpegCachedWasm = cachedWasm;
        markPreloadDone();
        return;
      }

      const base = 'https://unpkg.com/@ffmpeg/core@0.12.9/dist/esm';
      await Promise.race([
        (async () => {
          const [jsResp, wasmResp] = await Promise.all([
            fetch(base + '/ffmpeg-core.js').catch(function () { return fetch('/ffmpeg/ffmpeg-core.js'); }),
            fetch(base + '/ffmpeg-core.wasm').catch(function () { return fetch('/ffmpeg/ffmpeg-core.wasm'); }),
          ]);
          ffmpegCachedJS = await jsResp.blob();
          ffmpegCachedWasm = await wasmResp.blob();
          await Promise.all([
            storeBlobInCache('ffmpeg-core.js', ffmpegCachedJS),
            storeBlobInCache('ffmpeg-core.wasm', ffmpegCachedWasm),
          ]);
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Preload timeout')), PRELOAD_TIMEOUT)),
      ]);

      markPreloadDone();
    } catch (err) {
      console.warn('[ffmpeg.wasm] Preload failed:', err);
      ffmpegPreloadPromise = null;
      markPreloadDone();
    }
  })();

  return ffmpegPreloadPromise;
}

function markPreloadDone(): void {
  preloadProgress.total = 1;
  preloadProgress.loaded = 1;
}

function getBlobURLs(): { coreURL: string; wasmURL: string } | null {
  if (!ffmpegCachedJS || !ffmpegCachedWasm) return null;
  const coreURL = URL.createObjectURL(new Blob([ffmpegCachedJS], { type: 'text/javascript' }));
  const wasmURL = URL.createObjectURL(new Blob([ffmpegCachedWasm], { type: 'application/wasm' }));
  return { coreURL, wasmURL };
}

ensureFFmpegLoaded().catch(() => {});

export class Player extends EventEmitter implements IPlayer {
  private config: PlayerConfig;
  private container: HTMLElement;
  private handler: IHandler | null = null;
  private renderer: IRenderer | null = null;
  private metadata: StreamMetadata | null = null;
  private stats: PlayerStats;
  private volume: number = 1;
  private _wasmSwitched: boolean = false;
  private _metadataReceived: boolean = false;


  constructor(config: PlayerConfig) {
    super();
    const defaults: PlayerConfig = {
      container: config.container,
      autoPlay: false,
      rendererPreference: 'auto',
      showStats: false,
      showControls: true,
      autoReconnect: true,
    };
    this.config = { ...defaults, ...config };

    const container = typeof config.container === 'string'
      ? (document.querySelector(config.container) as HTMLElement | null)
      : config.container as HTMLElement | null;

    if (!container) {
      throw new Error('Container element not found');
    }
    this.container = container;

    this.stats = {
      fps: 0,
      bitrate: 0,
      droppedFrames: 0,
      bufferSize: 0,
      latency: 0,
      memoryUsed: 0,
      codec: 'h264',
      renderer: 'native',
      isPlaying: false,
      isStalled: false,
    };

    this.initUI();
  }

  private initUI(): void {
    this.container.innerHTML = [
      '<div class="owvp-container">',
      '  <div class="owvp-video-wrapper"></div>',
      '</div>'
    ].join('\n');
  }

  async load(url: string, options?: StreamOptions): Promise<void> {
    this.cleanup();
    this._metadataReceived = false;

    this.renderer = new NativeRenderer();
    await this.renderer.init(this.container);

    const video = (this.renderer as NativeRenderer).getVideoElement();

    if (video) {
      video.addEventListener('loadedmetadata', () => {
        console.log('Video metadata loaded');
      });
      video.addEventListener('canplay', () => {
        console.log('Video can play');
      });
      video.addEventListener('playing', () => {
        console.log('Video playing');
      });
      video.addEventListener('waiting', () => {
        console.log('Video waiting');
      });
      video.addEventListener('stalled', () => {
        console.log('Video stalled');
      });
      video.addEventListener('error', (e) => {
        console.error('Video error:', e);
        this.emit('error', new Error('Video element error'));
      });

      video.style.backgroundColor = '#000';
      video.style.display = 'block';
    }

    const streamType = options?.type || 'hls';
    switch (streamType) {
      case 'flv':
        this.handler = new FLVHandler();
        if (video) {
          (this.handler as FLVHandler).attachMediaElement(video);
        }
        await this.handler.connect(url, { codec: options?.codec });
        break;

      case 'webrtc':
        this.handler = new WebRTCHandler();
        if (video) {
          (this.handler as WebRTCHandler).setVideoElement(video);
        }
        await this.handler.connect(url);
        break;

      default:
        this.handler = new HLSHandler();
        if (video) {
          (this.handler as HLSHandler).attachMediaElement(video);
        }
        await this.handler.connect(url, {
          preferLowLatency: options?.preferLowLatency,
          autoReconnect: this.config.autoReconnect,
          codec: options?.codec,
        });
        break;
    }

    if (this.handler) {
      this.handler.onMetadata(async (metadata) => {
        try {
          if (this._metadataReceived) return;
          this._metadataReceived = true;

          console.log('Received metadata:', metadata);
          this.metadata = metadata;
          this.stats.codec = metadata.codec;

          if (metadata.codec === 'h265' && !this._wasmSwitched) {
            this._wasmSwitched = true;
            console.log('[ffmpeg.wasm] Calling switchToWasmRenderer...');
            await this.switchToWasmRenderer();
            console.log('[ffmpeg.wasm] switchToWasmRenderer completed');
          } else if (metadata.codec === 'h264') {
            this.stats.renderer = 'native';
            if (!this._wasmSwitched) {
              this._wasmSwitched = true;
            }
          }
          this.emit('load', { url, type: streamType, codec: metadata.codec });
        } catch (e) {
          console.error('[ffmpeg.wasm] metadata callback error:', e);
          this.emit('error', e instanceof Error ? e : new Error(String(e)));
        }
      });
    }

    if (this.config.autoPlay) {
      this.play();
    }
  }

  async switchToWasmRenderer(): Promise<void> {
    if (this.renderer) {
      const oldRenderer = this.renderer;
      if (oldRenderer instanceof NativeRenderer) {
        const video = oldRenderer.getVideoElement();
        if (video) {
          video.style.display = 'none';
          video.muted = true;
          video.style.position = 'absolute';
          video.style.opacity = '0';
          video.style.pointerEvents = 'none';
          console.log('[ffmpeg.wasm] Hidden native video, keeping alive for hls.js');
        }
      }
    }

    console.log('[ffmpeg.wasm] Switching to WasmRenderer - importing module...');
    const { WasmRenderer } = await import('../renderers/WasmRenderer');
    console.log('[ffmpeg.wasm] WasmRenderer imported, creating instance...');
    const wasmRenderer = new WasmRenderer();

    console.log('[ffmpeg.wasm] Initializing WasmRenderer...');
    const w = this.metadata?.width || 1280;
    const h = this.metadata?.height || 720;
    await ensureFFmpegLoaded();
    const preloaded = getBlobURLs();
    await wasmRenderer.init(this.container, w, h, preloaded || undefined);
    console.log('[ffmpeg.wasm] WasmRenderer initialized successfully');

    if (this.handler) {
      this.handler.onData((data: ArrayBuffer) => {
        console.log('[ffmpeg.wasm] Received ' + data.byteLength + ' bytes from handler, feeding to WasmRenderer');
        wasmRenderer.render(data);
      });
    }

    this.renderer = wasmRenderer;
    this.stats.renderer = 'wasm';
  }

  private cleanup(): void {
    this._wasmSwitched = false;
    if (this.handler) {
      this.handler.disconnect();
      this.handler = null;
    }
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
  }

  play(): void {
    this.stats.isPlaying = true;
    const renderer = this.renderer;
    if (renderer instanceof NativeRenderer) {
      renderer.getVideoElement()?.play().catch(console.warn);
    }
    this.emit('play');
  }

  pause(): void {
    this.stats.isPlaying = false;
    const renderer = this.renderer;
    if (renderer instanceof NativeRenderer) {
      renderer.getVideoElement()?.pause();
    }
    this.emit('pause');
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.renderer) {
      this.renderer.setVolume(this.volume);
    }
    this.emit('volume', this.volume);
  }

  getStats(): PlayerStats {
    return { ...this.stats };
  }

  destroy(): void {
    this.cleanup();
    this.emit('destroy');
    this.removeAllListeners();
  }
}

export default Player;
