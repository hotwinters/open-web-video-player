import Hls from 'hls.js';
import { EventEmitter } from '../core/EventEmitter';
import type { IHandler, StreamMetadata, HandlerOptions } from '../core/types';

export class HLSHandler extends EventEmitter implements IHandler {
  private hls: Hls | null = null;
  private metadata: StreamMetadata | null = null;
  private dataCallback: ((data: ArrayBuffer) => void) | null = null;
  private metadataCallback: ((metadata: StreamMetadata) => void) | null = null;
  private mediaElement: HTMLVideoElement | null = null;
  private isRawMode: boolean = false;
  private pendingFragments: ArrayBuffer[] = [];
  private fragmentHandlerRegistered: boolean = false;

  attachMediaElement(element: HTMLVideoElement): void {
    this.mediaElement = element;
    if (this.hls) {
      this.hls.attachMedia(element);
    }
  }

  detachMediaElement(): Promise<void> {
    return Promise.resolve();
  }

  async connect(url: string, options?: HandlerOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!Hls.isSupported()) {
        reject(new Error('HLS is not supported in this browser'));
        return;
      }

      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: options?.preferLowLatency || false,
      });

      let resolved = false;

      this.hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const levels = data.levels;
        if (levels && levels.length > 0) {
          const videoCodec = (levels[0] as any).videoCodec || (levels[0] as any).attrs?.CODECS || '';
          const detectedCodec: 'h264' | 'h265' = /hev|hvc|h\.265/i.test(videoCodec) ? 'h265' : 'h264';
          const effectiveCodec = options?.codec && options.codec !== 'auto' ? options.codec : detectedCodec;

          this.isRawMode = effectiveCodec === 'h265';
          if (this.isRawMode) {
            console.log(`[ffmpeg.wasm] H.265 detected, enabling raw mode (manifest: ${videoCodec || 'none'})`);
            this.registerFragmentHandler();
          } else {
            console.log(`HLS detected codec: H.264 (${videoCodec})`);
          }
        }

        if (this.mediaElement) {
          this.hls!.attachMedia(this.mediaElement);
        }

        if (!resolved) {
          resolved = true;
          resolve();
        }
      });

      this.hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
        const level = data.level;
        const videoCodec = ((level as any).videoCodec || (level as any).codec || '') as string;
        const codec: 'h264' | 'h265' = /hev|hvc|h\.265/i.test(videoCodec) ? 'h265' : 'h264';
        this.metadata = {
          codec: this.isRawMode ? 'h265' : codec,
          width: (level as any).width || 1280,
          height: (level as any).height || 720,
          fps: (level as any).attrs?.FRAME_RATE || 30,
        };
        if (this.metadataCallback) {
          this.metadataCallback(this.metadata);
        }
      });

      this.hls.on(Hls.Events.ERROR, (_, data) => {
        if (this.isRawMode && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          console.warn('[ffmpeg.wasm] HLS media error (expected for H.265), continuing raw mode:', data.details);
          if (data.fatal) {
            (this.hls as Hls).recoverMediaError();
          }
          return;
        }
        console.error('HLS error:', data);
        if (data.fatal) {
          if (!resolved) {
            resolved = true;
            reject(new Error(`HLS fatal error: ${data.details}`));
          } else {
            this.emit('error', new Error(`HLS fatal error: ${data.details}`));
          }
        }
      });

      this.hls.loadSource(url);
    });
  }

  disconnect(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  onData(callback: (data: ArrayBuffer) => void): void {
    this.dataCallback = callback;
    const pending = this.pendingFragments.splice(0);
    if (pending.length > 0) {
      console.log(`[ffmpeg.wasm] Draining ${pending.length} buffered fragments to renderer`);
      for (const frag of pending) {
        callback(frag);
      }
    }
  }

  onMetadata(callback: (metadata: StreamMetadata) => void): void {
    this.metadataCallback = callback;
  }

  getMetadata(): StreamMetadata | undefined {
    return this.metadata || undefined;
  }

  getHlsInstance(): Hls | null {
    return this.hls;
  }

  private registerFragmentHandler(): void {
    if (this.fragmentHandlerRegistered || !this.hls) return;
    this.fragmentHandlerRegistered = true;
    this.hls.on(Hls.Events.FRAG_LOADED, (_, fragData) => {
      if (!fragData.payload) return;
      const data = fragData.payload as ArrayBuffer;
      if (this.dataCallback) {
        this.dataCallback(data);
      } else {
        this.pendingFragments.push(data);
      }
    });
  }
}
