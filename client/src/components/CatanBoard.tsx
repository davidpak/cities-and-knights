import React from 'react';
import { useEffect, useState } from 'react';
import HexTile from './HexTile';
import '../styles/HexBoard.css';
import socket from '../socket';
import Tile from '../types/Tile';
import Settlement from '../types/Settlement';

interface CatanBoardProps {
  // Define any props if needed
  showVertices: boolean;
}


const CatanBoard: React.FC<CatanBoardProps> = ({ showVertices }) => {
  const [tileMap, setTileMap] = useState<Tile[][]>([]);
  const [settlements, setSettlements] = useState<{ [vertexId: string]: Settlement }>({});

  useEffect(() => {
    socket.on('gameState', (state: any) => {
      console.log("Received game state:", state);
      if (!state || !state.board || !state.settlements || !state.playerColors) {
        console.warn("Received incomplete game state:", state);
        return;
      }
      
      setTileMap(state.board);

      const vertexOwnership: { [vertexId: string]: Settlement } = {};
      const colors = state.playerColors || {};

      for (const [playerId, vertexList] of Object.entries(state.settlements || {})) {
        for (const vertexId of vertexList as string[]) {
          const color = colors[playerId] || 'gray'; // Default to gray if no color found
          vertexOwnership[vertexId] = {
            playerId,
            vertexId,
            color,
          };
        }
      }

      setSettlements(vertexOwnership);
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
              settlements={settlements}
            />
          ))}
        </div>
      ))}
    </div>
  );
};
export default CatanBoard;
