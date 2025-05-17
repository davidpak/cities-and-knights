import React from 'react';
import { useEffect, useState } from 'react';
import HexTile from './HexTile';
import '../styles/HexBoard.css';
import socket from '../socket';
import Tile from '../types/Tile';
import Settlement from '../types/Settlement';
import Road from '../types/Road';

interface CatanBoardProps {
  // Define any props if needed
  showVertices: boolean;
  showRoads: boolean;
}


const CatanBoard: React.FC<CatanBoardProps> = ({ showVertices, showRoads }) => {
  const [tileMap, setTileMap] = useState<Tile[][]>([]);
  const [settlements, setSettlements] = useState<{ [vertexId: string]: Settlement }>({});
  const [roads, setRoads] = useState<{ [roadId: string]: Road }>({});

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

      const edgeOwnership: { [roadId: string]: Road } = {};
      for (const [playerId, edgeList] of Object.entries(state.roads || {})) {
        for (const roadId of edgeList as string[]) {
          edgeOwnership[roadId] = {
            playerId,
            roadId,
            color: colors[playerId] || 'gray',
          };
        }
      }
      setRoads(edgeOwnership);
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
              showRoads={showRoads}
              settlements={settlements}
              roads={roads}
            />
          ))}
        </div>
      ))}
    </div>
  );
};
export default CatanBoard;
