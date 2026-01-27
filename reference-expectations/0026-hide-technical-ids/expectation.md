# Hide Technical IDs from User Interface

## Severity
Medium

## Problem Statement
Technical identifiers like `adr-51d1f8e8e3ca30e9c0258e0900015b44` are displayed to users in chips/badges below the address. This is confusing and unprofessional. Users have no use for UUIDs, BAG IDs, or internal database identifiers, and displaying them makes the app look unfinished or developer-focused rather than user-friendly.

## Expected Behavior
Technical IDs (UUIDs, BAG IDs, internal identifiers, hash strings) should NEVER be visible in the main user interface. All user-facing elements should display human-readable information only.

## Acceptance Criteria
1. No UUID-style strings (e.g., `adr-51d1f8e8e3ca30e9c0258e0900015b44`) visible in the main UI
2. No BAG IDs or database identifiers shown to users
3. Property cards/sheets show only human-readable information
6. The UI appears polished and consumer-ready
7. Zero console errors during property detail rendering
