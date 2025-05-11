// src/utils/hexLayout.ts

  export interface HexCenter {
    id: string;          // e.g. A1, B2, etc.
    row: number;
    col: number;
    x: number; // in vw
    y: number; // in vw
 }
  export interface VertexData {
    id: string;
    x: number;
    y: number;
    adjacentHexes: string[];
  }
  
  const HEX_WIDTH = 8;      // vw
  const HEX_HEIGHT = 4.62;  // vw
  const HORIZ_SPACING = HEX_WIDTH * 0.75; // ≈ 6vw
  const VERT_SPACING = HEX_HEIGHT; // 1 full row = 4.62vw
  
  const ROW_LAYOUT = [3, 4, 5, 4, 3];
  
 
    export function generateHexCenters(): HexCenter[] {
        const centers: HexCenter[] = [];
    
        for (let row = 0; row < ROW_LAYOUT.length; row++) {
        const cols = ROW_LAYOUT[row];
        const rowLabel = String.fromCharCode(65 + row); // A, B, C, ...
    
        for (let col = 0; col < cols; col++) {
            const colLabel = (col + 1).toString();
            const id = `${rowLabel}${colLabel}`;
    
            // center horizontally within the widest row (5 hexes = 30vw wide)
            const offsetX = row % 2 === 1 ? HORIZ_SPACING / 2 : 0;
            const x = col * HORIZ_SPACING + offsetX + 10; // +10 to center the whole grid visually
            const y = row * VERT_SPACING + 5; // +5 to nudge the board down from top
    
            centers.push({ id, row, col, x, y });
        }
        }
    
        return centers;
    }

  export function generateVertexMapFromCenters(centers: HexCenter[]): Record<string, VertexData> {
    const radius = HEX_WIDTH / 2;
    const vertexMap: Record<string, VertexData> = {};
    const vertexHashSet = new Map<string, string>(); // to deduplicate
  
    for (const hex of centers) {
      const angleStart = -30;
      const vertices = Array.from({ length: 6 }).map((_, i) => {
        const angle = (Math.PI / 180) * (angleStart + i * 60);
        const x = parseFloat((hex.x + radius * Math.cos(angle)).toFixed(2));
        const y = parseFloat((hex.y + radius * Math.sin(angle)).toFixed(2));
        return { x, y };
      });
  
      vertices.forEach((v, i) => {
        const key = `${v.x},${v.y}`;
        let vertexId = vertexHashSet.get(key);
  
        if (!vertexId) {
          vertexId = `v${hex.id}_${i}`;
          vertexHashSet.set(key, vertexId);
          vertexMap[vertexId] = {
            id: vertexId,
            x: v.x,
            y: v.y,
            adjacentHexes: [hex.id],
          };
        } else {
          vertexMap[vertexId].adjacentHexes.push(hex.id);
        }
      });
    }
  
    return vertexMap;
  }
  