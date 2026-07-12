// Экран переехал: маршруты теперь главная вкладка нижней навигации.
// Редирект сохраняет старые диплинки/пуш-переходы.
import { Redirect } from "expo-router"

export default function RoutesRedirect() {
  return <Redirect href={"/(app)/(tabs)" as never} />
}
