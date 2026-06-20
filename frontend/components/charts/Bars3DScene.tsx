'use client'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { Bar } from './Chart3D'

const NEON: Record<string, string> = {
  cyan: '#22e3ff', magenta: '#ff3df0', lime: '#7cff6b', amber: '#ffb020', violet: '#9d7bff',
}
const ORDER = ['cyan', 'magenta', 'lime', 'amber', 'violet']

/**
 * Cena WebGL: barras volumétricas neon com auto-rotação. Carregada só no client
 * (ssr:false) e só quando visível — ver Chart3D.
 */
export default function Bars3DScene({ data }: { data: Bar[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const n = data.length

  return (
    <Canvas camera={{ position: [4.5, 4, 8], fov: 42 }} dpr={[1, 1.8]} gl={{ antialias: true }}>
      <color attach="background" args={['#070b16']} />
      <ambientLight intensity={1.1} />
      <pointLight position={[6, 9, 6]} intensity={120} color="#22e3ff" />
      <pointLight position={[-6, 5, -4]} intensity={70} color="#ff3df0" />

      {data.map((d, i) => {
        const h = (d.value / max) * 3 + 0.06
        const x = (i - (n - 1) / 2) * 1.15
        const color = NEON[d.tone || ORDER[i % ORDER.length]]
        return (
          <mesh key={i} position={[x, h / 2, 0]} castShadow>
            <boxGeometry args={[0.72, h, 0.72]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.7}
              metalness={0.35}
              roughness={0.25}
            />
          </mesh>
        )
      })}

      <gridHelper args={[14, 14, '#22e3ff', '#16223a']} position={[0, 0, 0]} />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        autoRotate
        autoRotateSpeed={1.1}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  )
}
