# Case Controller Mio

## Mio eFile Browser Agent

The V267 eFile page can prepare one or several filings in a separate local eFileTexas browser while the direct EFSP integration is pending. It keeps sign-in credentials in that browser, pauses for court-specific choices, and requires a separate attorney review plus the exact authorization phrase before it can click the final submit button.

On Windows:

1. Pull the latest Mio project files.
2. Double-click `start-mio-efile-agent.bat` and leave its terminal window open.
3. Open Mio, choose **eFile**, and click **Open eFileTexas browser**.
4. Sign in only in the separate eFileTexas window. Never enter the eFileTexas password or verification code into Mio.
5. Build the envelope in Mio, prepare it, resolve any paused items in eFileTexas, and review the actual eFileTexas review screen before approving submission in Mio.

PDF contents and the browser profile stay on the local computer. Mio/Supabase saves only envelope metadata and its audit trail. The agent listens only on `127.0.0.1` and accepts requests only from the production Mio site or the local Vite development site. Chrome or Edge is required; set `MIO_CHROME_PATH` before starting the agent only if neither browser is in its standard install location.

Developer command: `npm run efile-agent`

## Development

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
