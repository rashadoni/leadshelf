// Планограмма «вид спереди» из иммутабельного бандла: рама, полки,
// размещения цвет-боксами с SKU. Фото товаров — следующий срез (кэш медиа).
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg"
import { useWindowDimensions, View } from "react-native"

interface Shelf {
  id: string
  yMm: number
  thicknessMm: number
}
interface Placement {
  id: string
  shelfId: string | null
  xMm: number
  widthMm: number
  heightMm: number
  facingsX: number
  facingsY: number
  product: { sku: string; name: string }
}
export interface Bundle {
  equipment: Array<{
    widthMm: number
    heightMm: number
    shelves: Shelf[]
  }>
  placements: Placement[]
}

const PALETTE = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#6366f1", "#14b8a6", "#f97316"]
function colorFor(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]!
}

export function PlanogramSvg({ bundle }: { bundle: Bundle }) {
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
          return (
            <>
              <Rect
                key={p.id}
                x={x}
                y={y}
                width={wPx}
                height={hPx}
                fill={colorFor(p.product.sku)}
                opacity={0.85}
                stroke="white"
                strokeWidth={0.8}
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
            </>
          )
        })}
      </Svg>
    </View>
  )
}
