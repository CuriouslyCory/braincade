import { launcherEntries, platformCapabilities } from '@braincade/game-host';
import { Link, Stack } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { nativePlatform } from '../native-platform';
import { useHost } from '../state';
import { colors } from '../theme';

const capabilities = platformCapabilities(nativePlatform([]));

export default function LauncherScreen() {
  const { catalog, profile, reload } = useHost();
  const entries =
    catalog.status === 'ready'
      ? launcherEntries(
          catalog.catalog.games.map((manifest) => ({ manifest })),
          { showDrafts: __DEV__ || profile.showDrafts, capabilities },
        )
      : [];

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable>
                <Text style={styles.headerLink}>Grown-ups</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.manifest.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={catalog.status === 'loading'}
            onRefresh={() => void reload()}
            tintColor={colors.text}
          />
        }
        ListHeaderComponent={
          <Text style={styles.greeting}>
            {profile.name ? `Hey ${profile.name}!` : 'Pick a game'}
          </Text>
        }
        ListEmptyComponent={
          <Text style={styles.muted}>
            {catalog.status === 'error'
              ? catalog.message
              : catalog.status === 'loading'
                ? 'Loading games…'
                : 'No games yet.'}
          </Text>
        }
        renderItem={({ item: { manifest, missing } }) => {
          const card = (
            <View style={[styles.card, missing.length > 0 && styles.disabled]}>
              <Text style={styles.icon}>{manifest.icon}</Text>
              <View style={styles.cardText}>
                <Text style={styles.title}>
                  {manifest.title}
                  {manifest.status === 'draft' ? '  (draft)' : ''}
                </Text>
                <Text style={styles.muted}>{manifest.description}</Text>
                {missing.length > 0 && <Text style={styles.needs}>Needs {missing.join(', ')}</Text>}
              </View>
            </View>
          );
          return missing.length > 0 ? (
            card
          ) : (
            <Link href={{ pathname: '/play/[id]', params: { id: manifest.id } }} asChild>
              <Pressable>{card}</Pressable>
            </Link>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { padding: 16, gap: 12 },
  greeting: { color: colors.text, fontSize: 28, fontWeight: '800', marginBottom: 8 },
  headerLink: { color: colors.accent2, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    gap: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.panel,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  icon: { fontSize: 40 },
  cardText: { flex: 1, gap: 4 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  muted: { color: colors.muted },
  needs: { color: colors.danger, fontSize: 12 },
});
