import { useEffect } from 'react';
import socket from '../socket';

export function useSocketListeners({
  onGameState,
  onDiceRolled,
  onRoomJoined,
  onError,
}: {
  onGameState?: (state: any) => void;
  onDiceRolled?: (roll: any) => void;
  onRoomJoined?: (room: string) => void;
  onError?: (msg: string) => void;
}) {
  useEffect(() => {
    if (onGameState) socket.on('gameState', onGameState);
    if (onDiceRolled) socket.on('diceRolled', onDiceRolled);
    if (onRoomJoined) socket.on('roomJoined', onRoomJoined);
    if (onError) socket.on('errorMessage', onError);

    return () => {
      socket.off('gameState', onGameState);
      socket.off('diceRolled', onDiceRolled);
      socket.off('roomJoined', onRoomJoined);
      socket.off('errorMessage', onError);
    };
  }, []);
}
