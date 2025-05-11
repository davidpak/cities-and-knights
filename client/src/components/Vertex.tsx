interface VertexProps {
  id: string;
  x: number;
  y: number;
  onClick?: () => void;
}

const Vertex: React.FC<VertexProps> = ({ id, x, y, onClick }) => (
  <div
    className="vertex"
    style={{
      position: 'absolute',
      left: `${x}vw`, // use vw, not %, to match your hex layout
      top: `${y}vw`,
      transform: 'translate(-50%, -50%)',
    }}
    onClick={onClick}
    data-id={id}
  />
);

export default Vertex;
