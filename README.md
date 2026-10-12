# Pathwise
Your AI-assisted career coach

## Quick start

```bash
git clone https://github.com/git-akihakune/Pathwise.git
cd Pathwise
docker compose up
```

Open http://localhost:3000 and register. The first account becomes the admin.

## Configuration

Configuration is optional. Copy `.env.example` to `.env` and uncomment what you need.

Back up the `pathwise-secrets` volume with the database. Rotate the encryption key with `docker compose exec worker pathwise admin rotate-encryption-key`.

## Development

```bash
pnpm install
pnpm dev            # dev database + init + web + worker
pnpm lint
pnpm typecheck
pnpm test           # unit tests
pnpm test:int       # integration tests (needs Docker)
pnpm e2e            # Playwright against a fresh compose stack
```

## License

AGPL-3.0
