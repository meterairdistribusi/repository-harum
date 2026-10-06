import { Alert, Platform } from 'react-native';

/** Dialog konfirmasi Ya/Batal yang juga jalan di web. */
export function confirmAsync(title, message, okText = 'Ya') {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Batal', style: 'cancel', onPress: () => resolve(false) },
      { text: okText, style: 'destructive', onPress: () => resolve(true) },
    ])
  );
}

/** Pesan informasi sederhana. */
export function notify(title, message) {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}
