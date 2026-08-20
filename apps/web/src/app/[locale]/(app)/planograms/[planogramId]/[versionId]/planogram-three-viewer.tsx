"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import type { EquipmentGeometryMm } from "@leadshelf/core"
import {
  buildPlanogramThreeSceneModel,
  type SceneBox,
  type ThreeViewerPlacement,
} from "./planogram-three-scene"

const PALETTE = [0x0ea5e9, 0x8b5cf6, 0xf59e0b, 0x10b981, 0xef4444, 0x6366f1, 0x14b8a6, 0xf97316]

function colorFor(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]!
}

function applyPosition(mesh: THREE.Object3D, box: SceneBox) {
  mesh.position.set(box.position.x, box.position.y, box.position.z)
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return
    object.geometry.dispose()
    const material = object.material
    if (Array.isArray(material)) {
      for (const item of material) item.dispose()
    } else {
      material.dispose()
    }
  })
}

export function PlanogramThreeViewer({
  equipment,
  placements,
}: {
  equipment: EquipmentGeometryMm & { name: string }
  placements: ThreeViewerPlacement[]
}) {
  const t = useTranslations("planograms.viewer3d")
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const [rendererUnavailable, setRendererUnavailable] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf8fafc)
    const sceneModel = buildPlanogramThreeSceneModel(equipment, placements)

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 20)
    camera.position.set(sceneModel.cameraPosition.x, sceneModel.cameraPosition.y, sceneModel.cameraPosition.z)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    } catch {
      rendererRef.current = null
      setRendererUnavailable(true)
      return
    }
    setRendererUnavailable(false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.domElement.style.display = "block"
    renderer.domElement.style.width = "100%"
    renderer.domElement.style.height = "auto"
    rendererRef.current = renderer
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(sceneModel.controlTarget.x, sceneModel.controlTarget.y, sceneModel.controlTarget.z)
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
      new THREE.BoxGeometry(sceneModel.floor.width, sceneModel.floor.height, sceneModel.floor.depth),
      floorMaterial,
    )
    applyPosition(floor, sceneModel.floor)
    floor.receiveShadow = true
    scene.add(floor)

    for (const postBox of sceneModel.posts) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(postBox.width, postBox.height, postBox.depth),
        postMaterial,
      )
      applyPosition(post, postBox)
      post.castShadow = true
      scene.add(post)
    }

    for (const shelf of sceneModel.shelves) {
      const shelfMesh = new THREE.Mesh(
        new THREE.BoxGeometry(shelf.width, shelf.height, shelf.depth),
        shelfMaterial,
      )
      applyPosition(shelfMesh, shelf)
      shelfMesh.castShadow = true
      shelfMesh.receiveShadow = true
      scene.add(shelfMesh)
    }

    for (const productBox of sceneModel.products) {
      const productMaterial = new THREE.MeshStandardMaterial({
        color: colorFor(productBox.sku),
        roughness: 0.55,
        metalness: 0.02,
      })
      const product = new THREE.Mesh(
        new THREE.BoxGeometry(productBox.width, productBox.height, productBox.depth),
        productMaterial,
      )
      applyPosition(product, productBox)
      product.castShadow = true
      product.receiveShadow = true
      scene.add(product)

      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(product.geometry), edgeMaterial)
      edges.position.copy(product.position)
      scene.add(edges)
    }

    const resize = () => {
      const measuredWidth = Math.round(host.clientWidth)
      const width = measuredWidth > 0 ? measuredWidth : 640
      const height = Math.max(420, Math.min(720, Math.round(width * 0.52)))
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
      disposeScene(scene)
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
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <section className="mt-4 rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <h2 className="font-semibold">{t("title")}</h2>
        <button
          type="button"
          onClick={exportScreenshot}
          disabled={rendererUnavailable}
          className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {t("screenshot")}
        </button>
      </div>
      <div
        data-testid="planogram-3d-viewer"
        data-renderer-state={rendererUnavailable ? "unavailable" : "ready"}
        className="relative min-h-[420px] w-full overflow-hidden"
      >
        <div ref={hostRef} className={rendererUnavailable ? "hidden" : "min-h-[420px] w-full"} />
        {rendererUnavailable ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950">
              <p className="text-sm font-semibold">{t("unavailableTitle")}</p>
              <p className="mt-1 text-xs text-amber-800">{t("unavailableBody")}</p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
