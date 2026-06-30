import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import type { IRenderer } from '../core/types';

export class WasmRenderer implements IRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private ffmpeg: FFmpeg | null = null;
  private isLoaded: boolean = false;
  private decoding: boolean = false;
  private pendingFragments: Uint8Array[] = [];
  private frameBuffer: ImageBitmap[] = [];
  private playing: boolean = false;
  private animationFrameId: number | null = null;
  private fps: number = 25;
  private lastFrameTime: number = 0;

  async init(container: HTMLElement, width?: number, height?: number, preloadedURLs?: { coreURL: string; wasmURL: string }): Promise<void> {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'owvp-wasm-canvas';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.width = width || 1280;
    this.canvas.height = height || 720;

    const wrapper = container.querySelector('.owvp-video-wrapper');
    if (wrapper) {
      wrapper.appendChild(this.canvas);
    } else {
      container.appendChild(this.canvas);
    }

    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) {
      throw new Error('Canvas context not available');
    }

    try {
      await this.loadFFmpeg(preloadedURLs);
    } catch (error) {
      console.error('[ffmpeg.wasm] init failed:', error);
      throw error;
    }
  }

  private async loadFFmpeg(preloadedURLs?: { coreURL: string; wasmURL: string }): Promise<void> {
    const t0 = Date.now();
    console.log('[ffmpeg.wasm] Initializing FFmpeg instance...');
    this.ffmpeg = new FFmpeg();

    this.ffmpeg.on('log', ({ type, message }) => {
      if (type === 'stderr') {
        console.log(`[ffmpeg.wasm] ${message}`);
      }
    });

    this.ffmpeg.on('progress', ({ progress, time }) => {
      if (progress > 0) {
        console.log(`[ffmpeg.wasm] progress: ${(progress * 100).toFixed(1)}%, time: ${time}s`);
      }
    });

    const base = 'https://unpkg.com/@ffmpeg/core@0.12.9/dist/esm';
    let coreURL = preloadedURLs?.coreURL;
    let wasmURL = preloadedURLs?.wasmURL;
    if (!coreURL || !wasmURL) {
      try {
        coreURL = await toBlobURL(base + '/ffmpeg-core.js', 'text/javascript');
        wasmURL = await toBlobURL(base + '/ffmpeg-core.wasm', 'application/wasm');
      } catch {
        console.warn('[ffmpeg.wasm] CDN fetch failed, trying local files...');
        coreURL = '/ffmpeg/ffmpeg-core.js';
        wasmURL = '/ffmpeg/ffmpeg-core.wasm';
      }
    }

    await this.ffmpeg.load({ coreURL, wasmURL });

    if (preloadedURLs?.coreURL?.startsWith('blob:')) URL.revokeObjectURL(preloadedURLs.coreURL);
    if (preloadedURLs?.wasmURL?.startsWith('blob:')) URL.revokeObjectURL(preloadedURLs.wasmURL);

    console.log('[ffmpeg.wasm] FFmpeg loaded successfully, total time:', Date.now() - t0, 'ms');
    this.isLoaded = true;
    this.scheduleNextDecode();
  }

  async render(frame: ArrayBuffer | Uint8Array): Promise<void> {
    if (!this.ffmpeg || !this.ctx || !this.canvas) return;

    const data = frame instanceof Uint8Array ? frame : new Uint8Array(frame);

    if (!this.isLoaded || this.decoding) {
      this.pendingFragments.push(data);
      return;
    }

    this.decodeFragment(data);
  }

  private async decodeFragment(data: Uint8Array): Promise<void> {
    if (!this.ffmpeg || !this.ctx || !this.canvas) return;

    this.decoding = true;

    try {
      await this.ffmpeg.writeFile('input.ts', data);

      await this.ffmpeg.exec([
        '-i', 'input.ts',
        '-frames:v', '10',
        '-f', 'image2',
        '-vcodec', 'png',
        'frame%d.png'
      ]);

      let idx = 1;
      const frames: ImageBitmap[] = [];
      while (true) {
        try {
          const pngData = await this.ffmpeg.readFile(`frame${idx}.png`) as Uint8Array;
          const blob = new Blob([pngData as BlobPart], { type: 'image/png' });
          const bitmap = await createImageBitmap(blob);
          frames.push(bitmap);
          this.ffmpeg.deleteFile(`frame${idx}.png`);
          idx++;
        } catch {
          break;
        }
      }

      if (frames.length === 0) return;

      if (!this.playing) {
        this.ctx.drawImage(frames[0], 0, 0);
      }

      for (let i = 1; i < frames.length; i++) {
        this.frameBuffer.push(frames[i]);
        if (this.frameBuffer.length > 150) {
          const old = this.frameBuffer.shift();
          old?.close();
        }
      }

      if (!this.playing && this.frameBuffer.length > 0) {
        this.startPlayback();
      }
    } catch (error) {
      console.error('[ffmpeg.wasm] Error decoding fragment:', error);
    } finally {
      this.decoding = false;
      this.scheduleNextDecode();
    }
  }

  private scheduleNextDecode(): void {
    if (this.pendingFragments.length > 0 && this.isLoaded && !this.decoding) {
      const next = this.pendingFragments.shift()!;
      this.decodeFragment(next);
    }
  }

  private startPlayback(): void {
    this.playing = true;
    this.lastFrameTime = performance.now();
    this.playLoop();
  }

  private playLoop = (): void => {
    if (!this.playing || !this.ctx || !this.canvas) return;

    const interval = 1000 / this.fps;
    const now = performance.now();
    const elapsed = now - this.lastFrameTime;

    if (elapsed >= interval && this.frameBuffer.length > 0) {
      const framesToAdvance = Math.min(Math.floor(elapsed / interval), this.frameBuffer.length);
      let lastFrame: ImageBitmap | null = null;
      for (let i = 0; i < framesToAdvance; i++) {
        const old = this.frameBuffer.shift();
        if (old && i < framesToAdvance - 1) old.close();
        if (old && i === framesToAdvance - 1) lastFrame = old;
      }
      if (lastFrame) {
        this.ctx.drawImage(lastFrame, 0, 0);
        lastFrame.close();
      }
      this.lastFrameTime += framesToAdvance * interval;
    }

    this.animationFrameId = requestAnimationFrame(this.playLoop);
  }

  setVolume(_volume: number): void {
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.canvas) {
      throw new Error('Renderer not initialized');
    }
    return this.canvas;
  }

  destroy(): void {
    this.playing = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    if (this.ffmpeg) {
      this.ffmpeg.terminate();
    }

    this.frameBuffer.forEach(f => f.close());
    this.pendingFragments = [];

    if (this.canvas) {
      this.canvas.remove();
    }

    this.canvas = null;
    this.ctx = null;
    this.ffmpeg = null;
    this.isLoaded = false;
    this.frameBuffer = [];
  }
}
