import '../src/bootstrap/styles';

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import {
  DMSans_400Regular,
  DMSans_500Medium,
} from '@expo-google-fonts/dm-sans';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { QueryProvider } from '@/src/providers/QueryProvider';
import { AuthProvider } from '@/src/providers/AuthProvider';
import { DeepLinkRouteSync } from '@/src/providers/DeepLinkRouteSync';
import { WebPersistentMapHost } from '@/src/screens/WebPersistentMapHost';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryProvider>
        <AuthProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <DeepLinkRouteSync />
            <View
              pointerEvents="box-none"
              style={{ flex: 1, position: 'relative' }}
            >
              <Stack>
                <Stack.Screen
                  name="(tabs)"
                  options={{
                    headerShown: false,
                    ...(Platform.OS === 'web'
                      ? {
                          contentStyle: { backgroundColor: 'transparent' },
                        }
                      : {}),
                  }}
                />
                <Stack.Screen
                  name="@[camera]"
                  options={{
                    headerShown: false,
                    ...(Platform.OS === 'web'
                      ? {
                          presentation: 'transparentModal',
                          contentStyle: { backgroundColor: 'transparent' },
                        }
                      : {}),
                  }}
                />
                <Stack.Screen
                  name="map/index"
                  options={{
                    headerShown: false,
                    ...(Platform.OS === 'web'
                      ? {
                          presentation: 'transparentModal',
                          contentStyle: { backgroundColor: 'transparent' },
                        }
                      : {}),
                  }}
                />
                <Stack.Screen
                  name="map/[...address]"
                  options={{
                    headerShown: false,
                    ...(Platform.OS === 'web'
                      ? {
                          presentation: 'transparentModal',
                          contentStyle: { backgroundColor: 'transparent' },
                        }
                      : {}),
                  }}
                />
                <Stack.Screen
                  name="map/[city]/[postcode]/[street]/[house]"
                  options={{
                    headerShown: false,
                    ...(Platform.OS === 'web'
                      ? {
                          presentation: 'transparentModal',
                          contentStyle: { backgroundColor: 'transparent' },
                        }
                      : {}),
                  }}
                />
                <Stack.Screen
                  name="map/[country]/[city]/[postcode]/[street]/[house]"
                  options={{
                    headerShown: false,
                    ...(Platform.OS === 'web'
                      ? {
                          presentation: 'transparentModal',
                          contentStyle: { backgroundColor: 'transparent' },
                        }
                      : {}),
                  }}
                />
                <Stack.Screen
                  name="[...address]"
                  options={{
                    headerShown: false,
                    ...(Platform.OS === 'web'
                      ? {
                          presentation: 'transparentModal',
                          contentStyle: { backgroundColor: 'transparent' },
                        }
                      : {}),
                  }}
                />
                <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
                <Stack.Screen name="leaderboard" options={{ headerShown: false }} />
                <Stack.Screen name="notifications" options={{ headerShown: false }} />
                <Stack.Screen name="showcase/consensus-alignment" options={{ headerShown: false }} />
                <Stack.Screen name="showcase/fmv-visualization" options={{ headerShown: false }} />
                <Stack.Screen name="showcase/pdok-aerial-imagery" options={{ headerShown: false }} />
              </Stack>
            </View>
            <WebPersistentMapHost />
          </ThemeProvider>
        </AuthProvider>
      </QueryProvider>
    </GestureHandlerRootView>
  );
}
