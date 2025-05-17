import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import CatanBoard from '../components/CatanBoard';
import DiceRoller from '../components/DiceRoller';
import socket from '../socket';
import '../App.css';
import '../styles/GameBoardPage.css';
import GamePlayerList from '../components/GamePlayerList';

const GameBoardPage: React.FC = () => {
  const { roomCode } = useParams<{ roomCode: string }>();
  const [roll, setRoll] = useState<{ dice1: number; dice2: number } | null>(null);
  const [players, setPlayers] = useState<{ socketId: string; nickname: string; color: string }[]>([]);
  const [userSocketId, setUserSocketId] = useState<string | null>(null);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [showVertices, setShowVertices] = useState(false);
  const [showRoads, setShowRoads] = useState(false);

  useEffect(() => {
    console.log('Entered GameBoard for room:', roomCode);

    socket.emit('getPlayersInRoom', roomCode);
    socket.emit('renderRoom', roomCode);

    const handleGameState = (state: any) => {
      setRoll(state.lastRoll);
      setActivePlayerId(state.turnOrder?.[state.activePlayerIndex] || null);
    };

    const handleDiceRolled = (newRoll: any) => {
      setRoll(newRoll);
    };

    const handlePlayerList = (playersWithNicknames: any[]) => {
      setPlayers(playersWithNicknames);
      const currentUser = playersWithNicknames.find(p => p.socketId === socket.id);
      if (currentUser) {
        setUserSocketId(currentUser.socketId);
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
  }, [roomCode]);

  const isUserTurn = userSocketId && userSocketId === activePlayerId;

  const handleRoll = () => {
    if (roomCode) {
      socket.emit('rollDice', roomCode);
    }
  };

  return (
    <div className="gameboard-container">
      <header className="gameboard-header">Game Board</header>

      <div className="playerlist-wrapper">
        <GamePlayerList players={players} userSocketId={userSocketId} />
      </div>

      <CatanBoard showVertices={showVertices} showRoads={showRoads}/>

      <div className="dice-ui-container">
        <p style={{ marginBottom: '10px' }}>
          {isUserTurn ? "🎯 Your turn!" : "⏳ Waiting for other players..."}
        </p>
        <button onClick={handleRoll}>Roll Dice</button>

        <DiceRoller roll={roll} />

        <button onClick={() => setShowVertices((prev) => !prev)} style={{ marginTop: '10px' }}>
          {showVertices ? 'Cancel Placement' : 'Place Settlement'}
        </button>
        <button onClick={() => setShowRoads((prev) => !prev)} style={{ marginTop: '10px' }}>
          {showRoads ? 'Cancel Road Placement' : 'Place Road'}
        </button>

      </div>
    </div>
  );
};

export default GameBoardPage;
