# Vercel Deployment Guide

This backend can run on Vercel as a Node.js Function through `api/index.ts`.
Use Docker Compose for local container deployment, but use the Vercel function entry for Vercel.

## 1. Choose The Correct Root Directory

If this repository is imported directly into Vercel, set:

```text
Root Directory: .
```

If this backend is inside a larger monorepo, set the root directory to the folder that contains this backend's `package.json`, `src`, `api`, and `prisma` directories:

```text
Root Directory: tirgeo-backend
```

Do not point Vercel at a parent folder unless that parent has its own Vercel project setup. Vercel cannot access files above the configured root directory during build.

## 2. Create A Production Postgres Database

Use an externally hosted Postgres database. Good options are:

- Vercel Postgres / Neon
- Supabase Postgres
- Railway Postgres
- Render Postgres

Copy the production connection string. It must be a PostgreSQL URL compatible with Prisma.

## 3. Add Vercel Environment Variables

In Vercel, open Project Settings, then Environment Variables, and add:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=<at-least-32-characters>
STORAGE_PATH=/tmp/tirgeo-uploads
CORS_ORIGINS=https://your-frontend-domain.vercel.app
TRUST_PROXY=true
JWT_ISSUER=tirgeo-backend
JWT_AUDIENCE=tirgeo-app
```

Notes:

- `JWT_SECRET` must be changed from any local placeholder.
- `CORS_ORIGINS` should include every deployed frontend origin that will call the API.
- Vercel's filesystem is ephemeral. `/tmp` is acceptable for temporary processing, but not durable file storage.

## 4. Run Database Migrations

Run migrations against the production database before using the API:

```bash
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

This can be run locally, from CI, or from a controlled release job.

Do not rely on the Vercel function to run migrations on every request.

## 5. Import The Project In Vercel

1. Create a new Vercel project from Git.
2. Set the Root Directory as described above.
3. Keep the framework preset as Other if Vercel does not detect this as a standard frontend framework.
4. Vercel will use `vercel.json`.
5. Confirm the build command is:

```bash
npm run vercel-build
```

## 6. Deploy

Push to the connected branch or trigger a manual deployment in Vercel.

After deployment, verify:

```text
GET https://your-api-domain.vercel.app/health
GET https://your-api-domain.vercel.app/ready
GET https://your-api-domain.vercel.app/docs
```

## 7. Seed Optional Demo Data

If this is a non-production environment and you need demo login data:

```bash
DATABASE_URL="postgresql://..." JWT_SECRET="..." npx tsx prisma/seed.ts
```

The seed script prints the demo `organisationId`, email, and password.

## 8. Important Production Caveats

- General file uploads are not durable on Vercel unless moved to object storage such as Vercel Blob, S3, or Supabase Storage.
- Long-running jobs are not a good fit for request/response functions. Move heavy parsing or background work to a queue if it grows.
- The Swagger UI is useful, but you may want to protect or disable `/docs` in production later.
- If the frontend and backend are separate Vercel projects, configure `CORS_ORIGINS` with the frontend domain.
- For generated API clients, add explicit Fastify OpenAPI schemas in route definitions.
