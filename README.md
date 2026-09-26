# RE650 Cluster (Android)

The Royal Enfield Interceptor 650 dashboard as a standalone Android app. The phone connects straight to the ELM327 WiFi dongle, polls the ECU, and stores everything on the phone. It replaces the Raspberry Pi (`backend/`) and the web UI (`frontend/`).

```
[Bike ECU] ←CAN→ [ELM327 WiFi dongle 192.168.0.10:35000] ←raw TCP over WiFi→ [this app]
```

## Run it

The app uses a native TCP socket (`react-native-tcp-socket`), so **Expo Go won't work**. You need a development build:

```bash
npm install
npx expo run:android            # local build: Android SDK + phone over USB
# or build in the cloud:
npx eas-cli@latest build --profile development --platform android
```

Then start Metro with `npx expo start` and open the dev build on the phone.

## First launch

1. Tap the yellow banner and **pick a storage folder**, for example `Documents/RE650`.
   - Rides, the odometer and tank data are written both inside the app and to this folder.
   - The folder survives uninstalling the app and *Clear app data*.
   - After a reinstall, pick the same folder again and the odometer, tank and ride history come back.
2. Join the dongle's WiFi (`WiFi_OBDII`, `Steren SCAN-030`, …). When Android warns *"no internet"*, choose **stay connected**.
   - Keep mobile data on. The app sends dongle traffic over WiFi, and other apps keep using mobile data for the internet.
3. Start the bike. The status turns **CONNECTED** within a few seconds.

## Without the bike

- **Mock mode:** Settings → *Mock data* turns on a synthetic 60 s ride. It is recorded as `ride_*_MOCK.csv`, which `fuel_calibration.py` ignores.
- **Fake dongle:** `python3 scripts/fake_elm327.py` (from the repo root) replays a captured real session over TCP on port 35000.
  - Put the phone and the laptop on the same WiFi.
  - In Settings, set Host to the laptop's IP.
  - `--asleep N` simulates an ECU that is still off (NO DATA), which exercises the auto-reconnect.

## Data

| File (in the app and in the picked folder) | What |
|---|---|
| `ride_YYYYMMDD_HHMMSS.csv` | One per ride, same columns as the Pi backend. Works with `scripts/analyze_ride.py` / `fuel_calibration.py`. |
| `state.{a,b}.json` | Lifetime odometer and tank-since-fill. There are two alternating slots, so a crash mid-write can't corrupt it. |
| `settings.{a,b}.json` | Dongle host/port, VE, fuel correction factor, poll interval, mock mode |
| `rides_index.{a,b}.json` | Cached ride summaries for the Rides screen |
| `fuel_log.{a,b}.json` | Refuel history: litres, cost, partial/missed flags, and the km plus app estimate for each fill |

How often data is saved:
- Ride rows are appended internally every 5 s and to the folder every 30 s, and are flushed right away when the app goes to the background.
- The odometer and tank are saved every 30 s, and immediately when you save a refuel.
- A ride starts on the first live sample and ends after 2 minutes with no data.

## Fuel log

- Tap **⛽ Refuel** on the dashboard at every fill-up and enter the litres added (the cost is optional).
- Mileage (km/L) uses the tank-to-tank method, so it's only computed between two **full** fills.
  - A *partial* fill adds its litres to the next full fill.
  - *"I missed logging a refuel"* leaves that tank out of the averages.
- Comparing pump litres with the app's estimate gives a calibrated fuel correction factor. The Fuel log offers to apply it.
- Tap an entry to edit or delete it. A deleted entry's km move to the next refuel, so no distance is lost.

## Code map

| Path | Role |
|---|---|
| `src/obd/` | ELM327 TCP client, response parsing, PID decoders, gear and fuel math, mock generator (a port of `backend/obd.py`) |
| `src/engine/` | Poll loop with reconnect/backoff (`poller.ts`), live state and `/api/*`-equivalent snapshot (`store.ts`), ride lifecycle, app runtime |
| `src/storage/` | SAF folder, crash-safe JSON slots, ride CSV writer/list/share/delete |
| `src/fuel/` | Fuel log storage and the tank-to-tank mileage and calibration maths |
| `src/app/` | Screens: dashboard (`index`), `fuel` (log), `refuel` (add/edit), `rides`, `settings` |

## Checks

```bash
npx tsc --noEmit && npx expo lint && npm test
```

The tests compare the TypeScript port against values computed by the original Python code. They also run the real `Elm327Client` against `scripts/fake_elm327.py` over TCP.
