const HEX_SIZE = 90;

function getHexCenter(row: number, col: number) {
    const width = HEX_SIZE * 2;
    const height = Math.sqrt(3) * HEX_SIZE;
    const x = col * (width * 0.75) + HEX_SIZE;
    const y = row * height + HEX_SIZE + (col % 2 === 1 ? height / 2 : 0);
    return { x, y };
  }
  
function getHexVertices(row: number, col: number) {
    const center = getHexCenter(row, col);
    const angleOffset = 30;
    return Array.from({ length: 6 }).map((_, i) => {
        const angleDeg = angleOffset + i * 60;
        const angleRad = (Math.PI / 180) * angleDeg;
        const x = center.x + HEX_SIZE * Math.cos(angleRad);
        const y = center.y + HEX_SIZE * Math.sin(angleRad);
        return {
            x,
            y,
            id: `r${row}c${col}v${i}`
        };
    });
}

export { getHexCenter, getHexVertices };