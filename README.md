# Next.js Frontend with Supabase Authentication

This is a Next.js application with Supabase authentication, featuring a login page and a protected home page.

## Features

- 🔐 User authentication with Supabase
- 📱 Responsive design with Tailwind CSS
- 🛡️ Protected routes with middleware
- 🎨 Clean and modern UI
- 🔄 Auto-redirect based on authentication status

## Setup Instructions

### 1. Supabase Project Setup

1. Go to [Supabase](https://supabase.com) and create a new project
2. In your Supabase dashboard, go to Settings > API
3. Copy your project URL and anon key

### 2. Environment Variables

Update the `.env.local` file with your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
src/
├── app/
│   ├── home/
│   │   └── page.tsx          # Protected home page
│   ├── login/
│   │   └── page.tsx          # Login/signup page
│   ├── layout.tsx            # Root layout with AuthProvider
│   └── page.tsx              # Landing page (redirects based on auth)
├── contexts/
│   └── AuthContext.tsx       # Authentication context provider
└── lib/
    ├── supabase.ts           # Browser Supabase client
    └── supabase-server.ts    # Server Supabase client
middleware.ts                 # Route protection middleware
```

## How It Works

### Authentication Flow

1. **Landing Page (`/`)**: Checks authentication status and redirects to `/home` (authenticated) or `/login` (not authenticated)
2. **Login Page (`/login`)**: Handles both sign-up and sign-in with email/password
3. **Home Page (`/home`)**: Protected page that displays user information
4. **Middleware**: Automatically protects routes and handles redirects

### Key Components

- **AuthContext**: Provides authentication state and methods throughout the app
- **Middleware**: Server-side route protection
- **Supabase Clients**: Separate clients for browser and server-side operations

## Usage

### Sign Up
1. Navigate to the app
2. Click "Don't have an account? Sign up"
3. Enter email and password
4. Check your email for confirmation link
5. Once confirmed, sign in

### Sign In
1. Navigate to the app
2. Enter your email and password
3. Click "Sign in"
4. You'll be redirected to the home page

### Sign Out
1. Click the "Sign out" button on the home page
2. You'll be redirected to the login page

## Technologies Used

- **Next.js 15** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Supabase** - Backend and authentication
- **@supabase/ssr** - Supabase SSR package for Next.js

## Deployment

This app can be deployed to Vercel, Netlify, or any platform that supports Next.js.

Make sure to set your environment variables in your deployment platform:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
