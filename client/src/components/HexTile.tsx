import React from 'react';
import '../styles/HexBoard.css';
import HexVertices from './HexVertices';

interface HexTileProps {
  type: string;
  number?: number;
}

const HexTile: React.FC<HexTileProps> = ({ type, number }) => {
  // Create a dynamic class name based on the number (e.g., "token-5")
  const tokenClass = number ? `token-${number}` : '';
  
  return (
    <div className={`hexagon hex-${type}`}>
      <div className="hexTop" />
      <div className="hexBottom" />
      {number && (
        <div className={`hex-number ${tokenClass}`} />
      )}
      <div className="hexVertices">
        <HexVertices onClickVertex={(index) => console.log(`Clicked vertex ${index} on ${type}`)} />
      </div>
    </div>
  );
};

export default HexTile;
