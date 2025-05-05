import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import CatanBoard from '../components/CatanBoard';
import '../App.css';

const GameBoardPage: React.FC = () => {
     const { roomCode } = useParams<{ roomCode: string}>();

     useEffect(() => {
        console.log('Entered GameBoard for room: ', roomCode);
     }, [roomCode]);

     return (
        <div>
            <h1 style={{ textAlign: 'center', marginTop: '20px', position: 'relative', top: '-100px',  }}>Game Board</h1>
            <CatanBoard />
        </div>
     )
}

export default GameBoardPage;