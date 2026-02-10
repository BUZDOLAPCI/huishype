import React, { useState, useCallback } from 'react';
import { Text, View, Pressable } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';

import Colors from '@/constants/Colors';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { AuthModal } from '@/src/components';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={24} style={{ marginBottom: -3 }} {...props} />;
}

/** Get 1-2 letter initials from a display name or username */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function HeaderAuthButton() {
  const { user, isAuthenticated } = useAuthContext();
  const [showAuth, setShowAuth] = useState(false);

  const handlePress = useCallback(() => {
    if (!isAuthenticated) {
      setShowAuth(true);
    }
  }, [isAuthenticated]);

  if (isAuthenticated && user) {
    const initials = getInitials(user.displayName || user.username || '?');
    return (
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: '#3B82F6',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 16,
        }}
        testID="header-user-avatar"
      >
        <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>
          {initials}
        </Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={handlePress}
        style={{ marginRight: 16, paddingVertical: 6, paddingHorizontal: 12 }}
        testID="header-login-button"
      >
        <Text style={{ color: '#3B82F6', fontSize: 15, fontWeight: '600' }}>
          Log in
        </Text>
      </Pressable>
      <AuthModal
        visible={showAuth}
        onClose={() => setShowAuth(false)}
        message="Sign in to HuisHype"
        onSuccess={() => setShowAuth(false)}
      />
    </>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: true,
        headerRight: () => <HeaderAuthButton />,
        tabBarStyle: {
          backgroundColor: colorScheme === 'dark' ? '#1a1a1a' : '#ffffff',
          borderTopColor: colorScheme === 'dark' ? '#333' : '#e5e5e5',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
          headerTitle: 'HuisHype',
          tabBarIcon: ({ color }) => <TabBarIcon name="map" color={color} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          headerTitle: 'Feed',
          tabBarIcon: ({ color }) => <TabBarIcon name="list" color={color} />,
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          headerTitle: 'Saved Properties',
          tabBarIcon: ({ color }) => <TabBarIcon name="bookmark" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerTitle: 'My Profile',
          tabBarIcon: ({ color }) => <TabBarIcon name="user" color={color} />,
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          href: null, // Hide this tab
        }}
      />
    </Tabs>
  );
}
