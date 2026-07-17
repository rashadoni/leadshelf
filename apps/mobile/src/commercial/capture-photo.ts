import * as ImagePicker from "expo-image-picker"

export type CommercialPhotoCapture = {
  uri: string
  takenAt: string
}

export async function captureCommercialPhoto(): Promise<CommercialPhotoCapture | "denied" | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) return "denied"
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    quality: 0.72,
    exif: false,
  })
  if (result.canceled || !result.assets[0]?.uri) return null
  return { uri: result.assets[0].uri, takenAt: new Date().toISOString() }
}
