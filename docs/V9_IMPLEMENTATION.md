# Saeed AI v9 implementation

Scope: preserve existing data; append tasks rather than replace; exact decimal arithmetic for supported calculations; recurring reminders with snooze/cancel and ownership validation; natural-language tool routing; modular service boundaries; opt-in morning briefing, expenses and shopping list. External weather/FX data must be sourced and timestamped before inclusion; do not fabricate them.

Rollout: (1) additive migration, (2) deploy tested code, (3) health and private Telegram end-to-end checks. All personal features default to private user scope, morning messages default OFF. Never post secrets or raw private user records in CI logs.
