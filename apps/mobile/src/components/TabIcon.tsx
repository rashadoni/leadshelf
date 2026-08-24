// Иконки нижней навигации. Рисуем сами на react-native-svg (уже в зависимостях),
// чтобы не тащить пакет шрифтовых иконок ради пяти глифов.
import type { ColorValue } from "react-native"
import Svg, { Circle, Path, Rect } from "react-native-svg"

export type TabIconName =
  | "today"
  | "week"
  | "work"
  | "inbox"
  | "route"
  | "visit"
  | "tasks"
  | "shelves"
  | "planograms"
  | "dashboard"
  | "orders"
  | "organizations"
  | "contacts"
  | "profile"
  | "location"
  | "qr"

export function TabIcon({ name, color, size = 24 }: { name: TabIconName; color: ColorValue; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24" }
  switch (name) {
    case "today":
      return (
        <Svg {...common} fill="none">
          <Path d="M4.5 10.5 12 4l7.5 6.5v8a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-8Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
          <Path d="M9.5 20v-5.8h5V20" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
        </Svg>
      )
    case "week":
      return (
        <Svg {...common} fill="none">
          <Rect x={3.5} y={5.2} width={17} height={15} rx={2.2} stroke={color} strokeWidth={1.8} />
          <Path d="M7.5 3.5v3.4M16.5 3.5v3.4M3.8 9.4h16.4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
          <Circle cx={8} cy={13.2} r={1.1} fill={color} /><Circle cx={12} cy={13.2} r={1.1} fill={color} /><Circle cx={16} cy={13.2} r={1.1} fill={color} />
        </Svg>
      )
    case "work":
      return (
        <Svg {...common} fill="none">
          {[4, 10.3, 16.6].flatMap((x) => [4, 10.3, 16.6].map((y) => (
            <Rect key={`${x}-${y}`} x={x} y={y} width={3.4} height={3.4} rx={0.8} stroke={color} strokeWidth={1.5} />
          )))}
        </Svg>
      )
    case "inbox":
      return (
        <Svg {...common} fill="none">
          <Rect x={3.5} y={5} width={17} height={14} rx={2.2} stroke={color} strokeWidth={1.8} />
          <Path d="m5 7 7 5.3L19 7" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )
    case "route":
      // Стрелка-навигация (как на образце)
      return (
        <Svg {...common} fill="none">
          <Path
            d="M21 3 3.6 10.4c-.9.38-.83 1.68.1 1.97l6.6 2.06a1 1 0 0 1 .66.66l2.06 6.6c.29.93 1.59 1 1.97.1L21.4 4.4A1.05 1.05 0 0 0 21 3Z"
            stroke={color}
            strokeWidth={1.9}
            strokeLinejoin="round"
          />
        </Svg>
      )
    case "visit":
      // Галочка в круге
      return (
        <Svg {...common} fill="none">
          <Circle cx={12} cy={12} r={8.6} stroke={color} strokeWidth={1.9} />
          <Path d="m8.4 12.2 2.4 2.4 4.8-4.9" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )
    case "tasks":
      return (
        <Svg {...common} fill="none">
          <Rect x={5} y={4} width={14} height={16} rx={2} stroke={color} strokeWidth={1.8} />
          <Path d="M9 8h6M9 12h6M9 16h4" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
        </Svg>
      )
    case "shelves":
      return (
        <Svg {...common} fill="none">
          <Path d="M5 3.5v17M19 3.5v17M5 8h14M5 13h14M5 18h14" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
      )
    case "planograms":
      return (
        <Svg {...common} fill="none">
          <Rect x={3.5} y={4} width={17} height={16} rx={2} stroke={color} strokeWidth={1.7} />
          <Path d="M4 10h16M4 16h16M9 4v6M14.5 10v6M8 16v4" stroke={color} strokeWidth={1.5} />
        </Svg>
      )
    case "dashboard":
      // Столбчатая диаграмма
      return (
        <Svg {...common} fill="none">
          <Rect x={4} y={12.5} width={3.4} height={7} rx={1} stroke={color} strokeWidth={1.7} />
          <Rect x={10.3} y={7.5} width={3.4} height={12} rx={1} stroke={color} strokeWidth={1.7} />
          <Rect x={16.6} y={10} width={3.4} height={9.5} rx={1} stroke={color} strokeWidth={1.7} />
        </Svg>
      )
    case "orders":
      // Квитанция с зубчатым низом
      return (
        <Svg {...common} fill="none">
          <Path
            d="M6 3.8h12v15.4l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4V3.8Z"
            stroke={color}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          <Path d="M9 8.4h6M9 11.6h6" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
        </Svg>
      )
    case "organizations":
      return (
        <Svg {...common} fill="none">
          <Path d="M4.5 20V6.5L12 3l7.5 3.5V20M8 8.2h1.5M14.5 8.2H16M8 12h1.5M14.5 12H16M10 20v-4h4v4" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )
    case "contacts":
      return (
        <Svg {...common} fill="none">
          <Rect x={3.5} y={4} width={17} height={16} rx={2.2} stroke={color} strokeWidth={1.7} />
          <Circle cx={9} cy={9.2} r={2.1} stroke={color} strokeWidth={1.6} />
          <Path d="M5.8 15.2c.7-1.8 1.8-2.7 3.2-2.7s2.5.9 3.2 2.7M14.5 8h3M14.5 11h3M14.5 14h2" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
      )
    case "profile":
      // Пользователь
      return (
        <Svg {...common} fill="none">
          <Circle cx={12} cy={8.2} r={3.5} stroke={color} strokeWidth={1.9} />
          <Path d="M5.2 19.6a6.9 6.9 0 0 1 13.6 0" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
        </Svg>
      )
    case "location":
      return (
        <Svg {...common} fill="none">
          <Path d="M12 21s6.4-5.7 6.4-11A6.4 6.4 0 1 0 5.6 10C5.6 15.3 12 21 12 21Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
          <Circle cx={12} cy={10} r={2.25} stroke={color} strokeWidth={1.8} />
        </Svg>
      )
    case "qr":
      return (
        <Svg {...common} fill="none">
          <Path d="M4 9V5.7A1.7 1.7 0 0 1 5.7 4H9M15 4h3.3A1.7 1.7 0 0 1 20 5.7V9M20 15v3.3a1.7 1.7 0 0 1-1.7 1.7H15M9 20H5.7A1.7 1.7 0 0 1 4 18.3V15" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
          <Path d="M9 9h2.3v2.3H9zM13.3 9h1.7v1.7h-1.7zM13.3 13.3h2.7V16h-2.7zM9 14.3h1.7V16H9z" stroke={color} strokeWidth={1.55} strokeLinejoin="round" />
        </Svg>
      )
  }
}
