/** the game's name, set like a title page: big and plain */
export function Title({ small }: { small?: boolean }) {
  return (
    <h1 className={`title ${small ? 'small' : ''}`}>
      <span>Towns</span>
      <span className="and">and Peasants</span>
    </h1>
  )
}
