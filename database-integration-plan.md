   # AQUORIX Pro Dashboard - Database Integration Plan

   This document outlines the steps to integrate a PostgreSQL database with the AQUORIX Pro Dashboard backend (`aquorix-pro-backend-new`).

   ## Objective
   Establish a secure and efficient connection between the backend (`server.js`) and a PostgreSQL database (hosted on Supabase) to support data persistence for the AQUORIX Pro Dashboard.

   ## Prerequisites
   - Node.js and npm installed on the development environment.
   - Supabase PostgreSQL database accessible with credentials.
   - Task 3.3.3 completed (backend and frontend integration).

   ## Steps

   ### Step 1: Install PostgreSQL Client
   - [x] Install the `pg` package for Node.js to enable PostgreSQL connectivity.
     - Run `npm install pg` in the `aquorix-pro-backend-new` directory.
     - Verify installation by checking `package.json` for `pg` dependency.

   ### Step 2: Configure Database Connection
   - [x] Set up environment variables for Supabase database credentials.
     - Create a `.env` file in the root of `aquorix-pro-backend-new`.
     - Add variable: `DATABASE_URL`.
   - [x] Initialize a connection pool in `server.js` using the `pg` package.
     - Import `pg` and configure a `Pool` instance with transaction mode and SSL.
     - Test the connection during server startup.
   - [x] Handle connection errors gracefully and log them for debugging.

   ### Step 3: Create Database Schema
   - [x] Verify the existing `postgres` schema in Supabase.
     - Check for tables: `users` (exists), `sensor_data`, `alerts` (details in `schema.sql`).
     - Create missing tables using SQL scripts or Supabase dashboard.
   - [x] Execute schema updates via the `pg` client or Supabase.

   ### Step 4: Implement CRUD Operations
   - [x] Add API endpoints in `server.js` for basic CRUD operations.
     - GET `/api/users`: Retrieve user data.
     - POST `/api/sensors`: Insert sensor data.
     - GET `/api/alerts`: Fetch alerts.
   - [x] Use parameterized queries to prevent SQL injection.
   - [x] Test endpoints using Postman or cURL.

   ### Step 5: Test and Validate
   - [x] Write unit tests for database operations using a testing framework (e.g., Jest).
     - Test connection success and failure cases.
     - Test CRUD operations with mock data.
   - [x] Validate data integrity and performance with sample queries.
   - [x] Ensure environment variables are not exposed in version control.

   ## Notes
   - Use a `.env.example` file to document required environment variables.
   - Commit changes to the `feature/backend-api` branch.
   - Update the README with Supabase setup instructions.
   - Ensure the database is backed up before running migrations.

   ## Timeline
   - Step 1: Completed as of 2025-07-01.
   - Step 2: Completed as of 2025-07-02.
   - Step 3: Completed as of 2025-07-03.
   - Step 4: Completed as of 2025-07-03.
   - Step 5: Completed as of 2025-07-03.