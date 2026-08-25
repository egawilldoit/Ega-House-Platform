import ProfileStackScreen from '../profile';

/**
 * Compat hidden route — profile is NOT a primary tab (Wave 0).
 * Canonical screen is `app/(app)/profile.tsx` (stack, HeaderActions avatar → /(app)/profile).
 * This file stays for deep-link compat (`/(app)/(tabs)/profile`) and re-exports the canonical
 * so legacy tests and old bookmarks still render the identity card. Tab bar hides it via
 * `href:null` in `_layout.tsx`, and HeaderActions pushes to the canonical stack route.
 */
export default ProfileStackScreen;
