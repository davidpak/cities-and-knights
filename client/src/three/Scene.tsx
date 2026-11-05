/**
 * The table, lit like a toy: one soft warm key light with gentle shadows and a pastel sky light (lavender above,
 * peach bounce below), everything matte. The camera looks down at the island at a comfortable angle; you can turn
 * and zoom it a little, never so far that the board is hard to read.
 */
import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, type ReactNode } from 'react'
import { NeutralToneMapping, PCFSoftShadowMap } from 'three'
import '../lib/toy.ts'
import { PAL } from '../lib/palette.ts'

/** keeps the whole board in view whatever the window's shape */
function Framing({ focus }: { focus: [number, number, number] }) {
  const { camera, size } = useThree()
  useEffect(() => {
    const aspect = size.width / size.height
    const d = aspect < 1 ? 1180 / Math.max(0.4, aspect) : aspect < 1.35 ? 1250 : 1120
    camera.position.set(focus[0], focus[1] + d * 0.78, focus[2] + d * 0.62)
    camera.lookAt(...focus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, size.width, size.height, focus.join()])
  return null
}

export function Scene({ children, focus = [30, 0, 100] }: { children: ReactNode; focus?: [number, number, number] }) {
  return (
    <Canvas
      shadows={{ type: PCFSoftShadowMap }}
      dpr={[1, 2]}
      camera={{ fov: 32, near: 5, far: 6000, position: [0, 800, 640] }}
      gl={{ antialias: true, toneMapping: NeutralToneMapping, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={[PAL.bg]} />
      <fog attach="fog" args={[PAL.bg, 1600, 3200]} />
      <hemisphereLight args={['#d6cff5', '#f1d0b4', 1.35]} />
      <directionalLight
        castShadow
        position={[-520, 1100, 760]}
        intensity={2.1}
        color="#fff1e2"
        shadow-mapSize={[2048, 2048]}
        shadow-radius={5}
        shadow-bias={-0.0004}
        shadow-normalBias={1.2}
        shadow-camera-left={-520}
        shadow-camera-right={520}
        shadow-camera-top={520}
        shadow-camera-bottom={-520}
        shadow-camera-near={100}
        shadow-camera-far={3000}
      />
      <Framing focus={focus} />
      <OrbitControls
        makeDefault
        target={focus}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minPolarAngle={0.2}
        maxPolarAngle={1.05}
        minDistance={420}
        maxDistance={2000}
        rotateSpeed={0.5}
      />
      {children}
    </Canvas>
  )
}
