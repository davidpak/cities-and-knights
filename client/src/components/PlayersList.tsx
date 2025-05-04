// components/PlayerList.tsx
import React, { useState } from 'react';
import { FaPencilAlt } from 'react-icons/fa';
import socket from '../socket';

type Player = {
  socketId: string;
  nickname: string;
};

type Props = {
  players: Player[];
  userSocketId: string | null;
};

const PlayerList: React.FC<Props> = ({ players, userSocketId }) => {
  const [editingNickname, setEditingNickname] = useState(false);
  const [nickname, setNickname] = useState('');

  const handleSave = () => {
    if (nickname.trim()) {
      socket.emit('updateNickname', nickname.trim());
      setEditingNickname(false);
    }
  };

  return (
    <div style={{ marginTop: '20px' }}>
      <h3>Players in Room:</h3>
      <ul>
        {players.map((player) => (
          <ul key={player.socketId} style={{ marginBottom: '8px' }}>
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
                      setNickname(player.nickname); // preload the current name
                      setEditingNickname(true);
                    }}
                    style={{ cursor: 'pointer', marginLeft: '10px' }}
                  />
                </>
              )
            ) : (
              player.nickname
            )}
          </ul>
        ))}
      </ul>
    </div>
  );
};

export default PlayerList;
