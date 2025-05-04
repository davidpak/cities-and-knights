import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import socket from '../socket';
import DiceRoller from '../components/DiceRoller';
import '../App.css';
import PlayerList from '../components/PlayersList';

const GamePage: React.FC = () => {
  const { roomCode } = useParams<{ roomCode: string }>();
  const [roll, setRoll] = useState<{ dice1: number; dice2: number } | null>(null);
  const [players, setPlayers] = useState<{ socketId: string; nickname: string }[]>([]);
  const [nickname, setNickname] = useState('');
  const [editingNickname, setEditingNickname] = useState(false);
  const [userSocketId, setUserSocketId] = useState<string | null>(null);

  useEffect(() => {
    if (roomCode) {
      socket.emit('getPlayersInRoom', roomCode);
    }
  }, [roomCode]);

  useEffect(() => {
    console.log('Joined room:', roomCode);
  }, [roomCode]);

  useEffect(() => {
    const handleGameState = (state: any) => {
      setRoll(state.lastRoll);
    };

    const handleDiceRolled = (newRoll: any) => {
      setRoll(newRoll);
    };

    const handlePlayerList = (playersWithNicknames: any[]) => {
        setPlayers(playersWithNicknames);
        const currentUser = playersWithNicknames.find((p) => p.socketId === socket.id);
        if (currentUser) {
            setUserSocketId(currentUser.socketId);
            setNickname(currentUser.nickname);
        }
    };

    socket.on('gameState', handleGameState);
    socket.on('diceRolled', handleDiceRolled);
    socket.on('playerList', handlePlayerList);

    return () => {
      socket.off('gameState', handleGameState);
      socket.off('diceRolled', handleDiceRolled);
      socket.off('playerList', handlePlayerList);
    };
  }, []);

  const handleRoll = () => {
    if (roomCode) {
      socket.emit('rollDice', roomCode);
    }
  };


  return (
    <div className="app">
      <h1>🎲 Cities & Knights Dice Roller</h1>
      {roomCode && (
      <p style={{ fontSize: '18px', marginBottom: '10px' }}>
        Room Code: <strong>{roomCode}</strong>
      </p>
    )}
      <button onClick={handleRoll} style={{ fontSize: '24px', padding: '10px 20px' }}>
        Roll Dice
      </button>

      <DiceRoller roll={roll} />
      <PlayerList
        players={players}
        currentUserId={userSocketId}
        editingNickname={editingNickname}
        setEditingNickname={setEditingNickname}
        nickname={nickname}
        setNickname={setNickname}
      />
    </div>
  );
};

export default GamePage;
