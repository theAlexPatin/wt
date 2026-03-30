# Plan: Re-enable Push Notifications

## Current State
Push notifications are temporarily disabled because:
1. The Owner.com Apple Developer account has a device stuck in "Processing" state, blocking ad-hoc provisioning
2. Personal dev team doesn't support push notification entitlements
3. `expo-notifications` was uninstalled and the import in `_layout.tsx` is now conditional (try/require)

## What Needs to Happen

### 1. Fix Apple Device Registration
- Check https://developer.apple.com/account/resources/devices/list on the Owner.com team
- Wait for device `00008120-00066D901EEA601E` to move from "Processing" to "Enabled"
- If still stuck, use fastlane to toggle: `cd /tmp && APPLE_ID="app-manager@owner.com" FASTLANE_ITC_TEAM_ID=125636115 FASTLANE_TEAM_ID=87LM8RWS68 fastlane toggle_device`
- Auth session is cached at `/Users/alex/.app-store/auth/app-manager@owner.com/cookie`

### 2. Rebuild with Push Notifications
Once device registration works:

```bash
cd app/mobile

# 1. Re-install expo-notifications
npm install expo-notifications

# 2. Update app.json:
#    - Change bundleIdentifier back to "com.owner.wit-companion"
#    - Add "expo-notifications" back to plugins array
#    - Remove "newArchEnabled": false (try new arch with Owner.com team)
#    - Remove empty "entitlements": {}

# 3. Prebuild + apply fixes
npx expo prebuild --platform ios --clean

# 4. Re-apply Podfile post_install fix (FOLLY_CFG_NO_COROUTINES=1)
# 5. Re-apply fmt base.h patch (FMT_USE_CONSTEVAL 0)
# 6. Re-apply Info.plist NSAllowsArbitraryLoads = true
# 7. Re-apply AppDelegate.swift waitsForConnectivity fix

# 8. Build via EAS (uses Owner.com team, handles signing)
eas build --platform ios --profile development
```

### 3. Automate Build Fixes
The following patches are needed after every `expo prebuild --clean` and should be automated:
- **Podfile**: Add `FOLLY_CFG_NO_COROUTINES=1` preprocessor define in post_install
- **fmt/base.h**: Change `FMT_USE_CONSTEVAL 1` to `0` (Xcode 16+ consteval bug)
- **Info.plist**: Set `NSAllowsArbitraryLoads` to `true` (for Tailscale/HTTP connections)
- **AppDelegate.swift**: Add `RCTSetCustomNSURLSessionConfigurationProvider` with `waitsForConnectivity = true` (for VPN/Tailscale support)

Consider creating an Expo config plugin to apply these automatically.

### 4. Files to Revert
- `app/mobile/app/_layout.tsx`: Change conditional `require("expo-notifications")` back to static `import * as Notifications from "expo-notifications"`
- `app/mobile/app.json`: Restore `bundleIdentifier`, plugins, remove `newArchEnabled: false`

### 5. Key Credentials
- Owner.com Apple Developer Team ID: `87LM8RWS68`
- App Store Connect Team ID: `125636115`
- EAS Project ID: `b6d031cb-f40d-48cf-8bad-dc2645b6bfbb`
- Apple ID: `app-manager@owner.com`
- Distribution cert serial: `71B8FF9308B10ADDD27C0FA2A9ED65DF`
