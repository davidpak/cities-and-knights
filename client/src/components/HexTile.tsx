import React from 'react';
import '../styles/HexBoard.css';
import vertices from '../data/vertices';

interface HexTileProps {
  id: string;
  type: string;
  number?: number;
  showVertices: boolean;
}

const HexTile: React.FC<HexTileProps> = ({ id, type, number, showVertices }) => {
  // Create a dynamic class name based on the number (e.g., "token-5")
  const tokenClass = number ? `token-${number}` : '';

  const myVertices = Object.entries(vertices).filter(
    ([, v]) => v.renderFrom === id
  );

  const handleVertexClick = (vertexId: string) => {
    console.log(`Clicked vertex ${vertexId}`);
  };
  
  return (
    <div className={`hexagon hex-${type}`}>
      <div className="hexTop" />
      <div className="hexBottom" />
      {number && (
        <div className={`hex-number ${tokenClass}`} />
      )}
      {showVertices &&
        myVertices.map(([vertexId, v]) => (
          <div
            key={vertexId}
            className={`vertex vertex-${v.position}`}
            onClick={() => handleVertexClick(vertexId)}
          />
      ))}
      {/* DEBUG GET RID OF */}
      {/* <div className="hex-label">
        <div>{id}</div>
        <div>{type}</div>
        <div>{number}</div>
      </div> */}
    </div>
  );
};

export default HexTile;
