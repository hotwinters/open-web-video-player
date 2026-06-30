import type { IRenderer } from '../core/types';

export class NativeRenderer implements IRenderer {
  private video: HTMLVideoElement | null = null;

  async init(container: HTMLElement): Promise<void> {
    this.video = document.createElement('video');
    this.video.className = 'owvp-native-video';

    const wrapper = container.querySelector('.owvp-video-wrapper');
    if (wrapper) {
      wrapper.appendChild(this.video);
    } else {
      container.appendChild(this.video);
    }
  }

  render(_frame: any): void {
  }

  setVolume(volume: number): void {
    if (this.video) {
      this.video.volume = volume;
    }
  }

  getCanvas(): HTMLVideoElement {
    if (!this.video) {
      throw new Error('Renderer not initialized');
    }
    return this.video;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  destroy(): void {
    if (this.video) {
      this.video.pause();
      this.video.src = '';
      this.video.remove();
      this.video = null;
    }
  }
}
