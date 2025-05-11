import React from 'react';
import '../styles/HexBoard.css';
import '../styles/HexTile.css';

import vertices from '../data/vertices';
import Settlement from '../types/Settlement';
import socket from '../socket';
import { useParams } from 'react-router-dom';

interface HexTileProps {
  id: string;
  type: string;
  number?: number;
  showVertices: boolean;
  settlements: { [vertexId: string]: Settlement };
}

const HexTile: React.FC<HexTileProps> = ({ id, type, number, showVertices, settlements }) => {
  const tokenClass = number ? `token-${number}` : '';
  const { roomCode } = useParams<{ roomCode: string }>();

  const myVertices = Object.entries(vertices).filter(
    ([, v]) => v.renderFrom === id
  );

  // console.log('Vertices for', id, myVertices);


  // console.log(`Rendering HexTile ${id}, showVertices=${showVertices}`);


  const handleVertexClick = (vertexId: string, settlement: Settlement) => {
    return () => {
      console.log('Clicked vertex:', vertexId);
      if (!settlement) {
        socket.emit('placeSettlement', {
          roomCode: roomCode,
          vertexId,
        });
      }
    };
  };

  return (
    <div className={`hexagon hex-${type}`}>
      <div className="hexTop" />
      <div className="hexBottom" />
      {number && (
        <div className={`hex-number ${tokenClass}`} />
      )}
      {showVertices &&
       myVertices.map(([vertexId, v]) => {
          const settlement = settlements[vertexId];

          return (
            <div
              key={vertexId}
              className={`vertex vertex-${v.position}`}
              onClick={handleVertexClick(vertexId, settlement)}
            >
              {settlement && (
                <img
                  src={`https://colonist.io/dist/images/settlement_${settlement.color}.svg`}
                  alt="settlement"
                  style={{ width: '1.5vw', height: '1.5vw' }}
                />
              )}
            </div>
          );
        })}
    </div>
  );
};

export default HexTile;
