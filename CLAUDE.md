# QR Profile Platform

## Stack
- Runtime: Node.js ES Modules (type: "module")
- Backend: Express + serverless-http wrapped as Netlify Functions
- Database: Neon PostgreSQL via @neondatabase/serverless (NOT pg)
- Frontend: Vanilla HTML/CSS/JS, no build step
- Deploy: Netlify (functions in netlify/functions/, static in public/)
- Auth: JWT in httpOnly cookies via jsonwebtoken
- Storage: Cloudinary for logo uploads

## Critical Rules
- Always use neon() tagged template queries — never Pool, never pg
- DATABASE_URL must end with ?sslmode=require
- API responses: always { data } or { error, code }
- Never trust owner_id from client — read from JWT only
- All slugs: ^[a-z0-9-]{3,50}$ enforced at DB + API level
- No app.listen() — export handler = serverless(app)

## Neon Connection Pattern
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`SELECT * FROM profiles WHERE slug = ${slug}`;