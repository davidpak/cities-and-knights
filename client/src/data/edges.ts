import vertices from './vertices';

interface RoadData {
  vertexA: string;
  vertexB: string;
  slot: string;
}

const edges: { [roadId: string]: RoadData } = {};

// Extended slot map including cross-hex connections
const slotMap: { [key: string]: string } = {
  'top-left_top': 'top-left',
  'top_top-right': 'top-right',
  'top-right_bottom-right': 'right',
  'bottom-right_bottom': 'bottom-right',
  'bottom_bottom-left': 'bottom-left',
  'bottom-left_top-left': 'left',

  // Cross-hex edge directions:
  'top-right_top': 'top-right',
  'top-top-right': 'top-right',


  'bottom-top': 'bottom',
  'bottom-bottom-right': 'bottom-right',

  // Add more if needed (Catan typically covers these)
};

function getSlot(posA: string, posB: string): string | undefined {
  const key1 = `${posA}_${posB}`;
  const key2 = `${posB}_${posA}`;
  return slotMap[key1] || slotMap[key2];
}

// Build edges with correct slots, even cross-hex ones
Object.entries(vertices).forEach(([vertexId, vertexData]) => {
  vertexData.adjacentVertices.forEach(adjacentId => {
    const roadId = [vertexId, adjacentId].sort().join('-');

    if (!edges[roadId]) {
      const vertexAPos = vertices[vertexId]?.position;
      const vertexBPos = vertices[adjacentId]?.position;

      const slot = getSlot(vertexAPos, vertexBPos);

      if (slot) {
        edges[roadId] = {
          vertexA: vertexId,
          vertexB: adjacentId,
          slot,
        };
      } else {
        console.warn(`Edge ${roadId} has no slot mapping: ${vertexId} (${vertexAPos}) <-> ${adjacentId} (${vertexBPos})`);
      }
    }
  });
});

export default edges;
