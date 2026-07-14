# Vercel Deployment Guide

This project deploys as one Vercel project: Vite builds the React UI into `frontend/dist`, and
`api/index.ts` runs the Fastify API as a Node.js Function. The root `vercel.json` routes `/api/*`,
`/health`, `/ready`, and `/docs` to the API, then serves the React app for all other paths.

The Docker image is also all-in-one: it builds the frontend, builds the backend, and the Fastify
server serves `frontend/dist` from the same container.

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
CORS_ORIGINS=
TRUST_PROXY=true
JWT_ISSUER=tirgeo-backend
JWT_AUDIENCE=tirgeo-app
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
VITE_API_BASE_URL=
```

Notes:

- `JWT_SECRET` must be changed from any local placeholder.
- Prisma expects `DATABASE_URL`. If a Vercel/Neon integration created `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, or `POSTGRES_URL`, either copy that value into `DATABASE_URL` or rely on the app's runtime fallback. Migrations still work best when `DATABASE_URL` is explicitly set.
- `CORS_ORIGINS` can stay blank for the one-project same-origin deployment. Set it only if another frontend domain will call this API.
- `VITE_API_BASE_URL` can stay blank for the one-project same-origin deployment. Set it only if the frontend should call a separate API origin.
- Vercel's filesystem is ephemeral. `/tmp` is acceptable for temporary processing, but not durable file storage.
- `BLOB_READ_WRITE_TOKEN` is created when you connect a Vercel Blob store. Use a private Blob store for project photos, HSEQ evidence, permits, incidents, and signed document attachments.

## 3.1. Create Vercel Blob Storage

In Vercel:

1. Open the project.
2. Go to Storage.
3. Create or connect a Vercel Blob store.
4. Choose private storage for tenant/user-uploaded construction records.
5. Confirm `BLOB_READ_WRITE_TOKEN` is available to the project environments.

The backend stores Blob files under tenant-prefixed paths:

```text
organisations/{organisationId}/projects/{projectId}/...
organisations/{organisationId}/entities/{entityType}/{entityId}/...
```

Use `/api/v1/files` for server-side multipart uploads.

For field photos and larger uploads, use direct browser uploads:

1. Call `POST /api/v1/files/client-upload-token` with `originalName`, `contentType`, optional `projectId`, `entityType`, and `entityId`.
2. Use `@vercel/blob/client` in the frontend to upload to the returned `pathname` with the returned `clientToken`.
3. Call `POST /api/v1/files/register` with the returned Blob `pathname`, `url`, `downloadUrl`, `mimeType`, `sizeBytes`, and entity metadata.

This avoids exposing `BLOB_READ_WRITE_TOKEN` to the browser and avoids streaming large field photos through the API function.

## 4. Run Database Migrations

Run migrations against the production database before using the API:

```bash
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

If your `DATABASE_URL` is already stored in Vercel, the cleanest local command is:

```bash
npx vercel link
npx vercel env run -e production -- npm run db:migrate:deploy
```

For a preview database/environment, use:

```bash
npx vercel env run -e preview -- npm run db:migrate:deploy
```

These commands fetch the selected Vercel environment variables for the one command without requiring you to paste the database URL into your shell.

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
GET https://your-domain.vercel.app/
GET https://your-domain.vercel.app/health
GET https://your-domain.vercel.app/ready
GET https://your-domain.vercel.app/docs
```

## 7. Seed Optional Demo Data

If this is a non-production environment and you need demo login data:

```bash
DATABASE_URL="postgresql://..." JWT_SECRET="..." npx tsx prisma/seed.ts
```

The seed script prints the demo organisation slug, `organisationId`, email, and password.

## 8. All-In-One Docker Deployment

Build the image from the repo root:

```bash
docker build -t tirgeo-all-in-one:local .
```

Run it with a hosted Postgres database:

```bash
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e JWT_SECRET="..." \
  -e TRUST_PROXY=true \
  -e BLOB_READ_WRITE_TOKEN="..." \
  tirgeo-all-in-one:local
```

The container runs migrations on startup and serves both:

```text
http://localhost:3000/          React UI
http://localhost:3000/api/v1/*  API
http://localhost:3000/docs      Swagger UI
```

## 9. Important Production Caveats

- General file uploads are not durable on Vercel unless moved to object storage such as Vercel Blob, S3, or Supabase Storage.
- Long-running jobs are not a good fit for request/response functions. Move heavy parsing or background work to a queue if it grows.
- The Swagger UI is useful, but you may want to protect or disable `/docs` in production later.
- If the frontend and backend are later split into separate Vercel projects, configure frontend `VITE_API_BASE_URL` and backend `CORS_ORIGINS`.
- For generated API clients, add explicit Fastify OpenAPI schemas in route definitions.
