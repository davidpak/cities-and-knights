// src/App.tsx
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import './App.css';

// const socket = io('http://54.71.248.111:3001');
const socket = io('https://cities-and-knights-production.up.railway.app', {
  transports: ['websocket'],
});


type Roll = {
  dice1: number;
  dice2: number;
} | null;

function App() {
  const [roll, setRoll] = useState<Roll>(null);

  useEffect(() => {
    socket.on('gameState', (state) => {
      setRoll(state.lastRoll);
    });

    socket.on('diceRolled', (newRoll) => {
      setRoll(newRoll);
    });

    return () => {
      socket.off('gameState');
      socket.off('diceRolled');
    };
  }, []);

  const handleRoll = () => {
    socket.emit('rollDice');
  };

  return (
    <div className="app">
      <h1>🎲 Cities & Knights Dice Roller</h1>
      <button onClick={handleRoll} style={{ fontSize: '24px', padding: '10px 20px' }}>
        Roll Dice
      </button>

      {roll && (
        <div style={{ marginTop: '40px', fontSize: '28px' }}>
          <p>Dice 1: {roll.dice1}</p>
          <p>Dice 2: {roll.dice2}</p>
        </div>
      )}
    </div>
  );
}

export default App;
