import React from 'react';
import { useEffect, useState } from 'react';
import HexTile from './HexTile';
import '../styles/HexBoard.css';
import socket from '../socket';
import Tile from '../types/Tile';

interface CatanBoardProps {
  // Define any props if needed
  showVertices: boolean;
}


const CatanBoard: React.FC<CatanBoardProps> = ({ showVertices }) => {
  const [tileMap, setTileMap] = useState<Tile[][]>([]);

  useEffect(() => {
    socket.on('gameState', (state: any) => {
      setTileMap(state.board);
    });

    return () => {
      socket.off('gameState');
    }
  }, []);

  return (
    <div className="board">
      {tileMap.map((row, i) => (
        <div className="hex-row" key={i}>
          {row.map((tile, j) => (
            <HexTile
              key={j}
              id={tile.id}
              type={tile.type}
              number={tile.number}
              showVertices={showVertices}
            />
          ))}
        </div>
      ))}
    </div>
  );
};
export default CatanBoard;
