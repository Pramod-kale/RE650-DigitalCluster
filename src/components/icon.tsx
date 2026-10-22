/**
 * Line icons drawn from the Material Symbols font, built into the app by the
 * expo-font config plugin (app.json), so they show on the first frame. Glyphs
 * are private-use code points, so only the ones used here are listed.
 */
import { Text } from 'react-native';

import { C } from '@/theme/dash';

export const ICON_FONT = 'MaterialSymbols_400Regular';

const GLYPHS = {
  settings: 0xe8b8,
  bike: 0xe9f9, // two_wheeler
  gps: 0xe0c8, // location_on
  gpsOff: 0xe0c7,
  route: 0xeacd,
  fuel: 0xe546, // local_gas_station
  map: 0xe55b,
  back: 0xe5c4, // arrow_back
  backToStart: 0xeba1, // u_turn_left
  warning: 0xe002,
  info: 0xe88e,
  error: 0xe000,
  ok: 0xe86c, // check_circle
  close: 0xe5cd,
  pause: 0xe034,
  bluetooth: 0xe1a7,
  share: 0xe80d,
  expand: 0xf1ce, // open_in_full
} as const;

export type IconName = keyof typeof GLYPHS;

export function Icon({ name, size = 18, color = C.fg }: { name: IconName; size?: number; color?: string }) {
  return (
    <Text
      accessible={false}
      style={{ fontFamily: ICON_FONT, fontSize: size, lineHeight: size, width: size, color, includeFontPadding: false }}>
      {String.fromCharCode(GLYPHS[name])}
    </Text>
  );
}
