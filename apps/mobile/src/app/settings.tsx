import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useHost } from '../state';
import { colors } from '../theme';

export default function SettingsScreen() {
  const { settings, profile, baseUrl, catalog, saveSettings, saveProfile, reload } = useHost();
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [name, setName] = useState(profile.name);
  const [interests, setInterests] = useState(profile.interests.join(', '));
  const [showDrafts, setShowDrafts] = useState(profile.showDrafts);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaved(false);
    setError('');
    try {
      await saveProfile({
        name: name.trim(),
        interests: interests
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        showDrafts,
      });
      await saveSettings({ serverUrl: serverUrl.trim() });
      setSaved(true);
    } catch (e) {
      setError(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.heading}>Learner</Text>
      <Field label="Name" value={name} onChangeText={setName} />
      <Field
        label="Interests (comma separated)"
        value={interests}
        onChangeText={setInterests}
        placeholder="minecraft, soccer, dinosaurs"
      />
      <View style={styles.row}>
        <Text style={styles.label}>Show draft games</Text>
        <Switch value={showDrafts} onValueChange={setShowDrafts} />
      </View>

      <Text style={styles.heading}>Server</Text>
      <Field
        label="Braincade URL (leave empty for the default)"
        value={serverUrl}
        onChangeText={setServerUrl}
        placeholder="http://192.168.1.20:5173"
        autoCapitalize="none"
        keyboardType="url"
      />
      <Text style={styles.muted}>Using: {baseUrl ?? 'not set'}</Text>
      <Text style={styles.muted}>
        {catalog.status === 'ready'
          ? `${catalog.catalog.games.length} games, ${catalog.catalog.wordLists.length} word lists (${catalog.source}, published ${catalog.catalog.generatedAt})`
          : catalog.status === 'error'
            ? catalog.message
            : 'Loading…'}
      </Text>

      <View style={styles.row}>
        <Pressable style={styles.button} onPress={() => void save()}>
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={() => void reload()}>
          <Text style={styles.buttonText}>Reload games</Text>
        </Pressable>
        {saved && <Text style={styles.saved}>Saved</Text>}
      </View>
      {error !== '' && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.muted}>
        Word progress and the rematch sheet are in the web app's Grown-ups page for now.
      </Text>
    </ScrollView>
  );
}

function Field({ label, ...input }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.muted} {...input} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 12 },
  heading: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 8 },
  field: { gap: 6 },
  label: { color: colors.text },
  input: {
    color: colors.text,
    backgroundColor: colors.panel,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  muted: { color: colors.muted, fontSize: 13 },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  secondary: { backgroundColor: colors.accent2 },
  buttonText: { color: '#222', fontWeight: '700' },
  saved: { color: colors.accent2 },
  error: { color: colors.danger },
});
