# Release process

The build + publish flow is automated via GitHub Actions
(`.github/workflows/release.yml`). To cut a new release:

```bash
# 1. Bump version
npm version 0.2.0           # writes package.json + creates a tag
# 2. Push commit + tag
git push --follow-tags
```

That's it. The push triggers a matrix build across:

- macOS arm64 (Apple Silicon, runner `macos-14`)
- macOS x64 (Intel, runner `macos-13`)
- Windows x64 (`windows-latest`)
- Linux x64 (`ubuntu-latest`)
- Linux arm64 (`ubuntu-latest`)

Each runner produces its native installers (`.dmg` / `.exe` / `.AppImage`
/ `.deb`) via `electron-builder`. After all 5 jobs succeed, the
`release` job downloads every artifact and publishes a GitHub Release
with all installers attached.

Manual trigger is also supported: in the Actions tab → **Build & Release**
→ **Run workflow** → enter an existing tag name.

---

## macOS code signing (optional, requires $99/year Apple Developer Program)

Without signing, macOS shows a "无法验证开发者" warning on first launch.
Users have to run `xattr -dr com.apple.quarantine /Applications/claude-pets.app`
to bypass Gatekeeper. To make the install seamless, set up Apple
Developer ID signing + notarization:

### Prerequisites

1. Enroll in [Apple Developer Program](https://developer.apple.com/programs/) ($99/year)
2. Create a **Developer ID Application** certificate in Apple Developer console
3. Download the `.cer`, install into Keychain, then export the private key + cert
   together as a `.p12` file (with a password)
4. Generate an [app-specific password](https://appleid.apple.com/) for your Apple ID
   (used for notarization)
5. Find your [Apple Team ID](https://developer.apple.com/account/) (a 10-char string)

### Add secrets to GitHub repo

Settings → Secrets and variables → Actions → New repository secret:

| Secret name | Value |
|---|---|
| `MAC_CERT_P12_BASE64` | `base64 -i developer-id.p12 \| pbcopy` |
| `MAC_CERT_PASSWORD` | The password you set when exporting the .p12 |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | The 16-char password from appleid.apple.com |
| `APPLE_TEAM_ID` | Your 10-char Team ID |

That's it. The next release will automatically sign + notarize the .dmg.
You can verify by running `spctl -a -v /Applications/claude-pets.app`
after install — should print `accepted`.

### Verifying locally before pushing

```bash
export CSC_LINK=$(base64 -i developer-id.p12)
export CSC_KEY_PASSWORD='your-p12-password'
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='ABCD123456'

npx electron-vite build
npx electron-builder --mac dmg --arm64
```

---

## Windows code signing (optional)

Windows SmartScreen also flags unsigned `.exe`s. To suppress, get an
EV / OV code signing certificate (~$200-400/yr from Sectigo, Comodo, etc.)
and add as:

| Secret | Value |
|---|---|
| `WIN_CERT_PFX_BASE64` | `base64 -i windows-cert.pfx` |
| `WIN_CERT_PASSWORD` | The .pfx export password |

Then in `.github/workflows/release.yml`, add to the Package step's `env:`:

```yaml
WIN_CSC_LINK: ${{ secrets.WIN_CERT_PFX_BASE64 }}
WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CERT_PASSWORD }}
```

---

## Linux signing

Not commonly done. AppImage and .deb users trust the source URL (GitHub
Releases over HTTPS). Skip.

---

## What gets attached to each release

| File | Platform |
|---|---|
| `claude-pets-<ver>-arm64.dmg` | macOS Apple Silicon |
| `claude-pets-<ver>.dmg` | macOS Intel |
| `claude-pets-<ver>-arm64-mac.zip` | macOS Apple Silicon (zip) |
| `claude-pets-<ver>-mac.zip` | macOS Intel (zip) |
| `claude-pets-Setup-<ver>.exe` | Windows x64 |
| `claude-pets-<ver>.AppImage` | Linux x64 |
| `claude-pets-<ver>-arm64.AppImage` | Linux arm64 |
| `claude-pets_<ver>_amd64.deb` | Debian/Ubuntu x64 |
| `claude-pets_<ver>_arm64.deb` | Debian/Ubuntu arm64 |
