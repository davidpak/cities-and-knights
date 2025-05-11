// game/generateBoard.js

const RESOURCE_TILES = [
    'field', 'field', 'field', 'field',
    'pasture', 'pasture', 'pasture', 'pasture',
    'forest', 'forest', 'forest', 'forest',
    'hill', 'hill', 'hill',
    'mountain', 'mountain', 'mountain',
    'desert'
  ];
  
  const NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  
  const LAYOUT = [3, 4, 5, 4, 3]; // Catan hex layout (rows)
  
  // Helper: Fisher-Yates shuffle
  function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  
  // Get neighbor indices for each tile in a flat array based on LAYOUT
  function getNeighborIndices(index) {
    const offsets = [-1, 1, -LAYOUT[0], -LAYOUT[1], LAYOUT[0], LAYOUT[1]];
    const neighbors = [];
  
    // Map index to (row, col)
    let row = 0;
    let cursor = 0;
    while (cursor + LAYOUT[row] <= index) {
      cursor += LAYOUT[row];
      row++;
    }
    const col = index - cursor;
  
    const dirs = [
      [-1, -1], [-1, 0], [0, -1],
      [0, 1], [1, 0], [1, 1]
    ];
  
    for (const [dr, dc] of dirs) {
      const r = row + dr;
      if (r < 0 || r >= LAYOUT.length) continue;
      const c = col + dc;
      if (c < 0 || c >= LAYOUT[r]) continue;
  
      let neighborIndex = 0;
      for (let i = 0; i < r; i++) neighborIndex += LAYOUT[i];
      neighborIndex += c;
  
      neighbors.push(neighborIndex);
    }
  
    return neighbors;
  }
  
  // Validation: no 6 and 8 adjacent
  function validateNoAdjacentSixEight(flatTiles) {
    for (let i = 0; i < flatTiles.length; i++) {
      const tile = flatTiles[i];
      if (tile.number === 6 || tile.number === 8) {
        const neighbors = getNeighborIndices(i);
        for (const n of neighbors) {
          const neighbor = flatTiles[n];
          if (neighbor.number === 6 || neighbor.number === 8) {
            return false;
          }
        }
      }
    }
    return true;
  }

  function assignHexCoordinates(grid) {
    const rows = ['A', 'B', 'C', 'D', 'E'];
    return grid.map((row, rowIndex) => {
      return row.map((tile, colIndex) => {
        const id = `${rows[rowIndex]}${colIndex + 1}`;
        return { ...tile, id };
      });
    });
  }
  
  
  function generateRandomCatanBoard() {
    let validBoard = null;
  
    while (!validBoard) {
      const resources = shuffle(RESOURCE_TILES);
      const numbers = shuffle(NUMBER_TOKENS);
      const flatTiles = [];
  
      let numIndex = 0;
      for (const resource of resources) {
        let number = null;
        if (resource !== 'desert') {
          number = numbers[numIndex++];
        }
        flatTiles.push({ type: resource, number });
      }
  
      if (validateNoAdjacentSixEight(flatTiles)) {
        validBoard = flatTiles;
      }
    }
  
    // Convert flat board to grid using LAYOUT
    const grid = [];
    let cursor = 0;
    for (const len of LAYOUT) {
      grid.push(validBoard.slice(cursor, cursor + len));
      cursor += len;
    }

    // Assign hex coordinates
    const gridWithCoordinates = assignHexCoordinates(grid);
  
    return gridWithCoordinates;
  }
  
  module.exports = {
    generateRandomCatanBoard
  };
  