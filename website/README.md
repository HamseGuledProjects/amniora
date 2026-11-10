# Amniora website: local portfolio demo

Amniora development is cancelled. This directory preserves the website source and adds a local demonstration of its interface. It runs without a Supabase project, account, database, API key or AI provider.

Original work is licensed under the [MIT License](../LICENSE). Dependencies and third-party assets retain their own terms; see [third-party notices](../THIRD_PARTY_NOTICES.md).

## Run locally

Use Node.js 22 or later. The preparation checks used Node.js 24.18.0.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

Open [the local website](http://127.0.0.1:3000). Dependency installation needs registry access. The running demo uses local data. Do not add environment files or credentials: the launcher refuses `.env` files and discards inherited service settings before starting Next.js.

To run the production build locally:

```sh
npm run build
npm start
```

Both servers bind to `127.0.0.1`. An alternative local port can be supplied with `npm run dev -- --port 3105` or `npm start -- --port 3105`. This package is prepared for local review, not deployment as a public service.

## Explore

- The homepage and public pages show the preserved design and cancelled project context.
- The dashboard and saved investigations contain fictional learner progress and synthetic evidence.
- The investigation flow opens one fixed Linux example. Changing the original generation implementation is unnecessary to explore it.
- Tutor uses written example replies selected locally. It does not generate new AI answers.
- PDF and ZIP downloads use the original export builders with synthetic evidence.
- Completion and feedback controls affect local sample state. Automatic assessment, support requests, payments, account creation and native runtime launch are unavailable.

Browser sample changes use session storage. Tutor conversations and sample feedback use local server memory and disappear when the server restarts. Theme and tour preferences may use browser local storage. Use **Reset sample data** in the banner to restore the examples. Use invented text when trying forms.

## Preserved implementation

The original `app`, `components`, `lib`, public assets and configuration remain available for study, including generation, AI, Supabase and runtime integration code. The demo adds `lib/portfolio-demo` and local launcher scripts, replaces external font loading with system fonts, and disables monitoring hooks. Dependencies have been updated within the existing framework major version.

The shipped demo mode is fixed in source. Supabase adapter factories return a local client; the request proxy handles every API path and rejects operations outside its sample allowlist. Account and administration pages redirect to the sample workspace. The launcher removes inherited service variables, disables Next.js telemetry and preloads an application-level network guard. Browser content policy restricts resource and connection origins. These measures prevent the normal demo paths from contacting the archived services; they are not an operating-system isolation boundary for arbitrary code changes.

The archived test fixtures, database migrations and packaging material document the original implementation. They are not applied or executed by the local startup commands. No database needs to be created or migrated.

## Checks

```sh
npm run typecheck
npm run build
```

With the local server running on its default port, run the independent demo checks:

```sh
node --test tests/portfolio-demo.test.cjs
```

For a different port, set `PORTFOLIO_TEST_URL` to the loopback URL in your shell. The checks cover page responses, synthetic Tutor and investigation results, PDF and ZIP downloads, unavailable operational routes, host and origin restrictions, mutation methods, network refusal and clean startup settings. Browser review is also needed to assess the preserved interface. Passing these checks does not validate the original hosted services or native Runner execution.
