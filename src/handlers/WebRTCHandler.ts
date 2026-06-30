import { EventEmitter } from '../core/EventEmitter';
import type { IHandler, StreamMetadata, HandlerOptions } from '../core/types';

export class WebRTCHandler extends EventEmitter implements IHandler {
  private pc: RTCPeerConnection | null = null;
  private metadata: StreamMetadata | null = null;
  private dataCallback: ((data: ArrayBuffer) => void) | null = null;
  private metadataCallback: ((metadata: StreamMetadata) => void) | null = null;
  private videoElement: HTMLVideoElement | null = null;

  async connect(_url: string, _options?: HandlerOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const configuration: RTCConfiguration = {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
          ],
        };

        this.pc = new RTCPeerConnection(configuration);

        this.pc.onicecandidate = (event) => {
          if (event.candidate) {
            console.log('ICE candidate:', event.candidate);
          }
        };

        this.pc.oniceconnectionstatechange = () => {
          console.log('ICE connection state:', this.pc?.iceConnectionState);
        };

        this.pc.ontrack = (event) => {
          console.log('Track received:', event.track.kind);
          if (event.track.kind === 'video' && this.videoElement) {
            const stream = event.streams[0];
            this.videoElement.srcObject = stream;
            
            this.metadata = {
              codec: 'h264',
              width: 1280,
              height: 720,
              fps: 30,
            };
            
            if (this.metadataCallback) {
              this.metadataCallback(this.metadata);
            }
          }
        };

        this.pc.ondatachannel = (event) => {
          const channel = event.channel;
          channel.onmessage = (event) => {
            if (this.dataCallback && event.data instanceof ArrayBuffer) {
              this.dataCallback(event.data);
            }
          };
        };

        console.log('WebRTC peer connection created');
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  setVideoElement(element: HTMLVideoElement): void {
    this.videoElement = element;
  }

  createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }
    return this.pc.createOffer();
  }

  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }
    return this.pc.setLocalDescription(description);
  }

  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }
    return this.pc.setRemoteDescription(description);
  }

  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }
    return this.pc.addIceCandidate(candidate);
  }

  disconnect(): void {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.videoElement = null;
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

  getPeerConnection(): RTCPeerConnection | null {
    return this.pc;
  }
}
