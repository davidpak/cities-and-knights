import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';
import { generateRoomCode } from '../utils/generateRoomCode';
import '../App.css';

const HomePage: React.FC = () => {
  const [mode, setMode] = useState<'create' | 'join' | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleCreateRoom = () => {
    const code = generateRoomCode();
    socket.emit('createRoom', code);
  };

  const handleJoinRoom = () => {
    if (!roomCode.trim()) {
      setError('Please enter a room code.');
      return;
    }
    socket.emit('joinRoom', roomCode.trim().toUpperCase());
  };

  useEffect(() => {
    const handleRoomJoined = (code: string) => {
      navigate(`/game/${code}`);
    };

    const handleError = (msg: string) => {
      setError(msg);
    };

    socket.on('roomJoined', handleRoomJoined);
    socket.on('errorMessage', handleError);

    return () => {
      socket.off('roomJoined', handleRoomJoined);
      socket.off('errorMessage', handleError);
    };
  }, [navigate]);

  return (
    <div className="app">
      <h1>Cities & Knights</h1>
      <div>
        <label>
          <input
            type="radio"
            value="join"
            checked={mode === 'join'}
            onChange={() => setMode('join')}
          />
          Join Room
        </label>
        <label>
          <input
            type="radio"
            value="create"
            checked={mode === 'create'}
            onChange={() => setMode('create')}
          />
          Create Room
        </label>
      </div>

      {mode === 'join' && (
        <input
          type="text"
          placeholder="Enter room code"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
        />
      )}

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <button onClick={mode === 'create' ? handleCreateRoom : handleJoinRoom}>
        {mode === 'create' ? 'Create' : 'Join'}
      </button>
    </div>
  );
};

export default HomePage;
