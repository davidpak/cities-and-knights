// components/PlayerList.tsx
import React from 'react';

type Props = {
  players: string[];
};

const PlayerList: React.FC<Props> = ({ players }) => {
  return (
    <div style={{ marginTop: '20px' }}>
      <h3>Players in Room:</h3>
      <ul>
        {players.map((id) => (
          <ul key={id}>{id}</ul>
        ))}
      </ul>
    </div>
  );
};

export default PlayerList;
