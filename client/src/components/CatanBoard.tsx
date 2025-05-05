import React from 'react';
import HexTile from './HexTile';
import '../styles/HexBoard.css';

const tileMap = [
  [ { type: 'field', number: 5 }, { type: 'forest', number: 2 }, { type: 'hill', number: 6 } ],
  [ { type: 'pasture', number: 3 }, { type: 'mountain', number: 8 }, { type: 'desert' }, { type: 'forest', number: 10 } ],
  [ { type: 'hill', number: 9 }, { type: 'field', number: 12 }, { type: 'pasture', number: 6 }, { type: 'mountain', number: 5 }, { type: 'forest', number: 11 } ],
  [ { type: 'field', number: 4 }, { type: 'pasture', number: 10 }, { type: 'mountain', number: 3 }, { type: 'hill', number: 11 } ],
  [ { type: 'forest', number: 8 }, { type: 'field', number: 9 }, { type: 'pasture', number: 4 } ]
];

const CatanBoard: React.FC = () => {
  return (
    <div className="board">
      {tileMap.map((row, i) => (
        <div className="hex-row" key={i}>
          {row.map((tile, j) => (
            <HexTile key={j} type={tile.type} number={tile.number} />
          ))}
        </div>
      ))}
    </div>
  );
};

export default CatanBoard;
