export interface HexVertex {
    x: number;
    y: number;
  }
  
  export interface Hex {
    type: string; // Type of the hex (e.g., "forest", "mountain")
    number: number; // Number token for the hex (optional)
    q: number; // Axial coordinate
    r: number; // Axial coordinate
    corners: HexVertex[];
  }
  