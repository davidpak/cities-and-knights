const DiceRoller = ({ roll }: { roll: { dice1: number; dice2: number } | null }) => {
    if (!roll) return null;
  
    return (
      <div style={{ marginTop: '40px', fontSize: '28px' }}>
        <p>Dice 1: {roll.dice1}</p>
        <p>Dice 2: {roll.dice2}</p>
      </div>
    );
  };
  
  export default DiceRoller;
  