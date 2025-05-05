import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../socket';
import '../App.css';
import PlayerList from '../components/PlayersList';

const GamePage: React.FC = () => {
  const { roomCode } = useParams<{ roomCode: string }>();
  const [players, setPlayers] = useState<{ socketId: string; nickname: string }[]>([]);
  const [userSocketId, setUserSocketId] = useState<string | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    if (roomCode) {
      socket.emit('getPlayersInRoom', roomCode);
    }
  }, [roomCode]);

  useEffect(() => {
    const handleGameStarted = () => {
      navigate(`/gameboard/${roomCode}`);
    };

    socket.on('gameStarted', handleGameStarted);
    return () => {
      socket.off('gameStarted', handleGameStarted);
    };
  }, [roomCode]);

  useEffect(() => {
    console.log('Joined room:', roomCode);
  }, [roomCode]);

  useEffect(() => {
    const handlePlayerList = (playersWithNicknames: any[]) => {
      setPlayers(playersWithNicknames);
      const currentUser = playersWithNicknames.find((p) => p.socketId === socket.id);
      if (currentUser) {
        setUserSocketId(currentUser.socketId);
      }
    };

    socket.on('playerList', handlePlayerList);

    return () => {
      socket.off('playerList', handlePlayerList);
    };
  }, []);

  return (
    <div className="app">
      <h1>🎲 Cities & Knights Game Lobby</h1>
      {roomCode && (
        <p style={{ fontSize: '18px', marginBottom: '10px' }}>
          Room Code: <strong>{roomCode}</strong>
        </p>
      )}
      <PlayerList players={players} userSocketId={userSocketId} />
    </div>
  );
};

export default GamePage;
