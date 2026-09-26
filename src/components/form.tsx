/** Small form building blocks shared by the Settings, Refuel and Fuel screens. */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { C } from '@/theme/dash';

type Keyboard = 'default' | 'number-pad' | 'decimal-pad' | 'numbers-and-punctuation';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={formStyles.section}>
      <Text style={formStyles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={formStyles.row}>
      <Text style={formStyles.label}>{label}</Text>
      {children}
    </View>
  );
}

export function Field({
  label,
  value,
  onChange,
  keyboard,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboard: Keyboard;
  placeholder?: string;
}) {
  return (
    <Row label={label}>
      <TextInput
        style={formStyles.input}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboard}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
      />
    </Row>
  );
}

export function Button({
  label,
  onPress,
  primary,
  danger,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [formStyles.btn, primary && formStyles.btnPrimary, pressed && { opacity: 0.6 }]}>
      <Text style={[formStyles.btnTxt, primary && { color: C.bg }, danger && { color: C.danger }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export const formStyles = StyleSheet.create({
  page: { padding: 16, gap: 16, backgroundColor: C.bg },
  section: {
    backgroundColor: C.panel,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  sectionTitle: { color: C.muted, fontSize: 11, letterSpacing: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { color: C.fg, fontSize: 14, flexShrink: 1 },
  input: {
    minWidth: 160,
    color: C.fg,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: C.bg,
    fontVariant: ['tabular-nums'],
  },
  hint: { color: C.muted, fontSize: 12 },
  value: { color: C.fg, fontSize: 14 },
  buttons: { flexDirection: 'row', gap: 8 },
  btn: {
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: C.panel,
  },
  btnPrimary: { backgroundColor: C.info, borderColor: C.info },
  btnTxt: { color: C.fg, fontSize: 14 },
});
