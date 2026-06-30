import type { IPlayer, PlayerConfig } from './types';
import { Player } from './Player';

export class PlayerManager {
  createPlayer(config: PlayerConfig): IPlayer {
    return new Player(config);
  }
}

export default PlayerManager;
