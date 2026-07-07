// Мини-рендер планограммы (docs/27 P0/#4): реальные полки и товары вместо
// серых полосок-скелетонов. Чистый SVG в мм-масштабе, серверный компонент.

export interface ThumbnailShelf {
  shelfIndex: number
  yMm: number
  thicknessMm: number
}

export interface ThumbnailPlacement {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  facingsX: number
  facingsY: number
  productId: string
}

function productFill(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360
  return `hsl(${hash} 62% 60%)`
}

export function PlanogramThumbnail({
  shelves,
  placements,
  className,
}: {
  shelves: ThumbnailShelf[]
  placements: ThumbnailPlacement[]
  className?: string
}) {
  const facW = (p: ThumbnailPlacement) => p.widthMm * Math.max(1, p.facingsX)
  const facH = (p: ThumbnailPlacement) => p.heightMm * Math.max(1, p.facingsY)

  const widthMm = Math.max(
    1,
    ...placements.map((p) => p.xMm + facW(p)),
  )
  const heightMm = Math.max(
    1,
    ...shelves.map((s) => s.yMm + s.thicknessMm),
    ...placements.map((p) => p.yMm + facH(p)),
  )
  const pad = Math.max(widthMm, heightMm) * 0.02

  if (placements.length === 0 && shelves.length === 0) {
    return (
      <div className={`flex items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-[10px] text-neutral-400 ${className ?? ""}`}>
        —
      </div>
    )
  }

  return (
    <svg
      viewBox={`${-pad} ${-pad} ${widthMm + pad * 2} ${heightMm + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      className={`rounded-md border border-neutral-200 bg-white ${className ?? ""}`}
      role="img"
    >
      {shelves.map((s) => (
        <rect
          key={s.shelfIndex}
          x={0}
          y={heightMm - s.yMm - Math.max(s.thicknessMm, heightMm * 0.008)}
          width={widthMm}
          height={Math.max(s.thicknessMm, heightMm * 0.008)}
          fill="#d4d4d4"
        />
      ))}
      {placements.map((p, index) => {
        const w = facW(p)
        const h = facH(p)
        const x = p.xMm
        const y = heightMm - p.yMm - h
        const facings = Math.max(1, p.facingsX)
        const fill = productFill(p.productId)
        return (
          <g key={`${p.productId}-${index}`}>
            <rect x={x} y={y} width={w} height={h} fill={fill} stroke="#00000022" strokeWidth={Math.max(1, widthMm * 0.002)} rx={Math.max(1, widthMm * 0.004)} />
            {facings > 1
              ? Array.from({ length: facings - 1 }, (_, f) => (
                  <line
                    key={f}
                    x1={x + (w / facings) * (f + 1)}
                    y1={y}
                    x2={x + (w / facings) * (f + 1)}
                    y2={y + h}
                    stroke="#ffffff66"
                    strokeWidth={Math.max(1, widthMm * 0.0015)}
                  />
                ))
              : null}
          </g>
        )
      })}
    </svg>
  )
}
