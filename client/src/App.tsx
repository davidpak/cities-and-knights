// import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import GamePage from './pages/GamePage';
import GameBoardPage from './pages/GameBoardPage'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/game/:roomCode" element={<GamePage />} />
        <Route path="/gameboard/:roomCode" element={<GameBoardPage />} />
      </Routes>
    </Router>
  );
}

export default App;
