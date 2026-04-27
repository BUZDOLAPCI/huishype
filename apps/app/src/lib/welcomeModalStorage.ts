import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const WELCOME_MODAL_DISMISSED_KEY = 'huishype_welcome_modal_dismissed_v1';
const DISMISSED_VALUE = '1';

function readWebDismissedFlag(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  return localStorage.getItem(WELCOME_MODAL_DISMISSED_KEY) === DISMISSED_VALUE;
}

function writeWebDismissedFlag(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(WELCOME_MODAL_DISMISSED_KEY, DISMISSED_VALUE);
}

export async function getWelcomeModalDismissed(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return readWebDismissedFlag();
  }

  const storedValue = await SecureStore.getItemAsync(WELCOME_MODAL_DISMISSED_KEY);
  return storedValue === DISMISSED_VALUE;
}

export async function markWelcomeModalDismissed(): Promise<void> {
  if (Platform.OS === 'web') {
    writeWebDismissedFlag();
    return;
  }

  await SecureStore.setItemAsync(WELCOME_MODAL_DISMISSED_KEY, DISMISSED_VALUE);
}

