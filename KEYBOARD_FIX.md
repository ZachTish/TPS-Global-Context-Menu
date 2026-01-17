# Keyboard Visibility Fix

## Issue
The persistence context menu (inline menu) was visible above the keyboard on mobile devices while typing in Live Preview, obstructing the view. The user requested that the keyboard "cover up" the menu.

## Resolution
Modified `TPS-Global-Context-Menu` to robustly detect when the keyboard is active and hide the persistent menu.

### Changes 

1. **Relaxed Threshold**: 
   - Changed detection logic from a percentage (`< 85%` height) to a fixed buffer (`height < baseHeight - 50px`).
   - This ensures even smaller keyboards (like suggestion bars or external keyboard toolbars) trigger the hide behavior.

2. **Broadened Focus Detection**:
   - Now checks if focus is anywhere within `.markdown-source-view`, not just `.cm-content` or `TEXTAREA`.

3. **Added `focusout` Listener**:
   - Ensures the menu reappears immediately when focus leaves the editor (e.g., keyboard dismissed).

4. **Clean Cleanup**:
   - Updated `teardown` to properly remove all event listeners.

## Technical Details
- **File**: `src/persistent-menu-manager.ts`
- **Class**: `tps-context-hidden-for-keyboard` is applied to `document.body` when keyboard is detected.
- **CSS**: Existing CSS handles the actual hiding (`display: none !important`).

## Verification
- Usage on mobile should now hide the bottom toolbar when typing.
- Usage with hardware keyboard (if viewport shrinks) should also hide it.
- Menu reappears when keyboard is dismissed.
