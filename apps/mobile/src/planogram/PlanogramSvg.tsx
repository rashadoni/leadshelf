// Планограмма «вид спереди» из иммутабельного бандла: рама, полки,
// размещения цвет-боксами с SKU. Фото товаров — следующий срез (кэш медиа).
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg"
import { useWindowDimensions, View } from "react-native"

interface Shelf {
  id: string
  shelfIndex?: number
  yMm: number
  thicknessMm: number
}
export interface PlanogramPlacement {
  id: string
  shelfId: string | null
  xMm: number
  yMm?: number
  widthMm: number
  heightMm: number
  depthMm?: number
  facingsX: number
  facingsY: number
  facingsZ?: number
  product: {
    id?: string
    sku: string
    name: string
    unit?: string
    brandName?: string | null
    barcode?: string | null
    imageKey?: string | null
  }
}

export interface PlanogramChangeItem {
  kind: "added" | "removed" | "moved" | "changed"
  placementId?: string | null
  product?: PlanogramPlacement["product"] | null
  sku?: string | null
  name?: string | null
  fromShelfIndex?: number | null
  toShelfIndex?: number | null
  fromFacings?: string | null
  toFacings?: string | null
  note?: string | null
}

export interface Bundle {
  equipment: Array<{
    planogramEquipmentId?: string
    name?: string
    widthMm: number
    heightMm: number
    depthMm?: number
    shelves: Shelf[]
  }>
  placements: PlanogramPlacement[]
  changes?: PlanogramChangeItem[]
}

const PALETTE = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#6366f1", "#14b8a6", "#f97316"]
function colorFor(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]!
}

export function PlanogramSvg({
  bundle,
  selectedPlacementId,
  onPlacementPress,
}: {
  bundle: Bundle
  selectedPlacementId?: string | null
  onPlacementPress?: (placementId: string) => void
}) {
  const { width: screenW } = useWindowDimensions()
  const eq = bundle.equipment[0]
  if (!eq) return null

  const W = screenW - 24
  const k = W / eq.widthMm
  const H = eq.heightMm * k
  const shelfById = new Map(eq.shelves.map((s) => [s.id, s]))

  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={0} y={0} width={W} height={H} fill="#f5f5f4" stroke="#a8a29e" strokeWidth={1} />
        {eq.shelves.map((s) => (
          <Rect
            key={s.id}
            x={0}
            y={H - (s.yMm + s.thicknessMm) * k}
            width={W}
            height={Math.max(2, s.thicknessMm * k)}
            fill="#78716c"
          />
        ))}
        {bundle.placements.map((p) => {
          const shelf = p.shelfId ? shelfById.get(p.shelfId) : null
          if (!shelf) return null
          const wPx = p.widthMm * p.facingsX * k
          const hPx = p.heightMm * p.facingsY * k
          const x = p.xMm * k
          const y = H - (shelf.yMm + shelf.thicknessMm + p.heightMm * p.facingsY) * k
          const selected = selectedPlacementId === p.id
          return (
            <G key={p.id} onPress={() => onPlacementPress?.(p.id)}>
              <Rect
                x={x}
                y={y}
                width={wPx}
                height={hPx}
                fill={colorFor(p.product.sku)}
                opacity={0.85}
                stroke={selected ? "#171717" : "white"}
                strokeWidth={selected ? 2 : 0.8}
              />
              {Array.from({ length: p.facingsX - 1 }, (_, i) => (
                <Line
                  key={`${p.id}-f${i}`}
                  x1={x + (i + 1) * p.widthMm * k}
                  y1={y}
                  x2={x + (i + 1) * p.widthMm * k}
                  y2={y + hPx}
                  stroke="white"
                  strokeWidth={0.6}
                  opacity={0.6}
                />
              ))}
              {wPx > 30 && (
                <SvgText key={`${p.id}-t`} x={x + 3} y={y + 11} fontSize={9} fill="white">
                  {p.product.sku}
                </SvgText>
              )}
            </G>
          )
        })}
      </Svg>
    </View>
  )
}
