import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import socket from '../socket';
import DiceRoller from '../components/DiceRoller';
import '../App.css';

const GamePage: React.FC = () => {
  const { roomCode } = useParams<{ roomCode: string }>();
  const [roll, setRoll] = useState<{ dice1: number; dice2: number } | null>(null);

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

    socket.on('gameState', handleGameState);
    socket.on('diceRolled', handleDiceRolled);

    return () => {
      socket.off('gameState', handleGameState);
      socket.off('diceRolled', handleDiceRolled);
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
      <button onClick={handleRoll} style={{ fontSize: '24px', padding: '10px 20px' }}>
        Roll Dice
      </button>

      <DiceRoller roll={roll} />
    </div>
  );
};

export default GamePage;
