import React, { useState } from 'react';
import '../styles/HexVertices.css';

interface HexVerticesProps {
  onClickVertex?: (index: number) => void;
}

const HexVertices: React.FC<HexVerticesProps> = ({ onClickVertex }) => {
  const [settlements, setSettlements] = useState<boolean[]>(Array(6).fill(false));

  const handleClick = (i: number) => {
    if (!settlements[i]) {
      setSettlements(prev => {
        const newState = [...prev];
        newState[i] = true;
        return newState;
      });
      onClickVertex?.(i);
    }
  };

  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`vertex vertex-${i} ${settlements[i] ? 'has-settlement' : ''}`}
          onClick={() => handleClick(i)}
        />
      ))}
    </>
  );
};

export default HexVertices;
