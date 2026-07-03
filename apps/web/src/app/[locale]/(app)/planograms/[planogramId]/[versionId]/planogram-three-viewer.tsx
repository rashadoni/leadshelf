"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import type { EquipmentGeometryMm } from "@leadshelf/core"

type ViewerPlacement = {
  id: string
  shelfId: string
  xMm: number
  widthMm: number
  heightMm: number
  depthMm: number
  facingsX: number
  facingsY: number
  facingsZ: number
  product: { sku: string; name: string }
}

const PALETTE = [0x0ea5e9, 0x8b5cf6, 0xf59e0b, 0x10b981, 0xef4444, 0x6366f1, 0x14b8a6, 0xf97316]

function colorFor(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]!
}

function mm(value: number): number {
  return value / 1000
}

export function PlanogramThreeViewer({
  equipment,
  placements,
}: {
  equipment: EquipmentGeometryMm & { name: string }
  placements: ViewerPlacement[]
}) {
  const t = useTranslations("planograms.viewer3d")
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf8fafc)

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 20)
    const equipmentWidth = mm(equipment.widthMm)
    const equipmentHeight = mm(equipment.heightMm)
    const equipmentDepth = mm(equipment.depthMm)
    camera.position.set(equipmentWidth * 0.85, equipmentHeight * 0.72, equipmentDepth * 3.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.domElement.style.display = "block"
    renderer.domElement.style.width = "100%"
    renderer.domElement.style.height = "auto"
    rendererRef.current = renderer
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, equipmentHeight * 0.45, 0)
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI * 0.48

    scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 1.6))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6)
    keyLight.position.set(-2.2, 4, 3)
    keyLight.castShadow = true
    scene.add(keyLight)

    const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.58 })
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x44403c, roughness: 0.62 })
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.9 })
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.36 })

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(equipmentWidth * 1.08, 0.018, equipmentDepth * 1.28),
      floorMaterial,
    )
    floor.position.set(0, -0.018, 0)
    floor.receiveShadow = true
    scene.add(floor)

    for (const sideX of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.028, equipmentHeight, 0.028),
        postMaterial,
      )
      post.position.set(sideX * equipmentWidth * 0.5, equipmentHeight * 0.5, -equipmentDepth * 0.5)
      post.castShadow = true
      scene.add(post)
    }

    for (const shelf of equipment.shelves) {
      const shelfMesh = new THREE.Mesh(
        new THREE.BoxGeometry(equipmentWidth, mm(shelf.thicknessMm), mm(shelf.depthMm)),
        shelfMaterial,
      )
      shelfMesh.position.set(0, mm(shelf.yMm + shelf.thicknessMm / 2), 0)
      shelfMesh.castShadow = true
      shelfMesh.receiveShadow = true
      scene.add(shelfMesh)
    }

    for (const placement of placements) {
      const shelf = equipment.shelves.find((item) => item.id === placement.shelfId)
      if (!shelf) continue
      const width = mm(placement.widthMm * placement.facingsX)
      const height = mm(placement.heightMm * placement.facingsY)
      const depth = mm(placement.depthMm * placement.facingsZ)
      const productMaterial = new THREE.MeshStandardMaterial({
        color: colorFor(placement.product.sku),
        roughness: 0.55,
        metalness: 0.02,
      })
      const product = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), productMaterial)
      product.position.set(
        -equipmentWidth / 2 + mm(placement.xMm) + width / 2,
        mm(shelf.yMm + shelf.thicknessMm) + height / 2,
        -equipmentDepth / 2 + depth / 2,
      )
      product.castShadow = true
      product.receiveShadow = true
      scene.add(product)

      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(product.geometry), edgeMaterial)
      edges.position.copy(product.position)
      scene.add(edges)
    }

    const resize = () => {
      const width = Math.min(900, Math.max(320, Math.round(host.clientWidth || 640)))
      const height = Math.max(300, Math.round(width * 0.46))
      renderer.setSize(width, height, true)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)

    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      controls.update()
      renderer.render(scene, camera)
    }
    render()

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()
      rendererRef.current = null
      host.replaceChildren()
    }
  }, [equipment, placements])

  function exportScreenshot() {
    const renderer = rendererRef.current
    if (!renderer) return
    const url = renderer.domElement.toDataURL("image/png")
    const link = document.createElement("a")
    link.href = url
    link.download = `${equipment.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}-3d.png`
    link.click()
  }

  return (
    <section className="mt-4 rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <h2 className="font-semibold">{t("title")}</h2>
        <button
          type="button"
          onClick={exportScreenshot}
          className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          {t("screenshot")}
        </button>
      </div>
      <div ref={hostRef} data-testid="planogram-3d-viewer" className="min-h-[300px] w-full max-w-[900px] overflow-hidden" />
    </section>
  )
}
