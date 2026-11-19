import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { HostProvider } from '../state';
import { colors } from '../theme';

export default function RootLayout() {
  return (
    <HostProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.panel },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Braincade' }} />
        <Stack.Screen name="settings" options={{ title: 'Grown-ups' }} />
        <Stack.Screen name="play/[id]" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack>
    </HostProvider>
  );
}
