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
  | "camera"
  | "document"
  | "alert"
  | "info"
  | "search"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "add"
  | "check"
  | "refresh"
  | "play"
  | "pause"
  | "stop"

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
    case "camera":
      return (
        <Svg {...common} fill="none">
          <Path d="M4.5 8.1h3l1.4-2h6.2l1.4 2h3A1.5 1.5 0 0 1 21 9.6v8.9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V9.6a1.5 1.5 0 0 1 1.5-1.5Z" stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
          <Circle cx={12} cy={14} r={3.25} stroke={color} strokeWidth={1.7} />
        </Svg>
      )
    case "document":
      return (
        <Svg {...common} fill="none">
          <Path d="M6.2 3.5h7.1l4.5 4.5v11A1.5 1.5 0 0 1 16.3 20.5H6.2A1.5 1.5 0 0 1 4.7 19V5A1.5 1.5 0 0 1 6.2 3.5Z" stroke={color} strokeWidth={1.75} strokeLinejoin="round" />
          <Path d="M13.2 3.9v4.3h4.2M8 12h6.5M8 15.5h5" stroke={color} strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )
    case "alert":
      return (
        <Svg {...common} fill="none">
          <Path d="M12 4.1 21 19.6a1.25 1.25 0 0 1-1.08 1.9H4.08A1.25 1.25 0 0 1 3 19.6L12 4.1Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
          <Path d="M12 9v5.1M12 17.4v.1" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
        </Svg>
      )
    case "info":
      return (
        <Svg {...common} fill="none">
          <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={1.8} />
          <Path d="M12 10.7v5M12 8v.1" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
        </Svg>
      )
    case "search":
      return (
        <Svg {...common} fill="none">
          <Circle cx={10.6} cy={10.6} r={5.7} stroke={color} strokeWidth={1.9} />
          <Path d="m15 15 4.2 4.2" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
        </Svg>
      )
    case "chevronLeft":
      return (
        <Svg {...common} fill="none">
          <Path d="m14.5 5.5-6 6.5 6 6.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )
    case "chevronRight":
      return (
        <Svg {...common} fill="none">
          <Path d="m9.5 5.5 6 6.5-6 6.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )
    case "chevronDown":
      return (
        <Svg {...common} fill="none">
          <Path d="m5.5 9.5 6.5 6 6.5-6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )
    case "add":
      return (
        <Svg {...common} fill="none">
          <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={1.8} />
          <Path d="M12 8v8M8 12h8" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
        </Svg>
      )
    case "check":
      return (
        <Svg {...common} fill="none">
          <Path d="m5.5 12.3 4.1 4.1 8.9-9" stroke={color} strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )
    case "refresh":
      return (
        <Svg {...common} fill="none">
          <Path d="M19.2 10.3A7.5 7.5 0 1 0 20 14" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
          <Path d="M19.2 5.5v4.8h-4.8" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )
    case "play":
      return (
        <Svg {...common} fill="none">
          <Path d="m8.7 6.4 8.3 5.1a.6.6 0 0 1 0 1l-8.3 5.1A.75.75 0 0 1 7.5 17V7a.75.75 0 0 1 1.2-.6Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
        </Svg>
      )
    case "pause":
      return (
        <Svg {...common} fill="none">
          <Rect x={7} y={6} width={3.5} height={12} rx={1} stroke={color} strokeWidth={1.8} />
          <Rect x={13.5} y={6} width={3.5} height={12} rx={1} stroke={color} strokeWidth={1.8} />
        </Svg>
      )
    case "stop":
      return (
        <Svg {...common} fill="none">
          <Rect x={6.5} y={6.5} width={11} height={11} rx={1.5} stroke={color} strokeWidth={1.8} />
        </Svg>
      )
  }
}
