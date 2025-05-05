import React from 'react';
import '../styles/HexBoard.css';

interface HexTileProps {
  type: string;
  number?: number;
}

const HexTile: React.FC<HexTileProps> = ({ type, number }) => {
  return (
    <div className={`hexagon hex-${type}`}>
      <div className="hexTop" />
      <div className="hexBottom" />
      {number && (
        <div className="hex-number">
          {number}
        </div>
      )}
    </div>
  );
};

export default HexTile;
