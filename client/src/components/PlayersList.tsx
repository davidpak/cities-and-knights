// components/PlayerList.tsx
import React, { useRef } from 'react';
import { FaPencilAlt } from 'react-icons/fa';
import socket from '../socket';

type Player = {
  socketId: string;
  nickname: string;
};

type Props = {
  players: Player[];
  currentUserId: string | null;
  editingNickname: boolean;
  setEditingNickname: (val: boolean) => void;
  nickname: string;
  setNickname: (val: string) => void;
};

const PlayerList: React.FC<Props> = ({
  players,
  currentUserId,
  editingNickname,
  setEditingNickname,
  nickname,
  setNickname,
}) => {
  const editableRef = useRef<HTMLSpanElement>(null);

  const handleBlur = () => {
    if (nickname.trim()) {
      socket.emit('updateNickname', nickname);
    }
    setEditingNickname(false);
  };

  return (
    <div style={{ marginTop: '20px' }}>
      <h3>Players in Room:</h3>
      <ul>
        {players.map((player) => (
          <ul key={player.socketId}>
            {player.socketId === currentUserId ? (
              <>
                <span
                  contentEditable={editingNickname}
                  suppressContentEditableWarning={true}
                  onInput={(e) => setNickname((e.target as HTMLElement).innerText)}
                  onBlur={handleBlur}
                  ref={editableRef}
                  style={{
                    borderBottom: editingNickname ? '1px dashed gray' : 'none',
                    paddingRight: '5px',
                  }}
                >
                  {nickname}
                </span>
                {!editingNickname && (
                  <FaPencilAlt
                    style={{ cursor: 'pointer', marginLeft: '8px' }}
                    onClick={() => {
                      setNickname(player.nickname);
                      setEditingNickname(true);
                      setTimeout(() => {
                        editableRef.current?.focus();
                      }, 0);
                    }}
                  />
                )}
              </>
            ) : (
              <span>{player.nickname}</span>
            )}
          </ul>
        ))}
      </ul>
    </div>
  );
};

export default PlayerList;
