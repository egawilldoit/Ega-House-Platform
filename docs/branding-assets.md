# Branding assets

Current main logo:
- `public/logo.svg`

Current generated assets:
- `public/favicon.ico` - browser fallback favicon with 16x16, 32x32, and 48x48 entries
- `public/icon.svg` - scalable app icon derived from the main logo
- `public/icon-192.png` - 192x192 web app icon
- `public/icon-512.png` - 512x512 web app icon
- `public/apple-touch-icon.png` - 180x180 iOS icon
- `public/og-image.png` - 1200x630 social preview image
- `public/manifest.webmanifest` - web app manifest metadata
- `public/logo.svg` - main square logo/mark

Logo usage:
- Sidebar brand area uses `public/logo.svg` at compact mark size.
- Landing/home page uses `public/logo.svg` as the primary brand mark.
- Login page uses `public/logo.svg` as the auth brand mark.

Recommended assets:
- `public/favicon.ico` - browser fallback favicon
- `public/icon.svg` - scalable app icon
- `public/icon-192.png` - 192x192 web app icon
- `public/icon-512.png` - 512x512 web app icon
- `public/apple-touch-icon.png` - 180x180 iOS icon
- `public/og-image.png` - 1200x630 social preview image
- `public/manifest.webmanifest` - web app manifest metadata
- `public/logo.svg` - main logo/wordmark or mark
- `public/logo-mark.svg` - optional compact mark if a separate horizontal wordmark is added later

Logo sizing:
- Sidebar/header: 28-40px height
- Auth/landing: 48-72px height
- Compact mark: 32-40px

Icon library:
- `lucide-react` is the app UI icon library.

Accessibility:
- Use alt text for meaningful logos.
- Hide decorative icons from screen readers.
- Add `aria-label` to icon-only buttons.

Usage rules:
- Do not stretch `public/logo.svg` into a horizontal wordmark.
- Use the square mark in compact shell and auth contexts.
- Keep favicon and app icon exports derived from the approved logo unless a dedicated mark is added.
