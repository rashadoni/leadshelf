import { useEffect, useState } from "react"
import {
  Image,
  View,
  type ImageResizeMode,
  type ImageStyle,
  type StyleProp,
} from "react-native"
import { materializeEncryptedMedia } from "../media/encrypted-media-store"

export function EncryptedMediaImage({
  uri,
  style,
  resizeMode,
}: {
  uri: string
  style?: StyleProp<ImageStyle>
  resizeMode?: ImageResizeMode
}) {
  const [temporaryUri, setTemporaryUri] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let cleanup: (() => Promise<void>) | null = null
    void materializeEncryptedMedia(uri).then((materialized) => {
      cleanup = materialized.cleanup
      if (active) setTemporaryUri(materialized.uri)
      else void materialized.cleanup().catch(() => undefined)
    }).catch(() => {
      if (active) setTemporaryUri(null)
    })
    return () => {
      active = false
      if (cleanup) void cleanup().catch(() => undefined)
    }
  }, [uri])

  return temporaryUri
    ? <Image source={{ uri: temporaryUri }} resizeMode={resizeMode} style={style} />
    : <View style={style} />
}
