import React from 'react';
import '../styles/HexBoard.css';
import '../styles/HexTile.css';
import { useEffect } from 'react';

import { useParams } from 'react-router-dom';
import vertices from '../data/vertices';
import roadSlots from '../data/roadSlots'; // <-- This is your hardcoded file
import socket from '../socket';
import Settlement from '../types/Settlement';
import Road from '../types/Road';
import edges from '../data/edges';

interface HexTileProps {
  id: string;
  type: string;
  number?: number;
  showVertices: boolean;
  showRoads: boolean;
  settlements: { [vertexId: string]: Settlement };
  roads: { [roadId: string]: Road };
}

const slotPositions = {
  'top-left': { x: 22, y: -25, angle: -30 },
  'top-right': { x: 75, y: -28, angle: 30 },
  'right': { x: 103, y: 50, angle: 90 },
  'bottom-right': { x: 73, y: 126, angle: -30 },
  'bottom-left': { x: 24, y: 123, angle: 30 },
  'left': { x: -2, y: 50, angle: 90 },
};

const HexTile: React.FC<HexTileProps> = ({ id, type, number, showVertices, showRoads, settlements, roads }) => {
  const { roomCode } = useParams<{ roomCode: string }>();

  const myVertices = Object.entries(vertices).filter(
    ([, v]) => v.renderFrom === id
  );

  const myRoads = Object.entries(edges).filter(([roadId, road]) => {
    const { vertexA, vertexB, slot } = road;
    const hexesA = vertices[vertexA]?.adjacentHexes || [];
    const hexesB = vertices[vertexB]?.adjacentHexes || [];
    const sharedHexes = hexesA.filter(hex => hexesB.includes(hex));
    if (sharedHexes.length === 0) return false;
    const primaryHex = sharedHexes.sort()[0];
    return primaryHex === id;
  });

  const myRoadSlots = roadSlots[id] || [];

  console.log(`${id}'s vertices:` , myVertices);
  console.log(`${id}'s roads:` , myRoads);

  useEffect(() => {
    console.log('Settlements:', settlements);
  }, [settlements]);

  useEffect(() => {
    console.log('Roads:', roads);
  }, [roads]);

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

  const handleRoadClick = (roadId: string) => {
    return () => {
      const sortedRoadId = roadId.split('-').sort().join('-');
      console.log('Clicked road placeholder:', roadId);
      socket.emit('placeRoad', {
        roomCode: roomCode,
        roadId: sortedRoadId,
      });
    }
  };

  return (
    <div className={`hexagon hex-${type}`}>
      <div className="hexTop" />
      <div className="hexBottom" />
      {number && <div className={`hex-number token-${number}`} />}

      {/* Settlements */}
      {myVertices.map(([vertexId, v]) => {
        const settlement = settlements[vertexId];
        if (settlement) {
          return (
            <div key={vertexId} className={`settlement-container settlement-${v.position}`}>
              <img
                src={`https://colonist.io/dist/images/settlement_${settlement.color}.svg`}
                alt="settlement"
                className="settlement-icon"
              />
            </div>
          );
        }

        if (!showVertices) return null;

        return (
          <div
            key={vertexId}
            className={`vertex vertex-${v.position}`}
            onClick={handleVertexClick(vertexId, settlement)}
          />
        );
      })}

      {/* Roads (from hardcoded slots) */}
      {myRoadSlots.map(({ roadId, slot }) => {
      const pos = slotPositions[slot as keyof typeof slotPositions];
      if (!pos) return null;

      const isPlaced = roads[roadId] !== undefined;
      const roadColor = isPlaced ? roads[roadId].color : '';

      const style = {
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: `translate(-50%, -50%) rotate(${pos.angle}deg)`,
      };

      return (
        <div key={roadId} className="road-wrapper" style={style}>
          {!isPlaced && showRoads && (
            <div className="road-placeholder" onClick={handleRoadClick(roadId)} />
          )}
          {isPlaced && (
            <div className="road-container">
              <img
                src={`https://colonist.io/dist/images/road_${roadColor}.svg`}
                alt="road"
                className="road-colored"
              />
            </div>
          )}
        </div>
      );
    })}

    </div>
  );
};

export default HexTile;
