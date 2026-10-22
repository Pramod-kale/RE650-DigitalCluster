import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import { formStyles as styles } from '@/components/form';
import { RefuelForm } from '@/components/refuel-form';
import { getEntries } from '@/fuel/fuelLog';

/** Edit a refuel (?id=…); adding one happens on the Fuel screen. */
export default function RefuelScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = id ? getEntries().find((e) => e.id === id && !e.deleted) : undefined;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? 'Edit refuel' : 'Refuel' }} />
      {id && !existing ? (
        <Text style={styles.value}>This refuel no longer exists.</Text>
      ) : (
        <RefuelForm existing={existing} onDone={() => router.back()} />
      )}
    </ScrollView>
  );
}
