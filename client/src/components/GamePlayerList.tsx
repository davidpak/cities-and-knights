// components/GamePlayerList.tsx
import React from 'react';
import '../styles/GamePlayerList.css';

type Player = {
  socketId: string;
  nickname: string;
  color?: string;
  victoryPoints?: number;
  isCurrentTurn?: boolean;
};

type Props = {
  players: Player[];
  userSocketId: string | null;
};

const GamePlayerList: React.FC<Props> = ({ players, userSocketId }) => {
  return (
    <div className="playerlist-container">
      <h3 className="playerlist-title">Players</h3>
      <ul className="playerlist">
        {players.map((player) => (
          <li
            key={player.socketId}
            className={`playerlist-item ${
              player.isCurrentTurn ? 'active-turn' : ''
            } ${player.socketId === userSocketId ? 'you' : ''}`}
          >
            <div className="player-avatar" style={{ backgroundColor: player.color || '#888' }} />
            <div className="player-nickname">{player.nickname}</div>
            {typeof player.victoryPoints === 'number' && (
              <div className="player-vp">{player.victoryPoints} VP</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default GamePlayerList;
