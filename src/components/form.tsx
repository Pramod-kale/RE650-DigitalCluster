/** Small form building blocks shared by the Settings, Refuel and Fuel screens. */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { C, F } from '@/theme/dash';

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
  long,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboard: Keyboard;
  placeholder?: string;
  /** Long machine values (URLs, tokens): wraps instead of scrolling sideways. */
  long?: boolean;
}) {
  return (
    <Row label={label}>
      <TextInput
        style={[formStyles.input, long && formStyles.inputLong]}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboard}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        multiline={long}
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
      <Text style={[formStyles.btnTxt, primary && { color: C.bright }, danger && { color: C.danger }]}>
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
    borderRadius: 22,
    padding: 16,
    gap: 10,
  },
  sectionTitle: { color: C.fg, fontSize: F.body, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { color: C.fg, fontSize: F.body, flexShrink: 1 },
  input: {
    minWidth: 180,
    color: C.fg,
    fontSize: F.body,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.bg,
    fontVariant: ['tabular-nums'],
  },
  // Wraps a long token instead of scrolling it off to one side.
  inputLong: { minWidth: 260, maxWidth: 420, maxHeight: 110, fontSize: F.sub },
  hint: { color: C.muted, fontSize: F.hint },
  value: { color: C.fg, fontSize: F.body },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: {
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  // Primary = brighter outline, never a solid fill.
  btnPrimary: { borderColor: C.muted, backgroundColor: '#232428' },
  btnTxt: { color: C.fg, fontSize: F.body },
});
