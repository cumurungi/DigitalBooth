# Deployment

This project uses:

- Firebase Hosting for the React frontend.
- A separate Node.js + Express backend for the API.
- MySQL for saved memories.

Firebase Hosting alone is static hosting, so it should not rewrite `/api/**` to Firebase Functions unless the project is upgraded to Blaze.

## Backend Environment Variables

Set these on your backend host:

```env
MYSQL_HOST=your-mysql-host
MYSQL_PORT=3306
MYSQL_USER=your-mysql-user
MYSQL_PASSWORD=your-mysql-password
MYSQL_DATABASE=your-mysql-database
COUPLE_ACCESS_CODE=your-private-passcode
COUPLE_SESSION_SECRET=a-long-random-secret
PUBLIC_API_BASE_URL=https://your-backend-url
```

## MySQL Schema

Run the SQL in `server/schema.sql` in your MySQL database.

## Backend Deploy

Use any Node host that supports environment variables.

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

## Frontend Deploy To Firebase

Set the backend URL before building:

```cmd
set VITE_API_BASE_URL=https://your-backend-url
npm.cmd run build
firebase deploy --only hosting
```

For local development with frontend + backend:

```cmd
npm.cmd run dev:full
```
