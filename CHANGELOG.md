# Changelog

All notable changes to IGLens are documented here.

## [2.0.0] — 2026-06-21

Complete redesign and open-source release.

### Added
- **Side panel UI** with a glassmorphism theme (replaces the old popup + injected modal).
- **Relationship analysis**: followers, following, *not following back*, and *fans*.
- **Unfollow** action (in addition to *remove follower*).
- **Keep list** to protect accounts from any action.
- **Import** Instagram data exports (`.json` / `.txt` / `.html`).
- **Export** any list to a `.txt` file.
- Live progress and status (how many processed).
- New icon set generated from `icons/icon.svg`.
- MIT license, privacy policy, contributing guide, and Web Store listing copy.

### Changed
- Data is now fetched via Instagram's internal REST API for followers **and**
  following, with relationship lists computed locally.
- Settings moved into the side panel.

## [1.0.0]
- Initial popup-based "Followers Cleaner": load followers, flag non-followers,
  remove one by one.
