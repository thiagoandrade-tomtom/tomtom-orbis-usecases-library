/* The "get started" path every case shares: account → key → .env.local →
   install → run. One source for the detail panel's Get started card, the
   agent prompt and the starter files/README, so the URLs never drift
   apart again.

   URLs checked against docs.tomtom.com on 2026-10-31. Sign-up lives on
   my.tomtom.com (developer.tomtom.com now just redirects to the docs
   portal), and the SDK's Project setup page carries the official
   "Obtaining your API key" steps.

   The key lives in .env.local, not .env: Vite loads both, but only
   `*.local` is in create-vite's .gitignore, so .env would get committed.
   saveKey asks for the key in the terminal so it never passes through a
   chat with an agent; the leading newline keeps a .env.local
   without a trailing newline from swallowing the line, and an empty
   answer writes nothing (a re-run appends, and Vite takes the last). */
export const GET_STARTED = {
  signup:      'https://my.tomtom.com',
  setup:       'https://docs.tomtom.com/maps-sdk-js/introduction/project-setup',
  keyHowTo:    'https://docs.tomtom.com/maps-sdk-js/introduction/project-setup#obtaining-your-api-key',
  keySecurity: 'https://docs.tomtom.com/platform/documentation/api-best-practices/api-key-management-best-practices',
  docs:        'https://docs.tomtom.com/',
  envVar:      'VITE_TOMTOM_API_KEY',
  envFile:     '.env.local',
  saveKey:     `printf 'TomTom API key: '; read -r k; [ -n "$k" ] && printf '\\nVITE_TOMTOM_API_KEY=%s\\n' "$k" >> .env.local`,
  install:     'npm i @tomtom-org/maps-sdk maplibre-gl',
  run:         'npm run dev',
};

