import flvjs from 'flv.js';
import { EventEmitter } from '../core/EventEmitter';
import type { IHandler, StreamMetadata, HandlerOptions } from '../core/types';

export class FLVHandler extends EventEmitter implements IHandler {
  private player: flvjs.Player | null = null;
  private metadata: StreamMetadata | null = null;
  private dataCallback: ((data: ArrayBuffer) => void) | null = null;
  private metadataCallback: ((metadata: StreamMetadata) => void) | null = null;

  async connect(url: string, _options?: HandlerOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!flvjs.isSupported()) {
        reject(new Error('FLV is not supported in this browser'));
        return;
      }

      this.player = flvjs.createPlayer({
        type: 'flv',
        url: url,
        isLive: true,
        hasAudio: true,
        hasVideo: true,
      }, {
        enableWorker: true,
        lazyLoad: false,
        lazyLoadMaxDuration: 0,
        lazyLoadRecoverDuration: 0,
        deferLoadAfterSourceOpen: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 3 * 60,
        autoCleanupMinBackwardDuration: 2 * 60,
      });

      this.player.on(flvjs.Events.LOADING_COMPLETE, () => {
        console.log('FLV loading complete');
      });

      this.player.on(flvjs.Events.RECOVERED_EARLY_EOF, () => {
        console.log('FLV recovered early EOF');
      });

      this.player.on(flvjs.Events.ERROR, (_, errorType, errorDetails) => {
        console.error('FLV error:', errorType, errorDetails);
        reject(new Error(`FLV error: ${errorType} - ${errorDetails}`));
      });

      this.player.on(flvjs.Events.MEDIA_INFO, (_, info) => {
        this.metadata = {
          codec: 'h264',
          width: info.width || 1280,
          height: info.height || 720,
          fps: info.fps || 30,
        };
        if (this.metadataCallback) {
          this.metadataCallback(this.metadata);
        }
      });

      this.player.on(flvjs.Events.STATISTICS_INFO, (_, info) => {
        console.log('FLV stats:', info);
      });

      this.player.on(flvjs.Events.SCRIPTDATA_ARRIVED, (_, data) => {
        if (this.dataCallback) {
          this.dataCallback(data);
        }
      });

      this.player.on(flvjs.Events.METADATA_ARRIVED, (_, metadata) => {
        if (this.dataCallback) {
          this.dataCallback(metadata);
        }
      });

      resolve();
    });
  }

  attachMediaElement(element: HTMLVideoElement): void {
    if (this.player) {
      this.player.attachMediaElement(element);
      this.player.load();
    }
  }

  disconnect(): void {
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
  }

  onData(callback: (data: ArrayBuffer) => void): void {
    this.dataCallback = callback;
  }

  onMetadata(callback: (metadata: StreamMetadata) => void): void {
    this.metadataCallback = callback;
  }

  getMetadata(): StreamMetadata | undefined {
    return this.metadata || undefined;
  }

  getFlvPlayer(): flvjs.Player | null {
    return this.player;
  }
}
