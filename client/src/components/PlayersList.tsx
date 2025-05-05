// components/PlayerList.tsx
import React, { useState } from 'react';
import { FaPencilAlt, FaCrown } from 'react-icons/fa';
import socket from '../socket';

type Player = {
  socketId: string;
  nickname: string;
  isReady?: boolean;
  isHost?: boolean;
};

type Props = {
  players: Player[];
  userSocketId: string | null;
};

const PlayerList: React.FC<Props> = ({ players, userSocketId }) => {
  const [editingNickname, setEditingNickname] = useState(false);
  const [nickname, setNickname] = useState('');

  const currentPlayer = players.find(p => p.socketId === userSocketId);
  const roomCode = window.location.pathname.split('/').pop();
  const isHost = currentPlayer?.isHost;

  const handleToggleReady = () => {
    if (roomCode) {
      socket.emit('toggleReady', roomCode);
    }
  };

  const handleStartGame = () => {
    if (roomCode) {
      socket.emit('gameStarted', roomCode);
    }
  };

  const handleSave = () => {
    if (nickname.trim()) {
      socket.emit('updateNickname', nickname.trim());
      setEditingNickname(false);
    }
  };

  const allReady = players.every(p => p.isReady);

  return (
    <div style={{ marginTop: '20px' }}>
      <h3>Players in Room:</h3>
      <ul style={{ listStyleType: 'none', paddingLeft: 0 }}>
        {players.map((player) => (
          <li key={player.socketId} style={{ marginBottom: '8px' }}>
            {player.isHost && <FaCrown style={{ color: 'gold', marginRight: '6px' }} />}
            {player.socketId === userSocketId ? (
              editingNickname ? (
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  onBlur={handleSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave();
                  }}
                  autoFocus
                  style={{ fontSize: '16px' }}
                />
              ) : (
                <>
                  {player.nickname}
                  <FaPencilAlt
                    onClick={() => {
                      setNickname(player.nickname);
                      setEditingNickname(true);
                    }}
                    style={{ cursor: 'pointer', marginLeft: '10px' }}
                  />
                </>
              )
            ) : (
              <>
                {player.nickname}{' '}
              </>
            )}
            <span style={{ marginLeft: '10px', fontSize: '14px', color: player.isReady ? 'green' : 'red' }}>
              {player.isReady ? '✅ Ready' : '❌ Not Ready'}
            </span>
          </li>
        ))}
      </ul>

      <div style={{ marginTop: '16px' }}>
        {userSocketId && (
          <button onClick={handleToggleReady} style={{ marginRight: '10px' }}>
            {currentPlayer?.isReady ? 'Unready' : 'Ready Up'}
          </button>
        )}
        {isHost && (
          <button
            onClick={handleStartGame}
            disabled={!allReady}
            style={{ backgroundColor: allReady ? '#4CAF50' : 'gray', color: 'white' }}
          >
            Start Game
          </button>
        )}
      </div>
    </div>
  );
};

export default PlayerList;
