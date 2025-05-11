import React, { useEffect, useState } from 'react';
import '../styles/HexVertices.css';
import Vertex from './Vertex';
import { generateHexCenters, generateVertexMapFromCenters } from '../utils/hexLayout';
import socket from '../socket';
import { useParams } from 'react-router-dom';

interface HexVerticesProps {
  onClickVertex?: (index: number) => void;
}

const HexVertices: React.FC<HexVerticesProps> = ({ onClickVertex }) => {
  const [settlements, setSettlements] = useState<boolean[]>(Array(6).fill(false));
  const { roomCode } = useParams<{ roomCode: string }>();

  const centers = generateHexCenters();
  const vertexMap = generateVertexMapFromCenters(centers);

  const handleVertexClick = (vertexId: string) => {
    console.log(`Clicked vertex ${vertexId}`);
  }

  return (
    <>
      {Object.values(vertexMap).map(({ id, x, y }) => (
        <Vertex
          key={id}
          id={id}
          x={x}
          y={y}
          onClick={() => handleVertexClick(id)}
        />
      ))}
    </>
  );
};

export default HexVertices;
