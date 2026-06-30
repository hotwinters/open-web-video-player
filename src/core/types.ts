export interface PlayerConfig {
  container: string | HTMLElement;
  autoPlay?: boolean;
  rendererPreference?: 'native' | 'wasm' | 'auto';
  showStats?: boolean;
  showControls?: boolean;
  autoReconnect?: boolean;
}

export interface StreamOptions {
  type?: 'hls' | 'flv' | 'webrtc' | 'auto';
  codec?: 'h264' | 'h265' | 'auto';
  preferLowLatency?: boolean;
  startVolume?: number;
}

export interface PlayerStats {
  fps: number;
  bitrate: number;
  droppedFrames: number;
  bufferSize: number;
  latency: number;
  memoryUsed: number;
  codec: 'h264' | 'h265';
  renderer: 'native' | 'wasm';
  isPlaying: boolean;
  isStalled: boolean;
}

export interface StreamMetadata {
  codec: 'h264' | 'h265';
  width: number;
  height: number;
  fps: number;
  duration?: number;
}

export interface HandlerOptions {
  preferLowLatency?: boolean;
  autoReconnect?: boolean;
  codec?: 'h264' | 'h265' | 'auto';
}

export interface IPlayer {
  load(url: string, options?: StreamOptions): Promise<void>;
  play(): void;
  pause(): void;
  setVolume(volume: number): void;
  getStats(): PlayerStats;
  destroy(): void;
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback: (...args: any[]) => void): void;
}

export interface IRenderer {
  init(container: HTMLElement): Promise<void>;
  render(frame: any): void;
  setVolume(volume: number): void;
  getCanvas(): HTMLCanvasElement | HTMLVideoElement;
  destroy(): void;
}

export interface IHandler {
  connect(url: string, options?: HandlerOptions): Promise<void>;
  disconnect(): void;
  onData(callback: (data: ArrayBuffer) => void): void;
  onMetadata(callback: (metadata: StreamMetadata) => void): void;
  getMetadata(): StreamMetadata | undefined;
}
