# Next.js Frontend with Supabase Authentication

This project is a modern web application built with Next.js and TypeScript, featuring Supabase authentication.

## Project Structure

- **Frontend Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Authentication**: Supabase Auth
- **Database**: Supabase (PostgreSQL)

## Key Features

- User authentication (sign up, sign in, sign out)
- Protected routes with middleware
- Responsive design
- Auto-redirect based on authentication status

## Development Guidelines

- Follow TypeScript best practices
- Use Tailwind CSS for styling
- Implement proper error handling
- Maintain consistent code formatting
- Use React hooks appropriately
- Follow Next.js App Router conventions

## File Organization

- `/src/app/` - App Router pages and layouts
- `/src/contexts/` - React context providers
- `/src/lib/` - Utility functions and configurations
- `/middleware.ts` - Route protection middleware

## Environment Variables

Required environment variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
